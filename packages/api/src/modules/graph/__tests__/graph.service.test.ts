import { BadRequestException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowFromSnapshot, type GraphSnapshot } from '@cepage/shared-core';
import { GraphService } from '../graph.service.js';

function snapshot(): GraphSnapshot {
  return {
    version: 1,
    id: 'session-1',
    createdAt: '2026-04-03T10:00:00.000Z',
    lastEventId: 7,
    nodes: [
      {
        id: 'node-a',
        type: 'note',
        createdAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        content: { text: 'start', format: 'plaintext' },
        creator: { type: 'human', userId: 'u1' },
        position: { x: 0, y: 0 },
        dimensions: { width: 220, height: 120 },
        metadata: {},
        status: 'active',
        branches: ['branch-a'],
      },
      {
        id: 'node-b',
        type: 'human_message',
        createdAt: '2026-04-03T10:01:00.000Z',
        updatedAt: '2026-04-03T10:01:00.000Z',
        content: { text: 'continue', format: 'plaintext' },
        creator: { type: 'human', userId: 'u1' },
        position: { x: 120, y: 60 },
        dimensions: { width: 240, height: 140 },
        metadata: { selected: true },
        status: 'active',
        branches: ['branch-a'],
      },
    ],
    edges: [
      {
        id: 'edge-a',
        source: 'node-a',
        target: 'node-b',
        relation: 'references',
        direction: 'source_to_target',
        strength: 1,
        createdAt: '2026-04-03T10:01:30.000Z',
        creator: { type: 'human', userId: 'u1' },
        metadata: {},
      },
    ],
    branches: [
      {
        id: 'branch-a',
        name: 'Main',
        color: '#ff9900',
        createdAt: '2026-04-03T10:02:00.000Z',
        createdBy: { type: 'human', userId: 'u1' },
        headNodeId: 'node-b',
        nodeIds: ['node-a', 'node-b'],
        status: 'active',
      },
    ],
    viewport: { x: 12, y: 24, zoom: 0.8 },
  };
}

function row() {
  const snap = snapshot();
  return {
    id: snap.id,
    createdAt: new Date(snap.createdAt),
    lastEventId: snap.lastEventId,
    viewportX: snap.viewport.x,
    viewportY: snap.viewport.y,
    viewportZoom: snap.viewport.zoom,
    nodes: snap.nodes.map((node) => ({
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
    edges: snap.edges.map((edge) => ({
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
    branches: snap.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      color: branch.color,
      createdAt: new Date(branch.createdAt),
      createdBy: branch.createdBy,
      headNodeId: branch.headNodeId,
      nodeIds: branch.nodeIds,
      parentBranchId: branch.parentBranchId,
      forkedFromNodeId: branch.forkedFromNodeId,
      status: branch.status,
      mergedIntoBranchId: branch.mergedIntoBranchId,
    })),
  };
}

test('replaceWorkflow rewrites the graph transactionally and emits a resync', async () => {
  const deletes: string[] = [];
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  const branches: unknown[] = [];
  const sessionUpdates: unknown[] = [];
  const events: unknown[] = [];
  const snaps: unknown[] = [];
  const emitted: unknown[] = [];
  const flow = workflowFromSnapshot(snapshot());

  const tx = {
    graphSnapshot: {
      deleteMany: async () => {
        deletes.push('graphSnapshot');
      },
      create: async ({ data }: { data: unknown }) => {
        snaps.push(data);
      },
    },
    graphEvent: {
      deleteMany: async () => {
        deletes.push('graphEvent');
      },
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
      },
    },
    activityEntry: {
      deleteMany: async () => {
        deletes.push('activityEntry');
      },
    },
    agentRun: {
      deleteMany: async () => {
        deletes.push('agentRun');
      },
    },
    branch: {
      deleteMany: async () => {
        deletes.push('branch');
      },
      create: async ({ data }: { data: unknown }) => {
        branches.push(data);
      },
    },
    graphEdge: {
      deleteMany: async () => {
        deletes.push('graphEdge');
      },
      create: async ({ data }: { data: unknown }) => {
        edges.push(data);
      },
    },
    graphNode: {
      deleteMany: async () => {
        deletes.push('graphNode');
      },
      create: async ({ data }: { data: unknown }) => {
        nodes.push(data);
      },
    },
    session: {
      update: async ({ data }: { data: unknown }) => {
        sessionUpdates.push(data);
        return { lastEventId: 8 };
      },
    },
  };
  type Tx = typeof tx;

  const prisma = {
    session: {
      findUnique: async () => ({ lastEventId: 7 }),
    },
    $transaction: async (fn: (db: Tx) => Promise<void>) => {
      await fn(tx);
    },
  };

  const collaboration = {
    emitSession: (_sessionId: string, ev: unknown) => {
      emitted.push(ev);
    },
  };

  const service = new GraphService(prisma as never, collaboration as never);
  const res = await service.replaceWorkflow('session-1', flow);

  assert.deepEqual(deletes, [
    'graphSnapshot',
    'graphEvent',
    'activityEntry',
    'agentRun',
    'branch',
    'graphEdge',
    'graphNode',
  ]);
  assert.equal(res.eventId, 8);
  assert.deepEqual(res.counts, { nodes: 2, edges: 1, branches: 1 });
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  assert.equal(branches.length, 1);
  const createdNodeIds = (nodes as Array<{ id: string }>).map((node) => node.id);
  assert.equal(createdNodeIds.includes('node-a'), false);
  assert.equal(createdNodeIds.includes('node-b'), false);
  assert.equal((edges[0] as { id: string }).id === 'edge-a', false);
  assert.equal((branches[0] as { id: string }).id === 'branch-a', false);
  assert.deepEqual(
    {
      source: (edges[0] as { source: string }).source,
      target: (edges[0] as { target: string }).target,
    },
    {
      source: createdNodeIds[0],
      target: createdNodeIds[1],
    },
  );
  assert.deepEqual((branches[0] as { nodeIds: string[] }).nodeIds, createdNodeIds);
  assert.equal((branches[0] as { headNodeId: string }).headNodeId, createdNodeIds[1]);
  assert.deepEqual(sessionUpdates[0], {
    viewportX: 12,
    viewportY: 24,
    viewportZoom: 0.8,
    lastEventId: { increment: 1 },
  });
  assert.equal((events[0] as { kind?: string }).kind, 'graph_restored');
  assert.equal((snaps[0] as { lastEventId?: number }).lastEventId, 8);
  assert.deepEqual(emitted[0], {
    type: 'system.resync_required',
    eventId: 8,
    sessionId: 'session-1',
    payload: { reason: 'workflow_imported' },
  });
});

test('replaceWorkflow rejects invalid workflow references', async () => {
  const prisma = {
    session: {
      findUnique: async () => ({ lastEventId: 7 }),
    },
  };
  const collaboration = {
    emitSession: () => {},
  };
  const service = new GraphService(prisma as never, collaboration as never);
  const flow = workflowFromSnapshot(snapshot());
  flow.graph.edges[0] = {
    ...flow.graph.edges[0],
    target: 'missing-node',
  };

  await assert.rejects(
    () => service.replaceWorkflow('session-1', flow),
    (error) => {
      assert.equal(error instanceof BadRequestException, true);
      if (!(error instanceof BadRequestException)) {
        return false;
      }
      assert.deepEqual(error.getResponse(), {
        message: 'VALIDATION_FAILED',
        errors: [
          {
            field: 'workflow',
            messages: ['Edge edge-a references missing target node: missing-node'],
          },
        ],
      });
      return true;
    },
  );
});

test('patchNode uses the transaction event id instead of the hydrated snapshot event id', async () => {
  const sessionUpdates: unknown[] = [];
  const nodeUpdates: unknown[] = [];
  const events: unknown[] = [];
  const emitted: unknown[] = [];
  const tx = {
    session: {
      update: async ({ data }: { data: unknown }) => {
        sessionUpdates.push(data);
        return { lastEventId: 42 };
      },
    },
    graphNode: {
      update: async ({ data }: { data: unknown }) => {
        nodeUpdates.push(data);
      },
    },
    graphEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
      },
    },
  };
  type Tx = typeof tx;

  const prisma = {
    session: {
      findUnique: async () => row(),
    },
    $transaction: async (fn: (db: Tx) => Promise<unknown>) => fn(tx),
  };
  const collaboration = {
    emitSession: (_sessionId: string, ev: unknown) => {
      emitted.push(ev);
    },
  };

  const service = new GraphService(prisma as never, collaboration as never);
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const env = await service.patchNode(
      'session-1',
      'node-a',
      { content: { text: 'patched', format: 'plaintext' } },
      { type: 'human', userId: 'u1' },
      'req-1',
    );

    assert.equal(env.eventId, 42);
    assert.deepEqual(sessionUpdates[0], { lastEventId: { increment: 1 } });
    assert.deepEqual((nodeUpdates[0] as { content: unknown }).content, {
      text: 'patched',
      format: 'plaintext',
    });
    assert.equal((nodeUpdates[0] as { updatedAt: Date }).updatedAt instanceof Date, true);
    assert.equal((events[0] as { eventId?: number }).eventId, 42);
    assert.equal((emitted[0] as { eventId?: number }).eventId, 42);
  } finally {
    if (prev === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prev;
    }
  }
});

test('restoreWorkflow rewrites graph tables without clearing run history', async () => {
  const deletes: string[] = [];
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  const branches: unknown[] = [];
  const sessionUpdates: unknown[] = [];
  const events: unknown[] = [];
  const snaps: unknown[] = [];
  const emitted: unknown[] = [];
  const flow = workflowFromSnapshot(snapshot());

  const tx = {
    graphSnapshot: {
      create: async ({ data }: { data: unknown }) => {
        snaps.push(data);
      },
    },
    graphEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
      },
    },
    activityEntry: {
      deleteMany: async () => {
        deletes.push('activityEntry');
      },
    },
    agentRun: {
      deleteMany: async () => {
        deletes.push('agentRun');
      },
    },
    branch: {
      deleteMany: async () => {
        deletes.push('branch');
      },
      create: async ({ data }: { data: unknown }) => {
        branches.push(data);
      },
    },
    graphEdge: {
      deleteMany: async () => {
        deletes.push('graphEdge');
      },
      create: async ({ data }: { data: unknown }) => {
        edges.push(data);
      },
    },
    graphNode: {
      deleteMany: async () => {
        deletes.push('graphNode');
      },
      create: async ({ data }: { data: unknown }) => {
        nodes.push(data);
      },
    },
    session: {
      update: async ({ data }: { data: unknown }) => {
        sessionUpdates.push(data);
        return { lastEventId: 8 };
      },
    },
  };
  type Tx = typeof tx;

  const prisma = {
    session: {
      findUnique: async () => ({ lastEventId: 7 }),
    },
    $transaction: async (fn: (db: Tx) => Promise<void>) => {
      await fn(tx);
    },
  };

  const collaboration = {
    emitSession: (_sessionId: string, ev: unknown) => {
      emitted.push(ev);
    },
  };

  const service = new GraphService(prisma as never, collaboration as never);
  const res = await service.restoreWorkflow(
    'session-1',
    flow,
    { type: 'human', userId: 'u1' },
    'workflow_copilot_restore',
  );

  assert.deepEqual(deletes, ['branch', 'graphEdge', 'graphNode']);
  assert.equal(res.eventId, 8);
  assert.deepEqual(res.counts, { nodes: 2, edges: 1, branches: 1 });
  assert.equal((nodes[0] as { id?: string }).id, 'node-a');
  assert.equal((edges[0] as { id?: string }).id, 'edge-a');
  assert.equal((branches[0] as { id?: string }).id, 'branch-a');
  assert.deepEqual(sessionUpdates[0], {
    viewportX: 12,
    viewportY: 24,
    viewportZoom: 0.8,
    lastEventId: { increment: 1 },
  });
  assert.equal((events[0] as { kind?: string }).kind, 'graph_restored');
  assert.equal((snaps[0] as { lastEventId?: number }).lastEventId, 8);
  assert.deepEqual(emitted[0], {
    type: 'system.resync_required',
    eventId: 8,
    sessionId: 'session-1',
    payload: { reason: 'workflow_copilot_restore' },
  });
});
