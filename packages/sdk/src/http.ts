// Minimal fetch-based HTTP transport for the Cepage SDK.
//
// We intentionally do NOT depend on axios/undici/got so that the SDK
// runs unchanged in Node 20+, Deno, Bun, and browsers. All the SDK
// needs is the global `fetch`, which is standard in every supported
// runtime. (Consumers on ancient Node <18 should polyfill themselves —
// we advertise `engines.node: >=20.9.0`.)
//
// The transport is shaped around two conveniences:
//   - automatic JSON encoding/decoding,
//   - structured error mapping: 400 with {code: "INVALID_INPUT"} → CepageValidationError,
//                               other 4xx/5xx                   → CepageHttpError,
//                               transport failures               → Error with cause.
//
// It also exposes a streaming helper for SSE (skill run stream).

import {
  CepageHttpError,
  CepageTimeoutError,
  CepageValidationError,
  type CepageErrorPayload,
} from './errors.js';
import type { SkillRunEvent } from './types.js';

export interface HttpTransportOptions {
  apiUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  accept?: string;
}

export class HttpTransport {
  readonly apiUrl: string;
  readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpTransportOptions) {
    if (!options.apiUrl || typeof options.apiUrl !== 'string') {
      throw new Error('HttpTransport: apiUrl is required.');
    }
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? `@cepage/sdk`;
    this.defaultHeaders = options.defaultHeaders ?? {};
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'HttpTransport: global fetch is not available and no fetchImpl was provided. Upgrade to Node 20+ or pass fetchImpl.',
      );
    }
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/json',
      'user-agent': this.userAgent,
      ...this.defaultHeaders,
      ...(options.headers ?? {}),
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    let body: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'string' || options.body instanceof Uint8Array) {
        body = options.body as BodyInit;
        headers['content-type'] = headers['content-type'] ?? 'application/octet-stream';
      } else {
        body = JSON.stringify(options.body);
        headers['content-type'] = 'application/json';
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: options.signal,
      });
    } catch (err) {
      throw new Error(
        `Network request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const raw = await response.text();
    const parsed = raw ? safeParseJson(raw) : null;

    if (!response.ok) {
      const errorPayload = extractErrorPayload(parsed);
      const message =
        errorPayload.message ?? response.statusText ?? `HTTP ${response.status}`;
      if (response.status === 400 && errorPayload.code === 'INVALID_INPUT') {
        throw new CepageValidationError(response.status, message, errorPayload);
      }
      throw new CepageHttpError(
        response.status,
        message,
        (parsed as CepageErrorPayload | null) ?? raw ?? null,
      );
    }

    return unwrapEnvelope<T>(parsed, raw);
  }

  async *stream(path: string, options: RequestOptions = {}): AsyncGenerator<SkillRunEvent> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      'user-agent': this.userAgent,
      ...this.defaultHeaders,
      ...(options.headers ?? {}),
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers,
      signal: options.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new CepageHttpError(response.status, `HTTP ${response.status}`, raw || null);
    }
    if (!response.body) {
      throw new Error(`SSE stream ${url} has no response body.`);
    }

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = parseSseFrame(frame);
          if (event) yield event;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // best-effort; reader may already be closed
      }
    }
  }

  buildUrl(path: string, query?: RequestOptions['query']): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const base = `${this.apiUrl}${normalized}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Cepage wraps every success response as { success: true, data: ... }
// and every error response as { success: false, error: { code, message, ... } }
// (see packages/shared-core/src/api.ts). The SDK unwraps those so callers
// see the raw payload, and maps the error envelope onto CepageHttpError.
function unwrapEnvelope<T>(parsed: unknown, raw: string): T {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.success === true && 'data' in obj) {
      return obj.data as T;
    }
  }
  return (parsed ?? (raw as unknown)) as T;
}

function extractErrorPayload(parsed: unknown): CepageErrorPayload {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.success === false && obj.error && typeof obj.error === 'object') {
      const error = obj.error as CepageErrorPayload;
      const details = error.details as
        | { errors?: CepageErrorPayload['errors'] }
        | undefined;
      return {
        code: error.code,
        message: error.message,
        errors: error.errors ?? details?.errors,
        ...error,
      };
    }
    return obj as CepageErrorPayload;
  }
  return {};
}

function parseSseFrame(frame: string): SkillRunEvent | null {
  let type = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      type = line.slice(6).trim() || 'message';
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { type, data };
}

export { CepageTimeoutError };
