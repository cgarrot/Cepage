import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCli } from '../src/main.js';

// We exercise `cepage webhooks ...` end-to-end by overriding
// `globalThis.fetch`. That's the same surface the SDK uses inside the
// CLI context (see `apps/cli/src/context.ts`), so the test catches
// argument parsing and SDK envelope handling without standing up a
// real HTTP server.
//
// We deliberately *do not* monkey-patch process.stdout.write: node:test
// runs tests in parallel by default and interleaves its own TAP
// frames into stdout, which corrupts any captured JSON. Instead we
// assert on the recorded HTTP requests (inputs → wire) and the CLI's
// exit code — the JSON formatting itself is covered by output.test.ts.

function envelope<T>(data: T) {
  return { success: true, data };
}

interface Recorded {
  url: string;
  method: string;
  body: string | null;
}

function installFetch(
  handler: (req: Recorded) => { status?: number; body?: unknown },
): { restore: () => void; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = async (input: any, init?: any): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input?.url ?? String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      init?.body == null
        ? null
        : typeof init.body === 'string'
          ? init.body
          : JSON.stringify(init.body);
    const req: Recorded = { url, method, body };
    requests.push(req);
    const response = handler(req);
    const payload = response.body === undefined ? '' : JSON.stringify(response.body);
    return new Response(payload || null, {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  globalThis.fetch = stub as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    requests,
  };
}

async function silence<T>(run: () => Promise<T>): Promise<T> {
  // Drop stdout/stderr for the lifetime of the CLI invocation so the
  // test output stays clean. We only care about the exit code and any
  // captured fetch requests here.
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await run();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

const SAMPLE = {
  id: 'wh_1',
  url: 'https://example.test/hook',
  events: ['skill_run.completed'],
  skillId: null,
  active: true,
  description: null,
  createdAt: '2026-04-21T12:00:00.000Z',
  updatedAt: '2026-04-21T12:00:00.000Z',
};

test('cepage webhooks list hits GET /webhooks', async () => {
  const fake = installFetch(() => ({ body: envelope([SAMPLE]) }));
  try {
    const result = await silence(() =>
      runCli([
        '--api-url',
        'https://cepage.test/api/v1',
        '--token',
        'tok',
        '--json',
        'webhooks',
        'list',
      ]),
    );
    assert.equal(result, 0);
    assert.equal(fake.requests[0].method, 'GET');
    assert.match(fake.requests[0].url, /\/webhooks$/);
  } finally {
    fake.restore();
  }
});

test('cepage webhooks create posts url+events and returns success', async () => {
  const fake = installFetch(() => ({
    status: 201,
    body: envelope({ ...SAMPLE, secret: 'whsec_topsecret' }),
  }));
  try {
    const result = await silence(() =>
      runCli([
        '--api-url',
        'https://cepage.test/api/v1',
        '--token',
        'tok',
        '--no-color',
        'webhooks',
        'create',
        '--url',
        'https://example.test/hook',
        '--event',
        'skill_run.completed',
      ]),
    );
    assert.equal(result, 0);
    const req = fake.requests[0];
    assert.equal(req.method, 'POST');
    assert.match(req.url, /\/webhooks$/);
    const body = JSON.parse(req.body!);
    assert.equal(body.url, 'https://example.test/hook');
    assert.deepEqual(body.events, ['skill_run.completed']);
  } finally {
    fake.restore();
  }
});

test('cepage webhooks ping hits POST /webhooks/:id/ping', async () => {
  const fake = installFetch(() => ({
    body: envelope({ id: 'd_1', status: 'delivered', httpStatus: 204 }),
  }));
  try {
    const result = await silence(() =>
      runCli([
        '--api-url',
        'https://cepage.test/api/v1',
        '--token',
        'tok',
        '--no-color',
        'webhooks',
        'ping',
        'wh_1',
      ]),
    );
    assert.equal(result, 0);
    assert.equal(fake.requests[0].method, 'POST');
    assert.match(fake.requests[0].url, /\/webhooks\/wh_1\/ping$/);
  } finally {
    fake.restore();
  }
});

test('cepage webhooks rotate-secret hits POST /rotate-secret', async () => {
  const fake = installFetch(() => ({
    body: envelope({ ...SAMPLE, secret: 'whsec_new' }),
  }));
  try {
    const result = await silence(() =>
      runCli([
        '--api-url',
        'https://cepage.test/api/v1',
        '--token',
        'tok',
        '--no-color',
        'webhooks',
        'rotate-secret',
        'wh_1',
      ]),
    );
    assert.equal(result, 0);
    assert.equal(fake.requests[0].method, 'POST');
    assert.match(fake.requests[0].url, /\/webhooks\/wh_1\/rotate-secret$/);
  } finally {
    fake.restore();
  }
});

test('cepage webhooks create without --url fails with UsageError (exit 2)', async () => {
  const fake = installFetch(() => ({ body: envelope(null) }));
  try {
    const result = await silence(() =>
      runCli([
        '--api-url',
        'https://cepage.test/api/v1',
        '--token',
        'tok',
        'webhooks',
        'create',
      ]),
    );
    assert.equal(result, 2);
    assert.equal(fake.requests.length, 0);
  } finally {
    fake.restore();
  }
});
