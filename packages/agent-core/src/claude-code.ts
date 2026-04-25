import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import {
  parseRuntimeManifestText,
  type AgentCatalog,
  type AgentCatalogProvider,
  type AgentModelRef,
  type AgentRuntimeEvent,
} from '@cepage/shared-core';

const CLAUDE_BIN = (): string => process.env.CLAUDE_BIN?.trim() || 'claude';

type PipedChild = ChildProcess & {
  stdout: NonNullable<ChildProcess['stdout']>;
  stderr: NonNullable<ChildProcess['stderr']>;
};

function spawnClaudeCode(
  argv: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
): PipedChild {
  const merged: NodeJS.ProcessEnv =
    opts.env === undefined ? process.env : { ...process.env, ...opts.env };
  const spawnOpts = {
    cwd: opts.cwd,
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  const child = spawn(CLAUDE_BIN(), argv, spawnOpts);
  if (child.stdout === null || child.stderr === null) {
    throw new Error('claude: expected piped stdio');
  }
  return child;
}

const csiRe = new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, 'g');
const oscRe = new RegExp(String.raw`\u001B\][^\u0007]*(?:\u0007|\u001B\\)`, 'g');

function stripAnsi(value: string): string {
  return value
    .replace(csiRe, '')
    .replace(oscRe, '')
    .replace(/\r/g, '');
}

type AsyncQueueState<T> = {
  items: T[];
  done: boolean;
  waiters: Array<() => void>;
};

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

/**
 * Parse the Markdown-like table emitted by `claude models`.
 *
 * Example:
 *   | Model | ID |
 *   |---|---|
 *   | Opus 4.7 | `claude-opus-4-7` |
 */
export function parseClaudeModelsOutput(output: string): AgentCatalogProvider[] {
  const models: AgentCatalogProvider['models'] = [];
  for (const rawLine of stripAnsi(output).split('\n')) {
    const line = rawLine.trim();
    const match = /^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|$/.exec(line);
    if (!match) continue;
    const modelID = match[2].trim();
    const label = match[1].trim();
    if (!modelID || !label) continue;
    models.push({
      providerID: 'anthropic',
      modelID,
      label,
      description: label,
    });
  }
  return models.length === 0
    ? []
    : [
        {
          agentType: 'claude_code' as const,
          providerID: 'anthropic',
          label: 'Anthropic',
          description: 'via Claude Code',
          models: models.sort((a, b) => a.label.localeCompare(b.label)),
        },
      ];
}

async function runClaudeCodeCommand(
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (options?.cwd) {
    await mkdir(options.cwd, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    const child = spawnClaudeCode(args, { cwd: options?.cwd });

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

function staticClaudeFallbackCatalog(): AgentCatalog {
  const models = [
    {
      providerID: 'anthropic',
      modelID: 'claude-opus-4-7',
      label: 'Opus 4.7',
      description: 'Most capable model',
    },
    {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      description: 'Balanced performance',
    },
    {
      providerID: 'anthropic',
      modelID: 'claude-haiku-4-5-20251001',
      label: 'Haiku 4.5',
      description: 'Fast and lightweight',
    },
  ].sort((a, b) => a.label.localeCompare(b.label));
  return {
    providers: [
      {
        agentType: 'claude_code' as const,
        providerID: 'anthropic',
        label: 'Anthropic',
        description: 'via Claude Code',
        models,
      },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

export async function listClaudeCodeCatalog(params?: {
  workingDirectory?: string;
  signal?: AbortSignal;
}): Promise<AgentCatalog> {
  try {
    const result = await runClaudeCodeCommand(['models'], {
      cwd: params?.workingDirectory,
      signal: params?.signal,
    });
    if (result.exitCode !== 0) {
      return staticClaudeFallbackCatalog();
    }
    const providers = parseClaudeModelsOutput(result.stdout);
    if (providers.length === 0) {
      return staticClaudeFallbackCatalog();
    }
    return {
      providers,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return staticClaudeFallbackCatalog();
  }
}

export interface ClaudeCodeRunParams {
  workingDirectory: string;
  promptText: string;
  model?: AgentModelRef;
  signal?: AbortSignal;
}

export async function* runClaudeCodeStream(
  params: ClaudeCodeRunParams,
): AsyncGenerator<AgentRuntimeEvent> {
  await mkdir(params.workingDirectory, { recursive: true });

  const args = ['-p', '--output-format', 'text', '--no-session-persistence'];
  if (params.model?.modelID) {
    args.push('--model', params.model.modelID);
  }
  args.push(params.promptText);

  const child = spawnClaudeCode(args, { cwd: params.workingDirectory });
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
    pushQueue(queue, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
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
        message: `claude exited with code ${code ?? 0}`,
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
