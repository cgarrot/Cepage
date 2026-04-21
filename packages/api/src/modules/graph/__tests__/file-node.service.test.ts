import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { GraphNode } from '@cepage/shared-core';
import { FileNodeService } from '../file-node.service.js';

function makeNode(content: GraphNode['content']): GraphNode {
  return {
    id: 'file-1',
    type: 'file_summary',
    createdAt: '2026-04-06T10:00:00.000Z',
    updatedAt: '2026-04-06T10:00:00.000Z',
    content,
    creator: { type: 'human', userId: 'u1' },
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 180 },
    metadata: {},
    status: 'active',
    branches: [],
  };
}

function createHarness(content: GraphNode['content']) {
  const snapshot = {
    nodes: [makeNode(content)],
    edges: [],
  };
  const logs: Array<{ summary: string }> = [];
  let eventId = 10;
  const session = {
    id: 'session-1',
    workspaceParentDirectory: null as string | null,
    workspaceDirectoryName: null as string | null,
  };

  const prisma = {
    session: {
      findUnique: async () => session,
    },
  };

  const graph = {
    loadSnapshot: async () => snapshot,
    patchNode: async (_sessionId: string, _nodeId: string, patch: Partial<GraphNode>) => {
      const node = snapshot.nodes[0];
      snapshot.nodes[0] = {
        ...node,
        ...(patch.content ? { content: patch.content } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        updatedAt: new Date().toISOString(),
      };
      eventId += 1;
      return {
        eventId,
        sessionId: 'session-1',
        actor: { type: 'human', userId: 'u1' } as const,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_updated' as const, nodeId: 'file-1', patch },
      };
    },
  };

  const activity = {
    log: async (input: { summary: string }) => {
      logs.push({ summary: input.summary });
    },
  };

  return {
    session,
    snapshot,
    logs,
    service: new FileNodeService(prisma as never, graph as never, activity as never),
  };
}

test('upload appends files and auto-summarizes when the node already has a selection', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-node-'));
  const workspaceDir = path.join(dir, 'workspace');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const { session, snapshot, logs, service } = createHarness({
    files: [],
    agentType: 'opencode',
    model: { providerID: 'openai', modelID: 'gpt-5.4' },
    status: 'empty',
  });
  session.workspaceParentDirectory = dir;
  session.workspaceDirectoryName = 'workspace';
  const prompts: string[] = [];

  (service as unknown as { cwd: () => string }).cwd = () => workspaceDir;
  (service as unknown as {
    runSummary: (_cwd: string, _selection: unknown, prompt: string) => Promise<string>;
  }).runSummary = async (_cwd: string, _selection: unknown, prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes('combining multiple uploaded-file summaries')) {
      return '# Combined\n- Uploaded files summarized';
    }
    const match = prompt.match(/name: ([^\n]+)/);
    return `Summary for ${match?.[1] ?? 'file'}`;
  };

  const first = await service.upload('session-1', 'file-1', [
    {
      originalname: 'alpha.md',
      mimetype: 'text/markdown',
      size: 21,
      buffer: Buffer.from('# Alpha\nhello\n'),
    },
    {
      originalname: 'beta.ts',
      mimetype: 'text/typescript',
      size: 24,
      buffer: Buffer.from('export const beta = 1;\n'),
    },
  ]);

  const content = first.patch.content as {
    files?: Array<{ summary?: string; storage?: { kind?: string } }>;
    generatedSummary?: string;
    summary?: string;
  };
  assert.equal(content.files?.length, 2);
  assert.equal(content.files?.every((item) => item.summary?.startsWith('Summary for ')), true);
  assert.equal(content.files?.every((item) => item.storage?.kind === 'workspace'), true);
  assert.match(content.generatedSummary ?? '', /# Combined/);
  assert.match(content.summary ?? '', /# Combined/);
  assert.equal(prompts.length, 3);
  assert.match(logs[0]?.summary ?? '', /Uploaded 2 files/);

  const second = await service.upload('session-1', 'file-1', [
    {
      originalname: 'gamma.txt',
      mimetype: 'text/plain',
      size: 18,
      buffer: Buffer.from('gamma follow-up\n'),
    },
  ]);

  const next = second.patch.content as {
    files?: Array<{ file?: { name?: string }; summary?: string }>;
  };
  assert.equal(next.files?.length, 3);
  assert.equal(next.files?.[2]?.file?.name, 'gamma.txt');
  assert.match(next.files?.[2]?.summary ?? '', /Summary for gamma\.txt/);
  assert.equal((snapshot.nodes[0].content as { files?: unknown[] }).files?.length, 3);
  assert.equal(
    (await fs.readdir(path.join(workspaceDir, '.cepage', 'file-nodes', 'session-1', 'file-1', 'files'))).length,
    3,
  );
});

test('upload without selection leaves files pending until summarize is called', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'file-node-home-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'file-node-cwd-'));
  t.after(async () => {
    await Promise.all([
      fs.rm(home, { recursive: true, force: true }),
      fs.rm(cwd, { recursive: true, force: true }),
    ]);
  });

  const { snapshot, service } = createHarness({
    files: [],
    status: 'empty',
  });
  const prompts: string[] = [];

  (service as unknown as { homeRoot: () => string }).homeRoot = () => home;
  (service as unknown as { cwd: () => string }).cwd = () => cwd;
  (service as unknown as {
    runSummary: (_cwd: string, _selection: unknown, prompt: string) => Promise<string>;
  }).runSummary = async (_cwd: string, _selection: unknown, prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes('combining multiple uploaded-file summaries')) {
      return '# Combined\n- Pending files summarized';
    }
    return 'Pending file summary';
  };

  const uploaded = await service.upload('session-1', 'file-1', [
    {
      originalname: 'pending.md',
      mimetype: 'text/markdown',
      size: 20,
      buffer: Buffer.from('# Pending\nlater\n'),
    },
  ]);

  const pending = uploaded.patch.content as {
    files?: Array<{ id?: string; status?: string; summary?: string; storage?: { kind?: string } }>;
    generatedSummary?: string;
  };
  assert.equal(pending.files?.[0]?.status, 'pending');
  assert.equal(pending.files?.[0]?.summary, undefined);
  assert.equal(pending.files?.[0]?.storage?.kind, 'home');
  assert.equal(pending.generatedSummary, undefined);
  assert.equal(prompts.length, 0);
  assert.equal((await fs.readdir(path.join(home, 'session-1', 'file-1', 'files'))).length, 1);

  const summarized = await service.summarize('session-1', 'file-1', { type: 'opencode' });
  const next = summarized.patch.content as {
    files?: Array<{ status?: string; summary?: string }>;
    generatedSummary?: string;
    summary?: string;
  };
  assert.equal(next.files?.[0]?.status, 'done');
  assert.equal(next.files?.[0]?.summary, 'Pending file summary');
  assert.match(next.generatedSummary ?? '', /# Combined/);
  assert.match(next.summary ?? '', /# Combined/);
  assert.equal(prompts.length, 2);
  assert.equal((snapshot.nodes[0].content as { agentType?: string }).agentType, 'opencode');
});

test('readAsset keeps using the stored workspace snapshot after the session workspace changes', async (t) => {
  const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-node-workspace-a-'));
  const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-node-workspace-b-'));
  t.after(async () => {
    await Promise.all([
      fs.rm(firstRoot, { recursive: true, force: true }),
      fs.rm(secondRoot, { recursive: true, force: true }),
    ]);
  });

  const { session, service } = createHarness({
    files: [],
    status: 'empty',
  });
  session.workspaceParentDirectory = firstRoot;
  session.workspaceDirectoryName = 'workspace-a';

  const uploaded = await service.upload('session-1', 'file-1', [
    {
      originalname: 'carry.txt',
      mimetype: 'text/plain',
      size: 13,
      buffer: Buffer.from('carry-forward'),
    },
  ]);
  const content = uploaded.patch.content as {
    files?: Array<{ id?: string; storage?: { kind?: string; parentDirectory?: string; directoryName?: string } }>;
  };
  assert.equal(content.files?.[0]?.storage?.kind, 'workspace');
  assert.equal(content.files?.[0]?.storage?.parentDirectory, firstRoot);
  assert.equal(content.files?.[0]?.storage?.directoryName, 'workspace-a');

  session.workspaceParentDirectory = secondRoot;
  session.workspaceDirectoryName = 'workspace-b';

  const asset = await service.readAsset('session-1', 'file-1', content.files?.[0]?.id);
  assert.equal(asset.data.toString('utf8'), 'carry-forward');
});

test('readAsset falls back to legacy repo storage paths', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-node-legacy-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const { service } = createHarness({
    files: [
      {
        id: 'legacy-file',
        file: {
          name: 'legacy.txt',
          mimeType: 'text/plain',
          size: 14,
          kind: 'text',
          uploadedAt: '2026-04-06T10:00:00.000Z',
          extension: '.txt',
        },
        status: 'done',
      },
    ],
    status: 'done',
  });
  (service as unknown as { legacyRoot: () => string }).legacyRoot = () => dir;

  const filePath = path.join(dir, 'session-1', 'file-1', 'files', 'legacy-file.txt');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'legacy-path');

  const first = await service.readAsset('session-1', 'file-1', 'legacy-file');
  assert.equal(first.data.toString('utf8'), 'legacy-path');

  await fs.rm(filePath, { force: true });
  const assetPath = path.join(dir, 'session-1', 'file-1', 'asset.txt');
  await fs.mkdir(path.dirname(assetPath), { recursive: true });
  await fs.writeFile(assetPath, 'legacy-asset');

  const second = await service.readAsset('session-1', 'file-1', 'legacy-file');
  assert.equal(second.data.toString('utf8'), 'legacy-asset');
});
