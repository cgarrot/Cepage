import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  parseRuntimeManifestText,
  type AgentCatalog,
  type AgentCatalogProvider,
  type AgentModelRef,
  type AgentRuntimeEvent,
} from '@cepage/shared-core';

/**
 * Executable name/path for spawn.
 * Prefer the bare `cursor-agent` so the kernel resolves it via PATH (after cursorAgentSpawnEnv).
 * Use `CURSOR_AGENT_BIN` only for an explicit override — do not guess absolute paths with stat:
 * stat may succeed while execve fails (sandbox, mount, or symlink edge cases).
 */
export function resolveCursorAgentBin(input: { env?: NodeJS.ProcessEnv } = {}): string {
  const env = input.env ?? process.env;
  const configured = env.CURSOR_AGENT_BIN?.trim();
  if (configured) return configured;
  return 'cursor-agent';
}

/** Nest/API shells often omit ~/.local/bin; spawn resolves "cursor-agent" via PATH. */
export function cursorAgentSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const raw = (base.HOME?.trim() || homedir()).replace(/\/$/, '');
  const extra = [
    path.join(raw, '.local/bin'),
    path.join(raw, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean);
  const prev = base.PATH ?? '';
  const parts = prev ? prev.split(path.delimiter) : [];
  // Prepend only dirs that are missing. Do not treat "homebrew already in PATH" as "done":
  // cursor-agent is often installed under ~/.local/bin while PATH already has /opt/homebrew/bin.
  const missing = extra.filter((dir) => !parts.includes(dir));
  if (missing.length === 0) return { ...base };
  const prefix = missing.join(path.delimiter);
  return { ...base, PATH: prev ? `${prefix}${path.delimiter}${prev}` : prefix };
}

type PipedChild = ChildProcess & {
  stdout: NonNullable<ChildProcess['stdout']>;
  stderr: NonNullable<ChildProcess['stderr']>;
};

function spawnCursorAgent(
  argv: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
): PipedChild {
  const merged: NodeJS.ProcessEnv =
    opts.env === undefined ? process.env : { ...process.env, ...opts.env };
  const env = cursorAgentSpawnEnv(merged);
  const exe = resolveCursorAgentBin({ env: merged });
  const spawnOpts = {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  const child = spawn(exe, argv, spawnOpts);
  if (child.stdout === null || child.stderr === null) {
    throw new Error('cursor-agent: expected piped stdio');
  }
  return child;
}

export interface CursorAgentRunParams {
  workingDirectory: string;
  promptText: string;
  model?: AgentModelRef;
  signal?: AbortSignal;
}

type AsyncQueueState<T> = {
  items: T[];
  done: boolean;
  waiters: Array<() => void>;
};

const csiRe = new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, 'g');
const oscRe = new RegExp(String.raw`\u001B\][^\u0007]*(?:\u0007|\u001B\\)`, 'g');

function stripAnsi(value: string): string {
  return value
    .replace(csiRe, '')
    .replace(oscRe, '')
    .replace(/\r/g, '');
}

function createQueue<T>(): AsyncQueueState<T> {
  return { items: [], done: false, waiters: [] };
}

function pushQueue<T>(queue: AsyncQueueState<T>, item: T): void {
  queue.items.push(item);
  queue.waiters.splice(0).forEach((resolve) => resolve());
}

function closeQueue<T>(queue: AsyncQueueState<T>): void {
  queue.done = true;
  queue.waiters.splice(0).forEach((resolve) => resolve());
}

async function* drainQueue<T>(queue: AsyncQueueState<T>): AsyncGenerator<T> {
  while (!queue.done || queue.items.length > 0) {
    if (queue.items.length === 0) {
      await new Promise<void>((resolve) => queue.waiters.push(resolve));
      continue;
    }
    const next = queue.items.shift();
    if (next !== undefined) {
      yield next;
    }
  }
}

function parseModelLine(line: string): {
  modelID: string;
  label: string;
  isDefault: boolean;
} | null {
  const match = /^([a-z0-9][a-z0-9.-]*)\s+-\s+(.+?)(?:\s+\(([^)]+)\))?$/.exec(line.trim());
  if (!match) return null;
  const flags = (match[3] ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return {
    modelID: match[1],
    label: match[2].trim(),
    isDefault: flags.includes('default'),
  };
}

function titleCase(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cursorProviderForModel(modelID: string): {
  providerID: string;
  label: string;
} {
  if (modelID === 'auto' || modelID.startsWith('composer-')) {
    return { providerID: 'cursor', label: 'Cursor' };
  }
  if (modelID.startsWith('gpt-')) {
    return { providerID: 'openai', label: 'OpenAI' };
  }
  if (modelID.startsWith('claude-')) {
    return { providerID: 'anthropic', label: 'Anthropic' };
  }
  if (modelID.startsWith('gemini-')) {
    return { providerID: 'google', label: 'Google' };
  }
  if (modelID.startsWith('grok-')) {
    return { providerID: 'xai', label: 'xAI' };
  }
  if (modelID.startsWith('kimi-')) {
    return { providerID: 'moonshot', label: 'Moonshot' };
  }
  const prefix = modelID.split('-')[0] ?? 'cursor';
  return { providerID: prefix, label: titleCase(prefix) };
}

export function parseCursorModelsOutput(output: string): AgentCatalogProvider[] {
  const groups = new Map<string, AgentCatalogProvider>();
  for (const rawLine of stripAnsi(output).split('\n')) {
    const line = rawLine.trim();
    if (!line || line === 'Available models' || line.startsWith('Tip:') || line.startsWith('Loading models')) {
      continue;
    }
    const parsed = parseModelLine(line);
    if (!parsed) continue;
    const provider = cursorProviderForModel(parsed.modelID);
    const key = `${provider.providerID}:${provider.label}`;
    const existing = groups.get(key) ?? {
      agentType: 'cursor_agent' as const,
      providerID: provider.providerID,
      label: provider.label,
      description: 'via Cursor agent',
      models: [],
    };
    existing.models.push({
      providerID: provider.providerID,
      modelID: parsed.modelID,
      label: parsed.modelID,
      description: parsed.label,
      isDefault: parsed.isDefault || undefined,
    });
    groups.set(key, existing);
  }
  return [...groups.values()]
    .map((provider) => ({
      ...provider,
      models: provider.models.sort((a: typeof provider.models[number], b: typeof provider.models[number]) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return a.label.localeCompare(b.label);
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function runCursorAgentCommand(
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (options?.cwd) {
    await mkdir(options.cwd, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    const child = spawnCursorAgent(args, { cwd: options?.cwd });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      options?.signal?.removeEventListener('abort', handleAbort);
    };

    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishResolve = (exitCode: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, exitCode });
    };

    const handleAbort = () => {
      child.kill('SIGTERM');
    };

    options?.signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', (error) => finishReject(error));
    child.once('close', (code) => finishResolve(code ?? 0));
  });
}

export async function listCursorAgentCatalog(params?: {
  workingDirectory?: string;
  signal?: AbortSignal;
}): Promise<AgentCatalog> {
  const result = await runCursorAgentCommand(['models'], {
    cwd: params?.workingDirectory,
    signal: params?.signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(stripAnsi(result.stderr || `cursor-agent models failed (${result.exitCode})`).trim());
  }
  return {
    providers: parseCursorModelsOutput(result.stdout),
    fetchedAt: new Date().toISOString(),
  };
}

export async function* runCursorAgentStream(
  params: CursorAgentRunParams,
): AsyncGenerator<AgentRuntimeEvent> {
  await mkdir(params.workingDirectory, { recursive: true });
  const args = ['-p', '--output-format', 'text', '--force', '--trust', '--workspace', params.workingDirectory];
  if (params.model?.modelID) {
    args.push('--model', params.model.modelID);
  }
  args.push(params.promptText);

  const child = spawnCursorAgent(args, { cwd: params.workingDirectory });
  const queue = createQueue<AgentRuntimeEvent>();
  let transcript = '';

  const pushText = (type: 'stdout' | 'stderr', chunk: Buffer | string) => {
    const text = stripAnsi(String(chunk));
    if (!text.trim()) return;
    transcript += text;
    pushQueue(queue, { type, chunk: text });
  };

  const handleAbort = () => {
    child.kill('SIGTERM');
  };

  params.signal?.addEventListener('abort', handleAbort, { once: true });

  child.stdout.on('data', (chunk) => pushText('stdout', chunk));
  child.stderr.on('data', (chunk) => pushText('stderr', chunk));
  child.once('error', (error) => {
    pushQueue(queue, { type: 'error', message: error instanceof Error ? error.message : String(error) });
    closeQueue(queue);
  });
  child.once('close', (code) => {
    params.signal?.removeEventListener('abort', handleAbort);
    if (params.signal?.aborted) {
      pushQueue(queue, { type: 'done', exitCode: code ?? 0 });
      closeQueue(queue);
      return;
    }
    if ((code ?? 0) !== 0) {
      pushQueue(queue, {
        type: 'error',
        message: `cursor-agent exited with code ${code ?? 0}`,
      });
      closeQueue(queue);
      return;
    }
    const runtimeManifest = parseRuntimeManifestText(transcript);
    if (runtimeManifest) {
      pushQueue(queue, { type: 'artifact_manifest', manifest: runtimeManifest });
    }
    pushQueue(queue, { type: 'done', exitCode: 0 });
    closeQueue(queue);
  });

  for await (const event of drainQueue(queue)) {
    yield event;
  }
}
