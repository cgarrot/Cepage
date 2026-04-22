import assert from 'node:assert/strict';
import test from 'node:test';
import { CepageClient } from '../src/index.js';
import { makeFetch, sseFrame, sseStream } from './helpers.js';

function envelope<T>(data: T) {
  return { success: true, data };
}

test('skills.list() parses the WorkflowSkillCatalog response', async () => {
  const fake = makeFetch([
    {
      body: envelope({
        schemaVersion: '1',
        generatedAt: '2026-04-21',
        skills: [{ id: 'a', title: 'A', summary: 's', version: '1', kind: 'workflow' }],
      }),
    },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const skills = await c.skills.list();
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.id, 'a');
});

test('skills.list() forwards kind filter as a comma-joined query', async () => {
  const fake = makeFetch([
    { body: envelope({ schemaVersion: '1', generatedAt: 'x', skills: [] }) },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.skills.list({ kind: ['workflow_template', 'prompt_only'] });
  assert.match(fake.requests[0].url, /kind=workflow_template%2Cprompt_only/);
});

test('skills.listUserSkills() unwraps array results', async () => {
  const fake = makeFetch([
    { body: envelope([{ id: 'u1', slug: 'foo', title: 'Foo' }]) },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const rows = await c.skills.listUserSkills();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.slug, 'foo');
});

test('skills.run() triggers, then polls until a terminal SSE event', async () => {
  const stream = sseStream([
    sseFrame('snapshot', { id: 'run-1', status: 'queued' }),
    sseFrame('started', { id: 'run-1', status: 'running' }),
    sseFrame('succeeded', { id: 'run-1', status: 'succeeded' }),
  ]);

  const fake = makeFetch(() => {
    const call = fake.requests[fake.requests.length - 1];
    if (call.method === 'POST' && call.url.endsWith('/skills/foo/runs')) {
      return { body: envelope({ id: 'run-1', status: 'queued', skillId: 'foo', inputs: {} }) };
    }
    if (call.method === 'GET' && call.url.includes('/skill-runs/run-1/stream')) {
      return { stream };
    }
    if (call.method === 'GET' && call.url.endsWith('/skill-runs/run-1')) {
      return {
        body: envelope({
          id: 'run-1',
          status: 'succeeded',
          skillId: 'foo',
          inputs: {},
          outputs: { reportMd: 'hi' },
          createdAt: 'now',
          updatedAt: 'now',
        }),
      };
    }
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'nope' } } };
  });

  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const run = await c.skills.run('foo', { inputs: { topic: 'ok' }, timeoutMs: 5000 });
  assert.equal(run.status, 'succeeded');
  assert.deepEqual(run.outputs, { reportMd: 'hi' });
});

test('skills.run({ wait: false }) returns the queued record without polling', async () => {
  const fake = makeFetch([
    { body: envelope({ id: 'run-9', status: 'queued', skillId: 'foo', inputs: {} }) },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  const run = await c.skills.run('foo', { inputs: {}, wait: false });
  assert.equal(run.status, 'queued');
  assert.equal(fake.requests.length, 1);
});

test('skills.run() forwards triggeredBy=sdk by default', async () => {
  const fake = makeFetch([
    { body: envelope({ id: 'run-2', status: 'succeeded', skillId: 'foo', inputs: {} }) },
  ]);
  const c = new CepageClient({ apiUrl: 'https://x.com', fetchImpl: fake.fetch });
  await c.skills.run('foo', { inputs: { a: 1 } });
  assert.deepEqual(JSON.parse(fake.requests[0].body!), {
    inputs: { a: 1 },
    triggeredBy: 'sdk',
  });
});
