import assert from 'node:assert/strict';
import test from 'node:test';
import { BranchesController } from '../branches.controller.js';

test('create logs a branch activity entry', async () => {
  const calls: unknown[] = [];
  const graph = {
    createBranch: async (_sessionId: string, input: unknown) => {
      calls.push(input);
      return {
        eventId: 7,
        payload: {
          type: 'branch_created' as const,
          branch: {
            id: 'branch-1',
            name: 'Feature',
            color: '#ff8a65',
            createdAt: '2026-04-06T10:00:00.000Z',
            createdBy: { type: 'human' as const, userId: 'local-user' },
            headNodeId: 'node-1',
            nodeIds: ['node-1'],
            status: 'active' as const,
          },
        },
      };
    },
  };
  const logged: unknown[] = [];
  const activity = {
    log: async (input: unknown) => {
      logged.push(input);
    },
  };

  const ctrl = new BranchesController(graph as never, activity as never);
  const res = await ctrl.create('session-1', {
    name: 'Feature',
    color: '#ff8a65',
    fromNodeId: 'node-1',
  });

  assert.equal(res.success, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: 'Feature',
    color: '#ff8a65',
    fromNodeId: 'node-1',
    actor: { type: 'human', userId: 'local-user' },
    requestId: undefined,
  });
  assert.deepEqual(logged[0], {
    sessionId: 'session-1',
    eventId: 7,
    actorType: 'human',
    actorId: 'local-user',
    summary: 'Created branch Feature.',
    summaryKey: 'activity.branch_created',
    summaryParams: { name: 'Feature' },
    relatedNodeIds: ['node-1'],
  });
});

test('merge resolves branch names for activity logging', async () => {
  const graph = {
    loadSnapshot: async () => ({
      version: 1 as const,
      id: 'session-1',
      createdAt: '2026-04-06T10:00:00.000Z',
      nodes: [],
      edges: [],
      branches: [
        {
          id: 'feat',
          name: 'Feature',
          color: '#fff',
          createdAt: '2026-04-06T10:00:00.000Z',
          createdBy: { type: 'human' as const, userId: 'u1' },
          headNodeId: 'node-1',
          nodeIds: ['node-1'],
          status: 'active' as const,
        },
        {
          id: 'main',
          name: 'Main',
          color: '#000',
          createdAt: '2026-04-06T10:00:00.000Z',
          createdBy: { type: 'human' as const, userId: 'u1' },
          headNodeId: 'node-2',
          nodeIds: ['node-2'],
          status: 'active' as const,
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    mergeBranch: async () => ({
      eventId: 9,
      payload: {
        type: 'branch_merged' as const,
        sourceBranchId: 'feat',
        targetBranchId: 'main',
      },
    }),
  };
  const logged: unknown[] = [];
  const activity = {
    log: async (input: unknown) => {
      logged.push(input);
    },
  };

  const ctrl = new BranchesController(graph as never, activity as never);
  const res = await ctrl.merge('session-1', 'feat', { targetBranchId: 'main' });

  assert.equal(res.success, true);
  assert.deepEqual(logged[0], {
    sessionId: 'session-1',
    eventId: 9,
    actorType: 'human',
    actorId: 'local-user',
    summary: 'Merged Feature into Main.',
    summaryKey: 'activity.branch_merged',
    summaryParams: { source: 'Feature', target: 'Main' },
    relatedNodeIds: ['node-1'],
  });
});

test('abandon logs the selected branch name', async () => {
  const graph = {
    loadSnapshot: async () => ({
      version: 1 as const,
      id: 'session-1',
      createdAt: '2026-04-06T10:00:00.000Z',
      nodes: [],
      edges: [],
      branches: [
        {
          id: 'feat',
          name: 'Feature',
          color: '#fff',
          createdAt: '2026-04-06T10:00:00.000Z',
          createdBy: { type: 'human' as const, userId: 'u1' },
          headNodeId: 'node-1',
          nodeIds: ['node-1'],
          status: 'active' as const,
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    abandonBranch: async () => ({
      eventId: 11,
      payload: {
        type: 'branch_abandoned' as const,
        branchId: 'feat',
      },
    }),
  };
  const logged: unknown[] = [];
  const activity = {
    log: async (input: unknown) => {
      logged.push(input);
    },
  };

  const ctrl = new BranchesController(graph as never, activity as never);
  const res = await ctrl.abandon('session-1', 'feat', {});

  assert.equal(res.success, true);
  assert.deepEqual(logged[0], {
    sessionId: 'session-1',
    eventId: 11,
    actorType: 'human',
    actorId: 'local-user',
    summary: 'Abandoned branch Feature.',
    summaryKey: 'activity.branch_abandoned',
    summaryParams: { name: 'Feature' },
    relatedNodeIds: ['node-1'],
  });
});
