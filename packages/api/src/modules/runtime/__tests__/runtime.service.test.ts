import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  readRuntimeRunSummary,
  readRuntimeTargetSummary,
  type GraphEdge,
  type GraphNode,
  type RuntimeManifestEnvelope,
  type RuntimeRunSummary,
} from '@cepage/shared-core';
import { RuntimeService } from '../runtime.service.js';

function node(input: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type'>): GraphNode {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    content: input.content ?? {},
    creator: input.creator ?? { type: 'system', reason: 'test' },
    position: input.position ?? { x: 0, y: 0 },
    dimensions: input.dimensions ?? { width: 320, height: 180 },
    metadata: input.metadata ?? {},
    status: input.status ?? 'active',
    branches: input.branches ?? [],
  };
}

function edge(input: Partial<GraphEdge> & Pick<GraphEdge, 'source' | 'target' | 'relation'>): GraphEdge {
  return {
    id: input.id ?? `edge-${input.source}-${input.target}-${input.relation}`,
    source: input.source,
    target: input.target,
    relation: input.relation,
    direction: input.direction ?? 'source_to_target',
    strength: input.strength ?? 0.5,
    createdAt: input.createdAt ?? '2026-04-03T10:00:00.000Z',
    creator: input.creator ?? { type: 'system', reason: 'test' },
    metadata: input.metadata ?? {},
  };
}

function manifest(input: Partial<RuntimeManifestEnvelope['targets'][number]> = {}): RuntimeManifestEnvelope {
  return {
    schema: 'cepage.runtime/v1',
    schemaVersion: 1,
    targets: [
      {
        kind: 'web',
        launchMode: 'local_process',
        serviceName: 'web',
        cwd: '/tmp/app',
        preview: { mode: 'static', entry: 'index.html' },
        autoRun: false,
        ...input,
      },
    ],
  };
}

function readTarget(node: GraphNode) {
  return readRuntimeTargetSummary(node.metadata) ?? readRuntimeTargetSummary(node.content);
}

function readRun(node: GraphNode) {
  return readRuntimeRunSummary(node.metadata) ?? readRuntimeRunSummary(node.content);
}

function missingRoot(name: string): string {
  return `/tmp/${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createGraph(input: { nodes: GraphNode[]; edges?: GraphEdge[] }) {
  let eventId = 0;
  let nodeId = 0;
  const removed: string[] = [];
  const snapshot = {
    version: 1 as const,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    nodes: [...input.nodes],
    edges: [...(input.edges ?? [])],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const graph = {
    loadSnapshot: async () => snapshot,
    addNode: async (_sessionId: string, inputNode: Record<string, unknown>) => {
      const id =
        typeof inputNode.id === 'string'
          ? inputNode.id
          : `${String(inputNode.type)}-${++nodeId}`;
      const next = node({
        id,
        type: inputNode.type as GraphNode['type'],
        content: (inputNode.content as GraphNode['content']) ?? {},
        creator: (inputNode.creator as GraphNode['creator']) ?? { type: 'system', reason: 'test' },
        position: (inputNode.position as GraphNode['position']) ?? { x: 0, y: 0 },
        dimensions: (inputNode.dimensions as GraphNode['dimensions']) ?? { width: 320, height: 180 },
        metadata: (inputNode.metadata as Record<string, unknown>) ?? {},
        status: (inputNode.status as GraphNode['status']) ?? 'active',
        branches: (inputNode.branches as string[]) ?? [],
      });
      snapshot.nodes.push(next);
      eventId += 1;
      return {
        eventId,
        sessionId: 'session-1',
        actor: next.creator,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_added' as const, node: next },
      };
    },
    patchNode: async (
      _sessionId: string,
      id: string,
      patch: Partial<
        Pick<GraphNode, 'content' | 'position' | 'dimensions' | 'status' | 'metadata' | 'branches'>
      >,
    ) => {
      const idx = snapshot.nodes.findIndex((entry) => entry.id === id);
      assert.notEqual(idx, -1);
      const prev = snapshot.nodes[idx]!;
      const next = {
        ...prev,
        content: patch.content ?? prev.content,
        position: patch.position ?? prev.position,
        dimensions: patch.dimensions ?? prev.dimensions,
        metadata: patch.metadata ? { ...prev.metadata, ...patch.metadata } : prev.metadata,
        status: patch.status ?? prev.status,
        branches: patch.branches ?? prev.branches,
        updatedAt: new Date().toISOString(),
      };
      snapshot.nodes[idx] = next;
      eventId += 1;
      return {
        eventId,
        sessionId: 'session-1',
        actor: { type: 'system', reason: 'test' } as const,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_updated' as const, nodeId: id, patch },
      };
    },
    addEdge: async (
      _sessionId: string,
      inputEdge: {
        source: string;
        target: string;
        relation: GraphEdge['relation'];
        direction?: GraphEdge['direction'];
        creator: GraphEdge['creator'];
        metadata?: Record<string, unknown>;
      },
    ) => {
      if (
        snapshot.edges.some(
          (entry) =>
            entry.source === inputEdge.source &&
            entry.target === inputEdge.target &&
            entry.relation === inputEdge.relation,
        )
      ) {
        throw new Error('EDGE_DUPLICATE');
      }
      const next = edge({
        id: `edge-${++eventId}`,
        source: inputEdge.source,
        target: inputEdge.target,
        relation: inputEdge.relation,
        direction: inputEdge.direction,
        creator: inputEdge.creator,
        metadata: inputEdge.metadata,
      });
      snapshot.edges.push(next);
      return {
        eventId,
        sessionId: 'session-1',
        actor: inputEdge.creator,
        timestamp: new Date().toISOString(),
        payload: { type: 'edge_added' as const, edgeId: next.id, edge: next },
      };
    },
    removeNode: async (_sessionId: string, id: string) => {
      removed.push(id);
      const affectedEdges = snapshot.edges
        .filter((entry) => entry.source === id || entry.target === id)
        .map((entry) => entry.id);
      snapshot.edges = snapshot.edges.filter((entry) => !affectedEdges.includes(entry.id));
      snapshot.nodes = snapshot.nodes.filter((entry) => entry.id !== id);
      eventId += 1;
      return {
        eventId,
        sessionId: 'session-1',
        actor: { type: 'system', reason: 'test' } as const,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_removed' as const, nodeId: id, affectedEdges },
      };
    },
  };
  return { graph, snapshot, removed };
}

test('clearAgentRun stops and removes runtime nodes for the rerun source', async () => {
  const stopped: string[] = [];
  const removed: string[] = [];
  const graph = {
    loadSnapshot: async () => ({
      version: 1 as const,
      id: 'session-1',
      createdAt: '2026-04-03T10:00:00.000Z',
      nodes: [
        node({
          id: 'runtime-target-1',
          type: 'runtime_target',
          metadata: {
            runtimeTarget: {
              targetNodeId: 'runtime-target-1',
              sourceRunId: 'run-1',
              outputNodeId: 'output-1',
              kind: 'web',
              launchMode: 'local_process',
              serviceName: 'web',
              cwd: '/tmp/work',
              autoRun: true,
              source: 'text',
            },
          },
        }),
        node({
          id: 'runtime-run-1',
          type: 'runtime_run',
          metadata: {
            runtimeRun: {
              runNodeId: 'runtime-run-1',
              targetNodeId: 'runtime-target-1',
              sourceRunId: 'run-1',
              targetKind: 'web',
              launchMode: 'local_process',
              serviceName: 'web',
              cwd: '/tmp/work',
              status: 'running',
            },
          },
        }),
        node({
          id: 'runtime-target-2',
          type: 'runtime_target',
          metadata: {
            runtimeTarget: {
              targetNodeId: 'runtime-target-2',
              sourceRunId: 'run-2',
              outputNodeId: 'output-2',
              kind: 'web',
              launchMode: 'local_process',
              serviceName: 'admin',
              cwd: '/tmp/other',
              autoRun: true,
              source: 'text',
            },
          },
        }),
      ],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    removeNode: async (_sessionId: string, nodeId: string) => {
      removed.push(nodeId);
      return {
        eventId: removed.length,
        sessionId: 'session-1',
        actor: { type: 'system', reason: 'runtime-reset' } as const,
        timestamp: new Date().toISOString(),
        payload: { type: 'node_removed' as const, nodeId, affectedEdges: [] },
      };
    },
  };

  const service = new RuntimeService(graph as never);
  (service as unknown as { stopRun: (sessionId: string, runNodeId: string) => Promise<void> }).stopRun =
    async (_sessionId: string, runNodeId: string) => {
      stopped.push(runNodeId);
    };

  await service.clearAgentRun('session-1', 'run-1');

  assert.deepEqual(stopped, ['runtime-run-1']);
  assert.deepEqual(removed, ['runtime-run-1', 'runtime-target-1']);
});

test('recoverRuns stops stale local runtime nodes and keeps reusable ones active', async () => {
  const { graph, snapshot } = createGraph({
    nodes: [
      node({
        id: 'runtime-target-local',
        type: 'runtime_target',
        metadata: {
          runtimeTarget: {
            targetNodeId: 'runtime-target-local',
            kind: 'web',
            launchMode: 'local_process',
            serviceName: 'local-web',
            cwd: '/tmp/local-web',
            command: 'pnpm dev',
            entrypoint: 'server.js',
            preview: { mode: 'server' },
            autoRun: true,
            source: 'text',
          },
        },
      }),
      node({
        id: 'runtime-run-local',
        type: 'runtime_run',
        metadata: {
          runtimeRun: {
            runNodeId: 'runtime-run-local',
            targetNodeId: 'runtime-target-local',
            targetKind: 'web',
            launchMode: 'local_process',
            serviceName: 'local-web',
            cwd: '/tmp/local-web',
            status: 'running',
            preview: {
              status: 'running',
              strategy: 'script',
              url: 'http://localhost:3000',
            },
          },
        },
      }),
      node({
        id: 'runtime-target-static',
        type: 'runtime_target',
        metadata: {
          runtimeTarget: {
            targetNodeId: 'runtime-target-static',
            kind: 'web',
            launchMode: 'local_process',
            serviceName: 'static-web',
            cwd: '/tmp/static-web',
            preview: { mode: 'static', entry: 'dist/index.html' },
            autoRun: true,
            source: 'text',
          },
        },
      }),
      node({
        id: 'runtime-run-static',
        type: 'runtime_run',
        metadata: {
          runtimeRun: {
            runNodeId: 'runtime-run-static',
            targetNodeId: 'runtime-target-static',
            targetKind: 'web',
            launchMode: 'local_process',
            serviceName: 'static-web',
            cwd: '/tmp/static-web',
            status: 'running',
            preview: {
              status: 'running',
              strategy: 'static',
              embedPath: '/preview/static',
            },
          },
        },
      }),
      node({
        id: 'runtime-target-docker',
        type: 'runtime_target',
        metadata: {
          runtimeTarget: {
            targetNodeId: 'runtime-target-docker',
            kind: 'api',
            launchMode: 'docker',
            serviceName: 'docker-api',
            cwd: '/tmp/docker-api',
            command: 'node',
            docker: {
              image: 'node:22',
            },
            autoRun: true,
            source: 'text',
          },
        },
      }),
      node({
        id: 'runtime-run-docker',
        type: 'runtime_run',
        metadata: {
          runtimeRun: {
            runNodeId: 'runtime-run-docker',
            targetNodeId: 'runtime-target-docker',
            targetKind: 'api',
            launchMode: 'docker',
            serviceName: 'docker-api',
            cwd: '/tmp/docker-api',
            status: 'running',
          },
        },
      }),
    ],
  });

  const service = new RuntimeService(graph as never);
  const count = await service.recoverRuns('session-1');

  assert.equal(count, 1);
  const local = snapshot.nodes.find((entry) => entry.id === 'runtime-run-local');
  const staticRun = snapshot.nodes.find((entry) => entry.id === 'runtime-run-static');
  const dockerRun = snapshot.nodes.find((entry) => entry.id === 'runtime-run-docker');
  assert.ok(local);
  assert.ok(staticRun);
  assert.ok(dockerRun);
  const localSummary = readRun(local);
  const staticSummary = readRun(staticRun);
  const dockerSummary = readRun(dockerRun);
  assert.ok(localSummary);
  assert.ok(staticSummary);
  assert.ok(dockerSummary);
  assert.equal(localSummary.status, 'stopped');
  assert.equal(localSummary.preview?.status, 'unavailable');
  assert.match(localSummary.error ?? '', /live process state was lost/);
  assert.equal(staticSummary.status, 'running');
  assert.equal(dockerSummary.status, 'running');
});

test('patchRuntimeRunNode serializes live runtime patches', async () => {
  const seen: string[] = [];
  let live = 0;
  let max = 0;
  let first = true;
  const graph = {
    patchNode: async (
      _sessionId: string,
      _runNodeId: string,
      patch: { content: RuntimeRunSummary },
    ) => {
      live += 1;
      max = Math.max(max, live);
      seen.push(patch.content.status);
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      live -= 1;
    },
  };
  const service = new RuntimeService(graph as never);
  const summary: RuntimeRunSummary = {
    runNodeId: 'runtime-run-1',
    targetNodeId: 'runtime-target-1',
    sourceRunId: 'run-1',
    targetKind: 'web',
    launchMode: 'local_process',
    serviceName: 'web',
    cwd: '/tmp/work',
    status: 'launching',
  };
  const api = service as unknown as {
    runStateByNodeId: Map<
      string,
      {
        sessionId: string;
        summary: RuntimeRunSummary;
        manualStop: boolean;
        pending: Promise<void>;
      }
    >;
    patchRuntimeRunNode: (
      sessionId: string,
      runNodeId: string,
      summary: RuntimeRunSummary,
    ) => Promise<void>;
  };
  api.runStateByNodeId.set('runtime-run-1', {
    sessionId: 'session-1',
    summary,
    manualStop: false,
    pending: Promise.resolve(),
  });

  await Promise.all([
    api.patchRuntimeRunNode('session-1', 'runtime-run-1', summary),
    api.patchRuntimeRunNode('session-1', 'runtime-run-1', {
      ...summary,
      status: 'running',
    }),
  ]);

  assert.equal(max, 1);
  assert.deepEqual(seen, ['launching', 'running']);
});

test('ingestAgentRuntimeOutput reuses the same logical target across run ids', async () => {
  const output = node({ id: 'output-1', type: 'agent_output' });
  const target = node({
    id: 'runtime-target-1',
    type: 'runtime_target',
    metadata: {
      runtimeTarget: {
        targetNodeId: 'runtime-target-1',
        sourceRunId: 'run-1',
        outputNodeId: 'output-1',
        kind: 'web',
        launchMode: 'local_process',
        serviceName: 'web',
        cwd: '/tmp/app',
        preview: { mode: 'static', entry: 'index.html' },
        autoRun: false,
        source: 'event',
      },
    },
  });
  const run = node({
    id: 'runtime-run-1',
    type: 'runtime_run',
    metadata: {
      runtimeRun: {
        runNodeId: 'runtime-run-1',
        targetNodeId: 'runtime-target-1',
        sourceRunId: 'run-1',
        targetKind: 'web',
        launchMode: 'local_process',
        serviceName: 'web',
        cwd: '/tmp/app',
        entrypoint: 'index.html',
        status: 'running',
      },
    },
  });
  const graph = createGraph({
    nodes: [output, target, run],
    edges: [
      edge({ source: 'output-1', target: 'runtime-target-1', relation: 'produces' }),
      edge({ source: 'runtime-target-1', target: 'runtime-run-1', relation: 'spawns' }),
    ],
  });

  const service = new RuntimeService(graph.graph as never);
  const result = await service.ingestAgentRuntimeOutput({
    sessionId: 'session-1',
    sourceRunId: 'run-2',
    outputNodeId: 'output-1',
    workspaceRoot: missingRoot('runtime-dedup'),
    outputText: '',
    manifest: manifest(),
  });

  assert.equal(result.targets[0]?.targetNodeId, 'runtime-target-1');
  assert.equal(result.runs.length, 0);
  const targets = graph.snapshot.nodes.filter((entry) => entry.type === 'runtime_target');
  const runs = graph.snapshot.nodes.filter((entry) => entry.type === 'runtime_run');
  assert.equal(targets.length, 1);
  assert.equal(runs.length, 1);
  assert.equal(readTarget(targets[0])?.sourceRunId, 'run-2');
  assert.equal(readRun(runs[0])?.sourceRunId, 'run-2');
});

test('ingestAgentRuntimeOutput reads a minimal cepage-run.json scaffold from disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cepage-runtime-file-ingest-'));
  try {
    await fs.writeFile(
      path.join(root, 'cepage-run.json'),
      JSON.stringify({
        schema: 'cepage.runtime/v1',
        schemaVersion: 1,
        targets: [
          {
            kind: 'web',
            launchMode: 'local_process',
            serviceName: 'web',
            cwd: '.',
            command: 'pnpm',
            args: ['run', 'dev', '--', '--host', '{{HOST}}', '--port', '{{PORT}}'],
            env: { HOST: '{{HOST}}', PORT: '{{PORT}}' },
            ports: [{ name: 'http', port: 0, protocol: 'http' }],
            preview: { mode: 'server', port: 0 },
            autoRun: true,
          },
        ],
      }),
    );

    const graph = createGraph({
      nodes: [node({ id: 'output-1', type: 'agent_output' })],
    });
    const service = new RuntimeService(graph.graph as never);
    const result = await service.ingestAgentRuntimeOutput({
      sessionId: 'session-1',
      sourceRunId: 'run-file',
      outputNodeId: 'output-1',
      workspaceRoot: root,
      outputText: 'Scaffold completed',
    });

    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0]?.source, 'file');
    const target = graph.snapshot.nodes.find((entry) => entry.type === 'runtime_target');
    assert.equal(readTarget(target!)?.serviceName, 'web');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ingestAgentRuntimeOutput creates a new target when the runtime identity changes', async () => {
  const graph = createGraph({
    nodes: [node({ id: 'output-1', type: 'agent_output' })],
  });
  const service = new RuntimeService(graph.graph as never);

  await service.ingestAgentRuntimeOutput({
    sessionId: 'session-1',
    sourceRunId: 'run-1',
    outputNodeId: 'output-1',
    workspaceRoot: missingRoot('runtime-new-target-a'),
    outputText: '',
    manifest: manifest(),
  });
  await service.ingestAgentRuntimeOutput({
    sessionId: 'session-1',
    sourceRunId: 'run-2',
    outputNodeId: 'output-1',
    workspaceRoot: missingRoot('runtime-new-target-b'),
    outputText: '',
    manifest: manifest({ serviceName: 'admin' }),
  });

  const targets = graph.snapshot.nodes
    .filter((entry) => entry.type === 'runtime_target')
    .map((entry) => readTarget(entry)?.serviceName);
  assert.deepEqual(targets.sort(), ['admin', 'web']);
});

test('runTarget keeps only the latest visible runtime run for a target', async () => {
  const graph = createGraph({
    nodes: [
      node({
        id: 'runtime-target-1',
        type: 'runtime_target',
        metadata: {
          runtimeTarget: {
            targetNodeId: 'runtime-target-1',
            sourceRunId: 'run-1',
            outputNodeId: 'output-1',
            kind: 'web',
            launchMode: 'local_process',
            serviceName: 'web',
            cwd: '/tmp/app',
            preview: { mode: 'static', entry: 'index.html' },
            autoRun: true,
            source: 'event',
          },
        },
      }),
      node({
        id: 'runtime-run-1',
        type: 'runtime_run',
        updatedAt: '2026-04-03T10:00:00.000Z',
        metadata: {
          runtimeRun: {
            runNodeId: 'runtime-run-1',
            targetNodeId: 'runtime-target-1',
            sourceRunId: 'run-1',
            targetKind: 'web',
            launchMode: 'local_process',
            serviceName: 'web',
            cwd: '/tmp/app',
            entrypoint: 'index.html',
            status: 'completed',
          },
        },
      }),
      node({
        id: 'runtime-run-2',
        type: 'runtime_run',
        updatedAt: '2026-04-03T10:05:00.000Z',
        metadata: {
          runtimeRun: {
            runNodeId: 'runtime-run-2',
            targetNodeId: 'runtime-target-1',
            sourceRunId: 'run-1',
            targetKind: 'web',
            launchMode: 'local_process',
            serviceName: 'web',
            cwd: '/tmp/app',
            entrypoint: 'index.html',
            status: 'running',
          },
        },
      }),
    ],
    edges: [
      edge({ source: 'runtime-target-1', target: 'runtime-run-1', relation: 'spawns' }),
      edge({ source: 'runtime-target-1', target: 'runtime-run-2', relation: 'spawns' }),
    ],
  });
  const service = new RuntimeService(graph.graph as never);

  const summary = await service.runTarget('session-1', 'runtime-target-1');

  assert.equal(summary.runNodeId, 'runtime-run-2');
  assert.equal(graph.snapshot.nodes.filter((entry) => entry.type === 'runtime_run').length, 1);
  assert.deepEqual(graph.removed, ['runtime-run-1']);
  assert.equal(readRun(graph.snapshot.nodes.find((entry) => entry.id === 'runtime-run-2')!)?.status, 'running');
});
