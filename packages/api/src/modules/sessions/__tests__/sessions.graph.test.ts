import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphService } from '../../graph/graph.service.js';
import type { PrismaService } from '../../../common/database/prisma.service.js';
import { SessionsService } from '../sessions.service.js';

test('getGraphBundle returns recent activity with pagination metadata', async () => {
  const prisma = {
    session: {
      findUnique: async () => ({
        id: 'session-1',
        name: 'Demo',
        status: 'active',
        createdAt: new Date('2026-04-06T08:00:00.000Z'),
        updatedAt: new Date('2026-04-06T09:00:00.000Z'),
        workspaceParentDirectory: null,
        workspaceDirectoryName: null,
      }),
    },
    activityEntry: {
      findMany: async () => [
        {
          id: 'c',
          timestamp: new Date('2026-04-06T10:00:00.000Z'),
          actorType: 'human',
          actorId: 'u1',
          runId: null,
          summary: 'c',
          summaryKey: null,
          summaryParams: null,
          relatedNodeIds: ['node-c'],
        },
        {
          id: 'b',
          timestamp: new Date('2026-04-06T09:00:00.000Z'),
          actorType: 'agent',
          actorId: 'agent-1',
          runId: 'run-1',
          summary: 'b',
          summaryKey: 'activity.agent_completed',
          summaryParams: { label: 'Run 1' },
          relatedNodeIds: null,
        },
      ],
    },
    agentRun: {
      findMany: async () => [],
    },
    workflowExecution: {
      findMany: async () => [],
    },
    workflowControllerState: {
      findMany: async () => [],
    },
    workflowManagedFlow: {
      findMany: async () => [],
    },
  };
  const graph = {
    loadSnapshot: async () => ({
      version: 1 as const,
      id: 'session-1',
      createdAt: '2026-04-06T08:00:00.000Z',
      nodes: [],
      edges: [],
      branches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
  } as unknown as GraphService;

  const svc = new SessionsService(prisma as unknown as PrismaService, graph);
  const res = await svc.getGraphBundle('session-1');

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.deepEqual(
    res.data.activity.map((row: { id: string }) => row.id),
    ['c', 'b'],
  );
  assert.equal(res.data.activityNextCursor, null);
  assert.equal(res.data.activityHasMore, false);
});

test('listSnapshots paginates snapshot metadata', async () => {
  const prisma = {
    session: {
      findUnique: async () => ({ id: 'session-1' }),
    },
    graphSnapshot: {
      findMany: async () => [
        {
          id: 'snap-2',
          createdAt: new Date('2026-04-06T10:00:00.000Z'),
          lastEventId: 9,
        },
        {
          id: 'snap-1',
          createdAt: new Date('2026-04-06T09:00:00.000Z'),
          lastEventId: 4,
        },
      ],
      findFirst: async () => ({
        data: {
          version: 1,
          id: 'session-1',
          createdAt: '2026-04-06T09:00:00.000Z',
          nodes: [],
          edges: [],
          branches: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
    },
  };
  const graph = {} as GraphService;
  const svc = new SessionsService(prisma as unknown as PrismaService, graph);

  const page = await svc.listSnapshots('session-1', 1);
  assert.equal(page.success, true);
  if (!page.success) return;
  assert.equal(page.data.items[0].id, 'snap-2');
  assert.equal(page.data.nextCursor, '2026-04-06T10:00:00.000Z|snap-2');

  const snap = await svc.getSnapshot('session-1', 'snap-1');
  assert.equal(snap.success, true);
  if (!snap.success) return;
  assert.equal(snap.data.id, 'session-1');
});
