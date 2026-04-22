import assert from 'node:assert/strict';
import test from 'node:test';
import { CepageClient } from '../src/index.js';
import { makeFetch } from './helpers.js';

function envelope<T>(data: T) {
  return { success: true, data };
}

const SAMPLE = {
  id: 'wh_1',
  url: 'https://example.test/hook',
  events: ['skill_run.completed'],
  skillId: null,
  active: true,
  description: null,
  createdAt: 't',
  updatedAt: 't',
};

test('webhooks.list() unwraps the envelope into an array', async () => {
  const fake = makeFetch([{ body: envelope([SAMPLE]) }]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const items = await c.webhooks.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'wh_1');
  assert.equal(fake.requests[0].method, 'GET');
  assert.match(fake.requests[0].url, /\/webhooks$/);
});

test('webhooks.create() returns the secret exactly once', async () => {
  const fake = makeFetch([
    {
      status: 201,
      body: envelope({ ...SAMPLE, secret: 'whsec_XYZ' }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const created = await c.webhooks.create({
    url: 'https://example.test/hook',
    events: ['skill_run.completed'],
  });
  assert.equal(created.secret, 'whsec_XYZ');
  assert.equal(fake.requests[0].method, 'POST');
  const body = JSON.parse(fake.requests[0].body!);
  assert.equal(body.url, 'https://example.test/hook');
});

test('webhooks.update() sends a PATCH', async () => {
  const fake = makeFetch([{ body: envelope({ ...SAMPLE, active: false }) }]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.webhooks.update('wh_1', { active: false });
  assert.equal(fake.requests[0].method, 'PATCH');
});

test('webhooks.delete() sends a DELETE', async () => {
  const fake = makeFetch([{ status: 200, body: envelope(null) }]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.webhooks.delete('wh_1');
  assert.equal(fake.requests[0].method, 'DELETE');
  assert.match(fake.requests[0].url, /\/webhooks\/wh_1$/);
});

test('webhooks.ping() hits /ping', async () => {
  const fake = makeFetch([
    {
      body: envelope({ id: 'd_1', status: 'delivered', httpStatus: 200 }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const result = await c.webhooks.ping('wh_1');
  assert.equal(result.status, 'delivered');
  assert.equal(result.httpStatus, 200);
  assert.match(fake.requests[0].url, /\/webhooks\/wh_1\/ping$/);
  assert.equal(fake.requests[0].method, 'POST');
});

test('webhooks.rotateSecret() returns a fresh secret', async () => {
  const fake = makeFetch([
    {
      body: envelope({ ...SAMPLE, secret: 'whsec_NEW' }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const rotated = await c.webhooks.rotateSecret('wh_1');
  assert.equal(rotated.secret, 'whsec_NEW');
  assert.match(fake.requests[0].url, /\/webhooks\/wh_1\/rotate-secret$/);
  assert.equal(fake.requests[0].method, 'POST');
});
