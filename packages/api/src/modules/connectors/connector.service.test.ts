import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import type { GraphEdge, GraphNode } from '@cepage/shared-core';
import { ConnectorService } from './connector.service.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-15T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-15T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator ?? { type: 'system', reason: 'test' },
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 320, height: 180 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function edge(input: Pick<GraphEdge, 'id' | 'source' | 'target' | 'relation' | 'direction'>): GraphEdge {
  return {
    id: input.id,
    source: input.source,
    target: input.target,
    relation: input.relation,
    direction: input.direction,
    strength: 1,
    createdAt: '2026-04-15T10:00:00.000Z',
    creator: { type: 'system', reason: 'test' },
    metadata: {},
  };
}

function createGraph(nodes: GraphNode[]) {
  let nodeCount = 0;
  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-15T10:00:00.000Z',
    lastEventId: 1,
    nodes: [...nodes],
    edges: [] as GraphEdge[],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  return {
    snapshot,
    graph: {
      loadSnapshot: async () => snapshot,
      addNode: async (_sessionId: string, input: Record<string, unknown>) => {
        const created = node({
          id: `${String(input.type)}-${++nodeCount}`,
          type: input.type as GraphNode['type'],
          content: (input.content as GraphNode['content']) ?? {},
          creator: (input.creator as GraphNode['creator']) ?? { type: 'system', reason: 'test' },
          position: (input.position as GraphNode['position']) ?? { x: 0, y: 0 },
          dimensions: (input.dimensions as GraphNode['dimensions']) ?? { width: 320, height: 180 },
          metadata: (input.metadata as Record<string, unknown>) ?? {},
          status: (input.status as GraphNode['status']) ?? 'active',
          branches: (input.branches as string[]) ?? [],
        });
        snapshot.nodes.push(created);
        return {
          eventId: snapshot.lastEventId + nodeCount,
          sessionId: 'session-1',
          actor: created.creator,
          timestamp: new Date().toISOString(),
          payload: { type: 'node_added' as const, node: created },
        };
      },
      patchNode: async (_sessionId: string, nodeId: string, patch: Partial<GraphNode>) => {
        const index = snapshot.nodes.findIndex((entry) => entry.id === nodeId);
        assert.notEqual(index, -1);
        snapshot.nodes[index] = {
          ...snapshot.nodes[index]!,
          ...patch,
          metadata: patch.metadata ?? snapshot.nodes[index]!.metadata,
          content: patch.content ?? snapshot.nodes[index]!.content,
          updatedAt: new Date().toISOString(),
        };
      },
      addEdge: async (_sessionId: string, input: { source: string; target: string; relation: GraphEdge['relation']; direction?: GraphEdge['direction']; creator: GraphEdge['creator'] }) => {
        snapshot.edges.push(
          edge({
            id: `edge-${snapshot.edges.length + 1}`,
            source: input.source,
            target: input.target,
            relation: input.relation,
            direction: input.direction ?? 'source_to_target',
          }),
        );
      },
    },
  };
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('SERVER_ADDRESS_INVALID');
  }
  return address.port;
}

test('ConnectorService executes HTTP targets from file inputs and writes JSON outputs', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-connector-http-'));
  const workspace = path.join(parent, 'session-1');
  await fs.mkdir(path.join(workspace, 'inputs'), { recursive: true });
  await fs.writeFile(
    path.join(workspace, 'inputs', 'url.json'),
    JSON.stringify({ url: 'placeholder' }, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(workspace, 'inputs', 'body.json'),
    JSON.stringify({ prompt: 'Write a dark drill hook' }, null, 2),
    'utf8',
  );
  t.after(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, received: body.prompt }));
  });
  const port = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  await fs.writeFile(
    path.join(workspace, 'inputs', 'url.json'),
    JSON.stringify({ url: `http://127.0.0.1:${port}/lyrics` }, null, 2),
    'utf8',
  );

  const { graph, snapshot } = createGraph([
    node({
      id: 'connector-http',
      type: 'connector_target',
      content: {
        kind: 'http',
        title: 'Lyrics',
        method: 'POST',
        url: { path: 'inputs/url.json', jsonPath: 'url' },
        body: { kind: 'file', path: 'inputs/body.json', format: 'json' },
        output: { path: 'outputs/lyrics.json', format: 'json' },
        metadataPath: 'outputs/lyrics.metadata.json',
      },
    }),
  ]);

  const service = new ConnectorService(
    graph as never,
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: parent,
          workspaceDirectoryName: 'session-1',
        }),
      },
    } as never,
  );

  const result = await service.executeQueuedConnectorJob({
    sessionId: 'session-1',
    targetNodeId: 'connector-http',
  });

  assert.equal(result.status, 'completed');
  const output = JSON.parse(await fs.readFile(path.join(workspace, 'outputs', 'lyrics.json'), 'utf8'));
  assert.equal(output.ok, true);
  assert.equal(output.received, 'Write a dark drill hook');
  const metadata = JSON.parse(await fs.readFile(path.join(workspace, 'outputs', 'lyrics.metadata.json'), 'utf8'));
  assert.equal(metadata.httpStatus, 200);
  assert.equal(snapshot.nodes.some((entry) => entry.type === 'connector_run'), true);
});

test('ConnectorService executes process targets and captures stdout', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-connector-process-'));
  const workspace = path.join(parent, 'session-1');
  await fs.mkdir(workspace, { recursive: true });
  t.after(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  const { graph } = createGraph([
    node({
      id: 'connector-process',
      type: 'connector_target',
      content: {
        kind: 'process',
        title: 'Echo',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("mp3-ready")'],
        cwd: '.',
        stdoutPath: 'outputs/stdout.txt',
        metadataPath: 'outputs/stdout.metadata.json',
      },
    }),
  ]);

  const service = new ConnectorService(
    graph as never,
    {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          workspaceParentDirectory: parent,
          workspaceDirectoryName: 'session-1',
        }),
      },
    } as never,
  );

  const result = await service.executeQueuedConnectorJob({
    sessionId: 'session-1',
    targetNodeId: 'connector-process',
  });

  assert.equal(result.status, 'completed');
  const stdout = await fs.readFile(path.join(workspace, 'outputs', 'stdout.txt'), 'utf8');
  assert.equal(stdout, 'mp3-ready');
  const metadata = JSON.parse(await fs.readFile(path.join(workspace, 'outputs', 'stdout.metadata.json'), 'utf8'));
  assert.equal(metadata.exitCode, 0);
});
