import assert from 'node:assert/strict';
import test from 'node:test';
import { CepageClient } from '../src/index.js';
import { makeFetch } from './helpers.js';

function envelope<T>(data: T) {
  return { success: true, data };
}

test('schedules.list() returns an array from the success envelope', async () => {
  const fake = makeFetch([
    {
      body: envelope([
        {
          id: 's1',
          skillId: 'foo',
          cron: '0 9 * * 1',
          request: {},
          status: 'active',
          nextRunAt: 'x',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ]),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const items = await c.schedules.list();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, 's1');
});

test('schedules.create() posts the JSON body to /scheduled-skill-runs', async () => {
  const fake = makeFetch([
    {
      status: 201,
      body: envelope({
        id: 's1',
        skillId: 'foo',
        cron: '0 9 * * 1',
        request: {},
        status: 'active',
        nextRunAt: '2026-04-28',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const out = await c.schedules.create({
    skillId: 'foo',
    cron: '0 9 * * 1',
    request: { inputs: {} },
  });
  assert.equal(out.id, 's1');
  assert.equal(fake.requests[0].method, 'POST');
  assert.match(fake.requests[0].url, /\/scheduled-skill-runs$/);
  const body = JSON.parse(fake.requests[0].body!);
  assert.equal(body.skillId, 'foo');
});

test('schedules.runNow() hits /run-now', async () => {
  const fake = makeFetch([
    {
      body: envelope({
        id: 's1',
        skillId: 'foo',
        cron: '0 * * * *',
        request: {},
        status: 'active',
        nextRunAt: '1',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.schedules.runNow('s1');
  assert.match(fake.requests[0].url, /\/scheduled-skill-runs\/s1\/run-now$/);
  assert.equal(fake.requests[0].method, 'POST');
});

test('schedules.update() uses PATCH', async () => {
  const fake = makeFetch([
    {
      body: envelope({
        id: 's1',
        skillId: 'foo',
        cron: '0 * * * *',
        request: {},
        status: 'paused',
        nextRunAt: '1',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.schedules.update('s1', { status: 'paused' });
  assert.equal(fake.requests[0].method, 'PATCH');
});

test('schedules.delete() uses DELETE', async () => {
  const fake = makeFetch([{ status: 200, body: envelope({}) }]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.schedules.delete('s1');
  assert.equal(fake.requests[0].method, 'DELETE');
});
