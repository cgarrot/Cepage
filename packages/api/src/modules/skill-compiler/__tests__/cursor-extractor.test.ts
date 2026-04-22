import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { CursorExtractorService } from '../extractors/cursor-extractor.service.js';

async function createSyntheticDb(
  dir: string,
  name: string,
  opts: {
    userVersion?: number;
    meta?: Array<{ key: string; value: unknown }>;
    blobs?: Array<{ id: string; data: unknown }>;
  },
): Promise<string> {
  const dbPath = path.join(dir, name);
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value BLOB);
    CREATE TABLE IF NOT EXISTS blobs(id TEXT PRIMARY KEY, data BLOB);
  `);

  if (opts.userVersion !== undefined) {
    db.exec(`PRAGMA user_version = ${opts.userVersion}`);
  }

  if (opts.meta) {
    const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const row of opts.meta) {
      insert.run(row.key, Buffer.from(JSON.stringify(row.value)));
    }
  }

  if (opts.blobs) {
    const insert = db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)');
    for (const row of opts.blobs) {
      insert.run(row.id, Buffer.from(JSON.stringify(row.data)));
    }
  }

  db.close();
  return dbPath;
}

test('CursorExtractorService.detectSchemaVersion returns version 1', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'v1.db', { userVersion: 1 });
  const svc = new CursorExtractorService();
  assert.strictEqual(svc.detectSchemaVersion(dbPath), 1);
  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.detectSchemaVersion returns unknown for missing file', async () => {
  const svc = new CursorExtractorService();
  assert.strictEqual(svc.detectSchemaVersion('/nonexistent/path/store.db'), 'unknown');
});

test('CursorExtractorService.parse handles empty database', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'empty.db', { userVersion: 1 });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);
  assert.strictEqual(result.nodes.length, 0);
  assert.strictEqual(result.edges.length, 0);
  assert.deepStrictEqual(result.warnings, []);
  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse maps user and assistant messages', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'messages.db', {
    userVersion: 1,
    blobs: [
      { id: 'blob-1', data: { type: 'user', content: 'Hello' } },
      { id: 'blob-2', data: { type: 'assistant', content: 'Hi there' } },
    ],
  });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  assert.strictEqual(result.nodes.length, 2);
  assert.strictEqual(result.nodes[0].type, 'human_message');
  assert.strictEqual(result.nodes[0].content.content, 'Hello');
  assert.strictEqual(result.nodes[1].type, 'agent_output');
  assert.strictEqual(result.nodes[1].content.content, 'Hi there');

  assert.strictEqual(result.edges.length, 1);
  assert.strictEqual(result.edges[0].relation, 'responds_to');
  assert.strictEqual(result.edges[0].source, result.nodes[0].id);
  assert.strictEqual(result.edges[0].target, result.nodes[1].id);

  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse maps tool calls', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'tools.db', {
    userVersion: 1,
    blobs: [
      {
        id: 'blob-1',
        data: {
          type: 'user',
          content: 'Run a command',
        },
      },
      {
        id: 'blob-2',
        data: {
          type: 'assistant',
          content: 'Running',
          toolCalls: [
            { name: 'Shell', input: { command: 'ls -la' } },
            { name: 'Write', input: { path: '/tmp/test.txt', content: 'hello' } },
            { name: 'Read', input: { path: '/tmp/test.txt' } },
          ],
        },
      },
    ],
  });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  assert.strictEqual(result.nodes.length, 5);

  const toolNodes = result.nodes.filter((n) => n.id.startsWith('tool-'));
  assert.strictEqual(toolNodes.length, 3);

  const shellNode = toolNodes.find((n) => n.type === 'runtime_run');
  assert.ok(shellNode);
  assert.strictEqual(shellNode.content.command, 'ls -la');

  const writeNode = toolNodes.find((n) => n.type === 'file_diff');
  assert.ok(writeNode);
  assert.strictEqual(writeNode.content.path, '/tmp/test.txt');
  assert.strictEqual(writeNode.content.content, 'hello');

  const readNode = toolNodes.find((n) => n.type === 'workspace_file');
  assert.ok(readNode);
  assert.strictEqual(readNode.content.path, '/tmp/test.txt');

  assert.strictEqual(result.edges.length, 4);

  const producesEdges = result.edges.filter((e) => e.relation === 'produces');
  assert.strictEqual(producesEdges.length, 3);

  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse maps unknown tool to agent_step with warning', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'unknown-tool.db', {
    userVersion: 1,
    blobs: [
      {
        id: 'blob-1',
        data: {
          type: 'assistant',
          content: 'Doing something',
          toolCalls: [{ name: 'UnknownTool', input: { foo: 'bar' } }],
        },
      },
    ],
  });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  const toolNode = result.nodes.find((n) => n.id.startsWith('tool-'));
  assert.ok(toolNode);
  assert.strictEqual(toolNode.type, 'agent_step');
  assert.strictEqual(toolNode.content.toolName, 'UnknownTool');
  assert.ok(result.warnings.some((w) => w.includes('Unknown tool type')));

  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse skips malformed blobs with warning', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = path.join(tmpDir, 'malformed.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB);
    PRAGMA user_version = 1;
  `);
  db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run('blob-1', Buffer.from('not json'));
  db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run('blob-2', Buffer.from(JSON.stringify({ type: 'user', content: 'valid' })));
  db.close();

  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  assert.strictEqual(result.nodes.length, 1);
  assert.strictEqual(result.nodes[0].type, 'human_message');
  assert.ok(result.warnings.some((w) => w.includes('Failed to parse blob')));

  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse handles unknown schema version gracefully', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'v99.db', {
    userVersion: 99,
    blobs: [{ id: 'blob-1', data: { type: 'user', content: 'Hello' } }],
  });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  assert.strictEqual(result.nodes.length, 1);
  assert.ok(result.warnings.some((w) => w.includes('Schema version 99')));

  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse extracts meta table', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'meta.db', {
    userVersion: 1,
    meta: [
      { key: 'sessionId', value: 'sess-123' },
      { key: 'title', value: 'Test Session' },
    ],
    blobs: [],
  });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  assert.strictEqual(result.metadata.sessionId, 'sess-123');
  assert.strictEqual(result.metadata.title, 'Test Session');

  await fs.rm(tmpDir, { recursive: true });
});

test('CursorExtractorService.parse achieves >=80% mapping coverage', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-test-'));
  const dbPath = await createSyntheticDb(tmpDir, 'coverage.db', {
    userVersion: 1,
    blobs: [
      { id: 'blob-1', data: { type: 'user', content: 'A' } },
      { id: 'blob-2', data: { type: 'assistant', content: 'B' } },
      { id: 'blob-3', data: { type: 'user', content: 'C' } },
      { id: 'blob-4', data: { type: 'assistant', content: 'D' } },
      { id: 'blob-5', data: { type: 'assistant', content: 'E', toolCalls: [{ name: 'Shell', input: { command: 'echo hi' } }] } },
    ],
  });
  const svc = new CursorExtractorService();
  const result = svc.parse(dbPath);

  const totalBlobs = 5;
  const mappedNodes = result.nodes.filter((n) => n.id.startsWith('msg-')).length;
  const coverage = mappedNodes / totalBlobs;
  assert.ok(coverage >= 0.8, `Expected >=80% coverage, got ${coverage * 100}%`);

  await fs.rm(tmpDir, { recursive: true });
});
