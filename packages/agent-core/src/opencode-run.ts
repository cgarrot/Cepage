import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import {
  parseRuntimeManifestText,
  type AgentCatalog,
  type AgentCatalogProvider,
  type AgentModelRef,
  type AgentPromptPart,
  type AgentRuntimeEvent,
} from '@cepage/shared-core';

const OPENCODE_BIN = process.env.OPENCODE_BIN?.trim() || 'opencode';
const OPENCODE_STARTUP_TIMEOUT_MS = 30_000;

function unwrapData<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'data' in res && (res as { data: T }).data !== undefined) {
    return (res as { data: T }).data;
  }
  return res as T;
}

export interface OpenCodeRunParams {
  workingDirectory: string;
  role: string;
  promptText: string;
  parts?: AgentPromptPart[];
  externalSessionId?: string;
  model?: AgentModelRef;
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
}

type SdkEvent = {
  type?: string;
  properties?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type SdkPart = {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type?: string;
  text?: string;
  tool?: string;
  state?: {
    status?: string;
    output?: string;
    error?: string;
  };
};

type SdkMessage = {
  info?: {
    id?: string;
    role?: string;
    sessionID?: string;
  };
  parts?: SdkPart[];
};

type SdkMessageInfo = {
  id?: string;
  role?: string;
  sessionID?: string;
};

type OpenCodeModel = {
  id?: string;
  name?: string;
};

type OpenCodeProvider = {
  id: string;
  name: string;
  models: Record<string, OpenCodeModel>;
};

type OpenCodeProviderListResponse = {
  all: OpenCodeProvider[];
};

const csiRe = new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, 'g');
const oscRe = new RegExp(String.raw`\u001B\][^\u0007]*(?:\u0007|\u001B\\)`, 'g');

function stripAnsi(value: string): string {
  return value
    .replace(csiRe, '')
    .replace(oscRe, '')
    .replace(/\r/g, '');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function titleCase(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function opencodeProviderLabel(providerID: string): string {
  if (providerID === 'openai') return 'OpenAI';
  if (providerID === 'xai') return 'xAI';
  return titleCase(providerID);
}

function readPart(value: unknown): SdkPart | undefined {
  return value && typeof value === 'object' ? (value as SdkPart) : undefined;
}

function readMessageId(part: SdkPart): string | undefined {
  return readString(part.messageID);
}

type StreamDeltaKind = 'text' | 'reasoning';

export type ExtractedStreamDelta = {
  kind: StreamDeltaKind;
  delta: string;
};

export function extractStreamDelta(
  chunk: SdkEvent,
  sessionId: string,
  textByPartId: Map<string, string>,
  reasoningByPartId: Map<string, string>,
  assistantMessageIds: Set<string>,
  partTypeById: Map<string, string>,
): ExtractedStreamDelta | null {
  const type = chunk.type;
  const props = chunk.properties ?? {};
  const data = chunk.data ?? {};

  if (type === 'message.part.delta') {
    const sid = readString(props.sessionID);
    const field = readString(props.field);
    const delta = readString(props.delta);
    const partId = readString(props.partID);
    const messageId = readString(props.messageID);
    if (messageId && !assistantMessageIds.has(messageId)) return null;
    if (sid !== sessionId || field !== 'text' || !delta || !partId) return null;
    const partType = partTypeById.get(partId);
    if (partType === 'text') {
      textByPartId.set(partId, (textByPartId.get(partId) ?? '') + delta);
      return { kind: 'text', delta };
    }
    if (partType === 'reasoning') {
      reasoningByPartId.set(partId, (reasoningByPartId.get(partId) ?? '') + delta);
      return { kind: 'reasoning', delta };
    }
    return null;
  }

  if (type !== 'message.part.updated' && type !== 'message.part.updated.1') {
    return null;
  }

  const part = readPart(props.part) ?? readPart(data.part);
  if (!part) return null;
  const sid = readString(props.sessionID) ?? readString(data.sessionID) ?? readString(part.sessionID);
  const messageId = readString((part as { messageID?: unknown }).messageID);
  if (sid !== sessionId) return null;
  if (part.type !== 'text' && part.type !== 'reasoning') return null;
  if (messageId && !assistantMessageIds.has(messageId)) return null;

  const partId = readString(part.id);
  const delta = readString(props.delta);
  const text = readString(part.text) ?? '';
  const cache = part.type === 'reasoning' ? reasoningByPartId : textByPartId;
  const previous = partId ? (cache.get(partId) ?? '') : '';

  if (partId) {
    cache.set(partId, text);
  }

  const kind: StreamDeltaKind = part.type === 'reasoning' ? 'reasoning' : 'text';
  if (delta) return { kind, delta };
  if (!text || text === previous) return null;
  if (previous && text.startsWith(previous)) {
    return { kind, delta: text.slice(previous.length) };
  }
  return { kind, delta: text };
}

function readMessageInfo(value: unknown): SdkMessageInfo | undefined {
  return value && typeof value === 'object' ? (value as SdkMessageInfo) : undefined;
}

function readSessionError(chunk: SdkEvent): string | undefined {
  const readNested = (value: unknown) => {
    if (!value || typeof value !== 'object') return undefined;
    const obj = value as { message?: unknown; data?: { message?: unknown } };
    return readString(obj.data?.message) ?? readString(obj.message);
  };
  return readString(chunk.properties?.message)
    ?? readString(chunk.data?.message)
    ?? readNested(chunk.properties?.error)
    ?? readNested(chunk.data?.error);
}

// Use a built-in builder so external agent-router hooks do not rewrite the
// prompt/model. Some third-party opencode extensions expose the Plan Builder
// agent as "\u200b\u200b\u200bPrometheus - Plan Builder" — the three
// zero-width-spaces are a sort-order prefix used by those extensions. We must
// match that exact string or opencode returns "Agent not found"; if the
// extension is absent, this resolver falls back implicitly to the built-in
// agent when opencode rejects the unknown name (see callsite ~line 518).
export function resolveOpenCodeAgent(role: string): string | undefined {
  return role === 'workflow_copilot' ? '\u200b\u200b\u200bPrometheus - Plan Builder' : undefined;
}

function buildAssistantOutput(parts: SdkPart[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text?.trim()) {
      chunks.push(part.text.trim());
      continue;
    }
    if (part.type === 'tool' && part.state?.status === 'completed' && part.state.output?.trim()) {
      chunks.push(`[${part.tool ?? 'tool'}]\n${part.state.output.trim()}`);
      continue;
    }
    if (part.type === 'tool' && part.state?.status === 'error' && part.state.error?.trim()) {
      chunks.push(`[${part.tool ?? 'tool'} error]\n${part.state.error.trim()}`);
    }
  }
  return chunks.join('\n\n').trim();
}

export function buildOpenCodePromptParts(parts: AgentPromptPart[] | undefined, promptText: string) {
  if (!parts || parts.length === 0) {
    return [{ type: 'text' as const, text: promptText }];
  }
  return parts.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : {
          type: 'file' as const,
          mime: part.mime,
          url: part.url,
          ...(part.filename ? { filename: part.filename } : {}),
        },
  );
}

function upsertPart(parts: Map<string, SdkPart[]>, part: SdkPart): SdkPart[] | null {
  const messageId = readMessageId(part);
  const partId = readString(part.id);
  if (!messageId || !partId) return null;
  const current = parts.get(messageId) ?? [];
  const index = current.findIndex((entry) => readString(entry.id) === partId);
  if (index === -1) {
    const next = [...current, part];
    parts.set(messageId, next);
    return next;
  }
  const next = current.map((entry, item) => (item === index ? part : entry));
  parts.set(messageId, next);
  return next;
}

async function loadAssistantOutput(
  client: {
    session: {
      messages: (input: {
        path: { id: string };
        query: { directory: string; limit: number };
      }) => Promise<unknown>;
    };
  },
  sessionId: string,
  workingDirectory: string,
): Promise<string> {
  const response = await client.session.messages({
    path: { id: sessionId },
    query: { directory: workingDirectory, limit: 20 },
  });
  const messages = unwrapData<SdkMessage[]>(response);
  const latestAssistant = [...messages].reverse().find((message) => message.info?.role === 'assistant');
  return latestAssistant ? buildAssistantOutput(latestAssistant.parts ?? []) : '';
}

/**
 * Runs OpenCode: local server + SDK session, streams `message.part.updated` deltas until `session.idle` for that session.
 */
export type OpenCodeStreamEvent =
  | AgentRuntimeEvent
  | { type: 'session'; externalSessionId: string }
  | { type: 'snapshot'; output: string };

type OpenCodeRuntime = {
  client: ReturnType<(typeof import('@opencode-ai/sdk'))['createOpencodeClient']>;
  server: { close(): void };
};

type SettledResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(value: Promise<T>): Promise<SettledResult<T>> {
  return value.then(
    (next) => ({ ok: true, value: next }),
    (error) => ({ ok: false, error }),
  );
}

async function pickOpenCodePort(hostname = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, hostname, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Unable to allocate an OpenCode port.'));
          return;
        }
        resolve(port);
      });
    });
  });
}

export function buildOpenCodeBaseUrl(params: {
  port?: number;
  hostname?: string;
}): string | null {
  const port =
    typeof params.port === 'number' && Number.isFinite(params.port) && params.port > 0
      ? params.port
      : undefined;
  if (port == null && !params.hostname) {
    return null;
  }
  return new URL(`http://${params.hostname ?? '127.0.0.1'}:${port ?? 4096}`).toString();
}

async function createOpenCodeRuntime(params: {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
}): Promise<OpenCodeRuntime> {
  const { createOpencode, createOpencodeClient } = await import('@opencode-ai/sdk');
  const baseUrl = buildOpenCodeBaseUrl(params);
  if (baseUrl) {
    return {
      client: createOpencodeClient({ baseUrl }),
      server: { close() {} },
    };
  }
  const port =
    typeof params.port === 'number' && Number.isFinite(params.port) && params.port > 0
      ? params.port
      : await pickOpenCodePort(params.hostname);
  const opts = {
    ...(params.hostname ? { hostname: params.hostname } : {}),
    ...(port != null ? { port } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
    timeout: OPENCODE_STARTUP_TIMEOUT_MS,
  };
  return createOpencode(opts);
}

export function mapOpenCodeProviders(payload: OpenCodeProviderListResponse): AgentCatalogProvider[] {
  return [...(payload.all ?? [])]
    .map((provider) => ({
      agentType: 'opencode' as const,
      providerID: provider.id,
      label: provider.name || provider.id,
      description: 'via OpenCode',
      models: Object.values(provider.models ?? {})
        .map((model) => ({
          providerID: provider.id,
          modelID: model.id ?? '',
          label: model.name ?? model.id ?? '',
        }))
        .filter((model) => model.modelID && model.label)
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((provider) => provider.providerID && provider.models.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function parseOpenCodeModelsOutput(output: string): AgentCatalogProvider[] {
  const providers = new Map<string, AgentCatalogProvider>();
  for (const rawLine of stripAnsi(output).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const slash = line.indexOf('/');
    if (slash <= 0 || slash === line.length - 1) continue;
    const providerID = line.slice(0, slash).trim();
    const modelID = line.slice(slash + 1).trim();
    if (!providerID || !modelID) continue;
    const provider = providers.get(providerID) ?? {
      agentType: 'opencode' as const,
      providerID,
      label: opencodeProviderLabel(providerID),
      description: 'via OpenCode',
      models: [],
    };
    if (!provider.models.some((model) => model.providerID === providerID && model.modelID === modelID)) {
      provider.models.push({
        providerID,
        modelID,
        label: `${providerID}/${modelID}`,
      });
    }
    providers.set(providerID, provider);
  }
  return [...providers.values()]
    .map((provider) => ({
      ...provider,
      models: provider.models.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function runOpenCodeCommand(
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENCODE_BIN, args, {
      cwd: options?.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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

export async function listOpenCodeCatalog(params: {
  workingDirectory?: string;
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
}): Promise<AgentCatalog> {
  // Remote mode: if a hostname is explicitly provided (e.g. Docker service
  // `opencode` or `host.docker.internal`), call the opencode serve HTTP API
  // directly instead of spawning the local binary (the API may not have
  // opencode installed).
  if (params.hostname) {
    const baseUrl = buildOpenCodeBaseUrl({ port: params.port, hostname: params.hostname });
    if (!baseUrl) {
      throw new Error('opencode: hostname provided but unable to build base URL');
    }
    const url = new URL('/provider', baseUrl).toString();
    const res = await fetch(url, { signal: params.signal });
    if (!res.ok) {
      throw new Error(`opencode ${url} HTTP ${res.status}`);
    }
    const payload = (await res.json()) as OpenCodeProviderListResponse;
    return {
      providers: mapOpenCodeProviders(payload),
      fetchedAt: new Date().toISOString(),
    };
  }

  // Local mode: spawn `opencode models` (dev without a dedicated server).
  const result = await runOpenCodeCommand(['models'], {
    cwd: params.workingDirectory,
    signal: params.signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(stripAnsi(result.stderr || `opencode models failed (${result.exitCode})`).trim());
  }
  return {
    providers: parseOpenCodeModelsOutput(result.stdout),
    fetchedAt: new Date().toISOString(),
  };
}

export async function* runOpenCodeStream(
  params: OpenCodeRunParams,
): AsyncGenerator<OpenCodeStreamEvent> {
  const { client, server } = await createOpenCodeRuntime(params);

  try {
    const ocId =
      params.externalSessionId
      ?? unwrapData<{ id: string }>(
        await client.session.create({
          query: { directory: params.workingDirectory },
        }),
      ).id;

    yield { type: 'session', externalSessionId: ocId };
    yield { type: 'status', status: 'booting' };

    const sse = await client.event.subscribe({
      query: { directory: params.workingDirectory },
    });

    const stream = sse.stream as AsyncIterable<SdkEvent>;
    const agent = resolveOpenCodeAgent(params.role);
    const promptPromise = settle(
      client.session.prompt({
        path: { id: ocId },
        query: { directory: params.workingDirectory },
        body: {
          ...(agent ? { agent } : {}),
          model: params.model,
          parts: buildOpenCodePromptParts(params.parts, params.promptText),
        },
      }),
    );

    let idle = false;
    let sawOutput = false;
    const textByPartId = new Map<string, string>();
    const reasoningByPartId = new Map<string, string>();
    const assistantMessageIds = new Set<string>();
    const partTypeById = new Map<string, string>();
    const partsByMessageId = new Map<string, SdkPart[]>();
    let lastSnapshot = '';
    try {
      for await (const chunk of stream) {
        const t = chunk?.type;
        const props = chunk?.properties ?? {};
        const data = chunk?.data ?? {};

        if (t === 'message.updated' || t === 'message.updated.1') {
          const info = readMessageInfo(props.info) ?? readMessageInfo(data.info);
          const infoSessionId =
            readString(props.sessionID) ?? readString(data.sessionID) ?? readString(info?.sessionID);
          if (infoSessionId === ocId && info?.role === 'assistant' && info.id) {
            assistantMessageIds.add(info.id);
          }
        }

        if (t === 'message.part.updated' || t === 'message.part.updated.1') {
          const part = readPart(props.part) ?? readPart(data.part);
          const partId = readString(part?.id);
          const partType = readString(part?.type);
          const messageId = part ? readMessageId(part) : undefined;
          if (partId && partType) {
            partTypeById.set(partId, partType);
          }
          if (part && messageId && assistantMessageIds.has(messageId)) {
            const parts = upsertPart(partsByMessageId, part);
            const next =
              parts && part.type !== 'text' && (part.type !== 'tool' || part.state?.status !== 'running')
                ? buildAssistantOutput(parts)
                : '';
            if (next && next !== lastSnapshot) {
              lastSnapshot = next;
              sawOutput = true;
              yield { type: 'snapshot', output: next };
            }
          }
        }

        const streamDelta = extractStreamDelta(
          chunk,
          ocId,
          textByPartId,
          reasoningByPartId,
          assistantMessageIds,
          partTypeById,
        );
        if (streamDelta) {
          sawOutput = true;
          if (streamDelta.kind === 'reasoning') {
            yield { type: 'thinking', chunk: streamDelta.delta };
          } else {
            yield { type: 'stdout', chunk: streamDelta.delta };
          }
        }
        if (t === 'session.error') {
          const msg = readSessionError(chunk) ?? 'session.error';
          yield { type: 'stderr', chunk: msg };
          yield { type: 'error', message: msg };
          return;
        }
        if (t === 'session.idle') {
          const sid = props.sessionID as string | undefined;
          if (sid === ocId) {
            idle = true;
            break;
          }
        }
      }
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }

    const promptResult = await promptPromise;
    if (!promptResult.ok && !idle && !sawOutput) {
      yield {
        type: 'error',
        message: promptResult.error instanceof Error ? promptResult.error.message : String(promptResult.error),
      };
    }

    try {
      const finalOutput = await loadAssistantOutput(client, ocId, params.workingDirectory);
      if (finalOutput && finalOutput !== lastSnapshot) {
        lastSnapshot = finalOutput;
        yield { type: 'snapshot', output: finalOutput };
      }
      const runtimeManifest = finalOutput ? parseRuntimeManifestText(finalOutput) : null;
      if (runtimeManifest) {
        yield { type: 'artifact_manifest', manifest: runtimeManifest };
      }
    } catch {
      // Keep the run successful even if the final output fallback cannot be fetched.
    }

    if (!idle) {
      yield { type: 'status', status: 'completed' };
    }

    yield { type: 'done', exitCode: 0 };
  } finally {
    server.close();
  }
}
