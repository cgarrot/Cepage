// Test helpers for the Cepage SDK.
//
// We don't spin up a real HTTP server — every test installs a fake
// `fetch` that captures requests and returns scripted responses. This
// keeps tests deterministic and fast, and mirrors how the SDK is
// actually embedded inside downstream Node/browser apps.

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  // If provided, returned instead of a JSON body. Useful for SSE.
  stream?: ReadableStream<Uint8Array>;
}

export interface FakeFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

export function makeFetch(responses: FakeResponse[] | ((req: RecordedRequest) => FakeResponse)): FakeFetch {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const impl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = flattenHeaders(init.headers as HeadersInit | undefined);
    const body =
      init.body == null
        ? null
        : typeof init.body === 'string'
          ? init.body
          : init.body instanceof Uint8Array
            ? new TextDecoder().decode(init.body)
            : JSON.stringify(init.body);
    const req: RecordedRequest = { url, method, headers, body };
    requests.push(req);

    const response =
      typeof responses === 'function' ? responses(req) : responses[index++] ?? { status: 200 };
    if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));

    if (response.stream) {
      return new Response(response.stream, {
        status: response.status ?? 200,
        headers: {
          'content-type': 'text/event-stream',
          ...(response.headers ?? {}),
        },
      });
    }

    const bodyText =
      response.body === undefined
        ? ''
        : typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body);

    return new Response(bodyText || null, {
      status: response.status ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(response.headers ?? {}),
      },
    });
  };
  return { fetch: impl, requests };
}

function flattenHeaders(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[k.toLowerCase()] = String(v);
    return out;
  }
  if (typeof (init as Headers).forEach === 'function') {
    (init as Headers).forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  for (const [k, v] of Object.entries(init as Record<string, string>)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

export function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
        await new Promise((r) => setTimeout(r, 1));
      }
      controller.close();
    },
  });
}

export function sseFrame(type: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${type}\ndata: ${payload}\n\n`;
}
