import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphEdge, GraphNode, GraphSnapshot } from '@cepage/shared-core';
import { SessionAnalyzerService } from '../session-analyzer.service.js';

function makeNode(
  id: string,
  type: GraphNode['type'],
  content: Record<string, unknown>,
  creatorType: GraphNode['creator']['type'] = 'agent',
): GraphNode {
  return {
    id,
    type,
    createdAt: '2026-04-23T00:00:00.000Z',
    updatedAt: '2026-04-23T00:00:00.000Z',
    content,
    creator:
      creatorType === 'agent'
        ? { type: 'agent', agentType: 'opencode', agentId: 'agent-1' }
        : creatorType === 'human'
          ? { type: 'human', userId: 'user-1' }
          : { type: 'system', reason: 'test' },
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 100 },
    metadata: {},
    status: 'active',
    branches: [],
  };
}

function makeEdge(source: string, relation: GraphEdge['relation'], target: string, id = `${source}-${target}`): GraphEdge {
  return {
    id,
    source,
    relation,
    target,
    direction: 'source_to_target',
    strength: 1,
    createdAt: '2026-04-23T00:00:00.000Z',
    creator: { type: 'agent', agentType: 'opencode', agentId: 'agent-1' },
    metadata: {},
  };
}

function makeSnapshot(overrides?: Partial<GraphSnapshot>): GraphSnapshot {
  return {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastEventId: 0,
    nodes: [],
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

function graphRowFromSnapshot(snapshot: GraphSnapshot) {
  return {
    id: snapshot.id,
    createdAt: new Date(snapshot.createdAt),
    lastEventId: snapshot.lastEventId ?? 0,
    viewportX: snapshot.viewport.x,
    viewportY: snapshot.viewport.y,
    viewportZoom: snapshot.viewport.zoom,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      createdAt: new Date(node.createdAt),
      updatedAt: new Date(node.updatedAt),
      content: node.content,
      creator: node.creator,
      positionX: node.position.x,
      positionY: node.position.y,
      width: node.dimensions.width,
      height: node.dimensions.height,
      metadata: node.metadata,
      status: node.status,
      branchIds: node.branches,
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      direction: edge.direction,
      strength: edge.strength,
      createdAt: new Date(edge.createdAt),
      creator: edge.creator,
      metadata: edge.metadata,
    })),
    branches: snapshot.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      color: branch.color,
      createdAt: new Date(branch.createdAt),
      createdBy: branch.createdBy,
      headNodeId: branch.headNodeId,
      nodeIds: branch.nodeIds,
      parentBranchId: branch.parentBranchId ?? null,
      forkedFromNodeId: branch.forkedFromNodeId ?? null,
      status: branch.status,
      mergedIntoBranchId: branch.mergedIntoBranchId ?? null,
    })),
  };
}

function makeService(session: unknown) {
  return new SessionAnalyzerService({
    session: {
      async findUnique(): Promise<unknown> {
        return session;
      },
      async update(args: unknown): Promise<unknown> {
        return args;
      },
    },
  } as never);
}

test('analyze produces the same fingerprint for equivalent graphs regardless of input order', async () => {
  const first = makeSnapshot({
    nodes: [
      makeNode('b', 'agent_output', { body: 'Hello {{topic}} and {{user}}' }),
      makeNode('a', 'agent_message', { prompt: 'Use {{topic}} twice {{topic}}' }, 'human'),
    ],
    edges: [makeEdge('b', 'references', 'a', 'e-2'), makeEdge('a', 'produces', 'b', 'e-1')],
  });
  const second = makeSnapshot({
    nodes: [first.nodes[0], first.nodes[1]].reverse(),
    edges: [first.edges[0], first.edges[1]].reverse(),
  });

  const firstResult = await makeService({ graphJson: first, ...graphRowFromSnapshot(first) }).analyze('session-1');
  const secondResult = await makeService({ graphJson: second, ...graphRowFromSnapshot(second) }).analyze('session-1');

  assert.equal(firstResult.fingerprint, secondResult.fingerprint);
  assert.deepEqual(firstResult.summary, {
    nodeCount: 2,
    edgeCount: 2,
    topParameters: ['topic', 'user'],
  });
});

test('analyze changes the fingerprint when the graph changes', async () => {
  const base = makeSnapshot({
    nodes: [
      makeNode('a', 'agent_message', { prompt: 'Plan for {{topic}}' }),
      makeNode('b', 'agent_output', { body: 'Ship it' }),
    ],
    edges: [makeEdge('a', 'produces', 'b')],
  });
  const changed = makeSnapshot({
    nodes: [
      makeNode('a', 'agent_message', { prompt: 'Plan for {{topic}}', channel: 'email' }),
      makeNode('b', 'agent_output', { body: 'Ship it' }),
    ],
    edges: [makeEdge('a', 'produces', 'b')],
  });

  const baseResult = await makeService({ graphJson: base, ...graphRowFromSnapshot(base) }).analyze('session-1');
  const changedResult = await makeService({ graphJson: changed, ...graphRowFromSnapshot(changed) }).analyze('session-1');

  assert.notEqual(baseResult.fingerprint, changedResult.fingerprint);
});

test('analyze prefers graphJson when available and falls back to relational session data otherwise', async () => {
  const graphJson = makeSnapshot({
    nodes: [makeNode('json-node', 'agent_output', { body: 'Use {{graphJsonParam}}' })],
    edges: [],
  });
  const relational = makeSnapshot({
    nodes: [makeNode('row-node', 'agent_output', { body: 'Use {{rowParam}}' })],
    edges: [makeEdge('row-node', 'references', 'row-node')],
  });

  const preferred = await makeService({
    ...graphRowFromSnapshot(relational),
    graphJson,
  }).analyze('session-1');
  assert.deepEqual(preferred.summary, {
    nodeCount: 1,
    edgeCount: 0,
    topParameters: ['graphJsonParam'],
  });

  const fallback = await makeService({
    ...graphRowFromSnapshot(relational),
    graphJson: null,
  }).analyze('session-1');
  assert.deepEqual(fallback.summary, {
    nodeCount: 1,
    edgeCount: 1,
    topParameters: ['rowParam'],
  });
});

test('analyze stores the fingerprint in session metadata', async () => {
  const snapshot = makeSnapshot({
    nodes: [makeNode('a', 'agent_message', { prompt: 'Plan for {{topic}}' })],
    edges: [],
  });

  const updates: unknown[] = [];
  const service = new SessionAnalyzerService({
    session: {
      async findUnique(): Promise<unknown> {
        return {
          metadata: { existing: true, analysis: { summary: 'keep-me' } },
          graphJson: snapshot,
          ...graphRowFromSnapshot(snapshot),
        };
      },
      async update(args: unknown): Promise<unknown> {
        updates.push(args);
        return args;
      },
    },
  } as never);

  const result = await service.analyze('session-1');

  assert.deepEqual(updates, [
    {
      where: { id: 'session-1' },
      data: {
        metadata: {
          existing: true,
          analysis: {
            summary: 'keep-me',
            fingerprint: result.fingerprint,
          },
        },
      },
    },
  ]);
});
