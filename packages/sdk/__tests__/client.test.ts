import assert from 'node:assert/strict';
import test from 'node:test';
import { CepageClient, createCepageClient } from '../src/index.js';
import { makeFetch } from './helpers.js';

test('CepageClient trims trailing slashes from apiUrl', () => {
  const fake = makeFetch([]);
  const c = new CepageClient({ apiUrl: 'https://x.com///', fetchImpl: fake.fetch });
  assert.equal(c.apiUrl, 'https://x.com');
});

test('createCepageClient returns a ready-to-use client', async () => {
  const fake = makeFetch([
    {
      body: {
        success: true,
        data: {
          schemaVersion: '1',
          generatedAt: 'x',
          skills: [{ id: 'a', title: 'A', summary: '', version: '1', kind: 'workflow' }],
        },
      },
    },
  ]);
  const c = createCepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const skills = await c.skills.list();
  assert.equal(skills.length, 1);
});

test('defaultHeaders + userAgent are sent on every request', async () => {
  const fake = makeFetch([
    {
      body: {
        success: true,
        data: { schemaVersion: '1', generatedAt: 'x', skills: [] },
      },
    },
  ]);
  const c = new CepageClient({
    apiUrl: 'https://x.com',
    fetchImpl: fake.fetch,
    defaultHeaders: { 'x-trace-id': 't-1' },
    userAgent: 'cepage-sdk-test/1',
  });
  await c.skills.list();
  assert.equal(fake.requests[0].headers['x-trace-id'], 't-1');
  assert.equal(fake.requests[0].headers['user-agent'], 'cepage-sdk-test/1');
});

test('CepageClient constructor rejects missing apiUrl', () => {
  assert.throws(() => new CepageClient({ apiUrl: '' }));
});
