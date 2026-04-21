import assert from 'node:assert/strict';
import test from 'node:test';
import { RecoveryService } from '../recovery.service.js';

test('recover fails orphan runs before requeueing waiting flows', async () => {
  const seen: string[] = [];
  const prisma = {
    session: {
      findMany: async () => [{ id: 'session-1' }],
    },
    workflowManagedFlow: {
      findMany: async (args: { where: { status: { in: string[] } } }) => {
        assert.deepEqual(args.where.status.in, ['queued', 'running', 'waiting']);
        return [{ id: 'flow-1', sessionId: 'session-1' }];
      },
    },
    workflowControllerState: {
      findMany: async () => [{ id: 'controller-1', sessionId: 'session-1' }],
    },
    agentRun: {
      findMany: async () => [
        {
          id: 'run-1',
          sessionId: 'session-1',
          executionId: 'exec-1',
          requestId: 'req-1',
          startedAt: new Date(Date.now() - 10_000),
        },
      ],
      update: async () => {
        seen.push('run:update');
        return {};
      },
    },
    workflowExecution: {
      updateMany: async () => {
        seen.push('execution:update');
        return { count: 1 };
      },
    },
  };
  const queue = {
    reclaimExpiredJobs: async () => {
      seen.push('jobs:reclaim');
    },
    findByKey: async () => null,
  };
  const supervisor = {
    agentRunKey: (runId: string) => `agent-run:${runId}:execute`,
    queueFlow: async (_sessionId: string, payload: { flowId: string }) => {
      seen.push(`flow:${payload.flowId}`);
    },
    queueController: async (_sessionId: string, payload: { controllerId: string }) => {
      seen.push(`controller:${payload.controllerId}`);
    },
  };
  const leases = {
    expireLeases: async () => {
      seen.push('leases:expire');
    },
  };
  const workers = {
    markLostWorkers: async () => {
      seen.push('workers:lost');
    },
  };
  const activity = {
    log: async () => {
      seen.push('activity:log');
    },
  };
  const runtime = {
    recoverRuns: async (sessionId: string) => {
      seen.push(`runtime:${sessionId}`);
      return 0;
    },
  };

  const svc = new RecoveryService(
    prisma as never,
    queue as never,
    supervisor as never,
    leases as never,
    workers as never,
    activity as never,
    runtime as never,
  );

  await svc.recover();

  assert.ok(seen.indexOf('run:update') !== -1);
  assert.ok(seen.indexOf('run:update') < seen.indexOf('controller:controller-1'));
  assert.ok(seen.indexOf('run:update') < seen.indexOf('flow:flow-1'));
  assert.ok(seen.includes('runtime:session-1'));
});
