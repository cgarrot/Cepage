import assert from 'node:assert/strict';
import test from 'node:test';
import { CepageClient } from '../src/index.js';
import { makeFetch, sseFrame, sseStream } from './helpers.js';

function envelope<T>(data: T) {
  return { success: true, data };
}

test('runs.list() returns the unwrapped array', async () => {
  const fake = makeFetch([{ body: envelope([{ id: 'a' }, { id: 'b' }]) }]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  assert.equal((await c.runs.list()).length, 2);
});

test('runs.cancel() POSTs to /skill-runs/:id/cancel', async () => {
  const fake = makeFetch([
    { body: envelope({ id: 'r1', status: 'cancelled', skillId: 'foo', inputs: {} }) },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const res = await c.runs.cancel('r1');
  assert.equal(res.status, 'cancelled');
  assert.equal(fake.requests[0].method, 'POST');
  assert.match(fake.requests[0].url, /\/skill-runs\/r1\/cancel$/);
});

test('runs.stream() yields parsed SSE events', async () => {
  const stream = sseStream([
    sseFrame('snapshot', { id: 'r1', status: 'queued' }),
    sseFrame('progress', { step: 'thinking' }),
    sseFrame('succeeded', { id: 'r1', status: 'succeeded' }),
  ]);
  const fake = makeFetch([{ stream }]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const seen: string[] = [];
  for await (const ev of c.runs.stream('r1')) {
    seen.push(ev.type);
    if (ev.type === 'succeeded') break;
  }
  assert.deepEqual(seen, ['snapshot', 'progress', 'succeeded']);
});
