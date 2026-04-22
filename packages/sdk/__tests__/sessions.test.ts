import assert from 'node:assert/strict';
import test from 'node:test';
import { CepageClient } from '../src/index.js';
import { makeFetch } from './helpers.js';

function envelope<T>(data: T) {
  return { success: true, data };
}

test('sessions.detectInputs() POSTs to /sessions/:id/detect-inputs', async () => {
  const fake = makeFetch([
    {
      body: envelope({
        sessionId: 'sess-1',
        detected: [{ name: 'TOPIC', occurrences: 2, inferredType: 'string' }],
        inputsSchema: {
          type: 'object',
          properties: { TOPIC: { type: 'string' } },
          required: ['TOPIC'],
        },
        outputsSchema: { type: 'object' },
      }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const out = await c.sessions.detectInputs('sess-1');
  assert.equal(fake.requests[0].method, 'POST');
  assert.match(fake.requests[0].url, /\/sessions\/sess-1\/detect-inputs$/);
  assert.equal(out.detected[0]?.name, 'TOPIC');
});

test('sessions.saveAsSkill() forwards the body intact', async () => {
  const fake = makeFetch([
    {
      status: 201,
      body: envelope({
        id: 'sk-1',
        slug: 'foo',
        version: '1.0.0',
        title: 'Foo',
        summary: 'bar',
        tags: [],
        inputsSchema: {},
        outputsSchema: {},
        kind: 'workflow_template',
        visibility: 'private',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const out = await c.sessions.saveAsSkill('sess-1', {
    title: 'Foo',
    summary: 'bar',
    visibility: 'private',
  });
  assert.equal(out.slug, 'foo');
  const body = JSON.parse(fake.requests[0].body!);
  assert.equal(body.title, 'Foo');
});
