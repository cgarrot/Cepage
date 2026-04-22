import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpTransport, CepageHttpError, CepageValidationError } from '../src/index.js';
import { makeFetch } from './helpers.js';

test('request GET returns parsed JSON and injects auth header', async () => {
  const fake = makeFetch([
    { status: 200, body: { success: true, data: { ok: true } } },
  ]);
  const http = new HttpTransport({
    apiUrl: 'https://api.cepage.dev/api/v1/',
    token: 'live-token',
    fetchImpl: fake.fetch,
  });
  const result = await http.request<{ ok: boolean }>('GET', '/workflow-skills');
  assert.deepEqual(result, { ok: true });
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].url, 'https://api.cepage.dev/api/v1/workflow-skills');
  assert.equal(fake.requests[0].headers.authorization, 'Bearer live-token');
  assert.equal(fake.requests[0].headers.accept, 'application/json');
});

test('request unwraps the { success, data } envelope used by every Cepage route', async () => {
  const fake = makeFetch([
    {
      status: 200,
      body: { success: true, data: [{ id: 'r1' }, { id: 'r2' }] },
    },
  ]);
  const http = new HttpTransport({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const result = await http.request<Array<{ id: string }>>('GET', '/skill-runs');
  assert.deepEqual(result, [{ id: 'r1' }, { id: 'r2' }]);
});

test('request passes raw JSON through when there is no envelope', async () => {
  const fake = makeFetch([{ status: 200, body: { id: 'x' } }]);
  const http = new HttpTransport({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const result = await http.request<{ id: string }>('GET', '/anything');
  assert.deepEqual(result, { id: 'x' });
});

test('request POST JSON-encodes the body and applies content-type', async () => {
  const fake = makeFetch([
    { status: 200, body: { success: true, data: { id: 'r1' } } },
  ]);
  const http = new HttpTransport({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await http.request('POST', '/skills/foo/runs', { body: { inputs: { a: 1 } } });
  const req = fake.requests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(req.body!), { inputs: { a: 1 } });
});

test('request appends query parameters and skips nullish values', async () => {
  const fake = makeFetch([{ status: 200, body: { success: true, data: [] } }]);
  const http = new HttpTransport({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await http.request('GET', '/skill-runs', {
    query: { skillId: 'abc', limit: 10, kind: undefined, includeAll: true },
  });
  assert.equal(
    fake.requests[0].url,
    'https://x.com/skill-runs?skillId=abc&limit=10&includeAll=true',
  );
});

test('4xx responses throw CepageHttpError with status and parsed body', async () => {
  const fake = makeFetch([
    {
      status: 403,
      body: {
        success: false,
        error: { code: 'FORBIDDEN', message: 'You cannot run this skill.' },
      },
    },
  ]);
  const http = new HttpTransport({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await assert.rejects(
    () => http.request('POST', '/skills/foo/runs', { body: {} }),
    (err: unknown) => {
      assert.ok(err instanceof CepageHttpError);
      assert.equal(err.status, 403);
      assert.match(err.message, /cannot run/i);
      return true;
    },
  );
});

test('400 INVALID_INPUT surfaces a CepageValidationError with AJV errors', async () => {
  const fake = makeFetch([
    {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Input failed validation.',
          errors: [{ path: '/startDate', message: 'required', keyword: 'required' }],
        },
      },
    },
  ]);
  const http = new HttpTransport({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await assert.rejects(
    () => http.request('POST', '/skills/foo/runs', { body: {} }),
    (err: unknown) => {
      assert.ok(err instanceof CepageValidationError);
      assert.equal(err.status, 400);
      assert.equal(err.errors[0]?.path, '/startDate');
      return true;
    },
  );
});

test('HttpTransport throws a clear error when fetch is unavailable', () => {
  const original = globalThis.fetch;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = undefined;
    assert.throws(
      () =>
        new HttpTransport({
          apiUrl: 'https://x.com',
          fetchImpl: undefined as unknown as typeof fetch,
        }),
      /fetch is not available/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
