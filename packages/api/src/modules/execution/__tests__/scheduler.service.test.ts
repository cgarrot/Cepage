import assert from 'node:assert/strict';
import test from 'node:test';
import { SchedulerService } from '../scheduler.service.js';

test('register pauses one-shot triggers scheduled in the past', async () => {
  let created: Record<string, unknown> | undefined;
  const prisma = {
    scheduledTrigger: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data;
        return data;
      },
    },
  };

  const svc = new SchedulerService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await svc.register({
    sessionId: 'session-1',
    ownerNodeId: 'node-1',
    cron: new Date(Date.now() - 60_000).toISOString(),
  });

  assert.equal(created?.status, 'paused');
  assert.ok(created?.nextRunAt instanceof Date);
});

test('tick pauses one-shot triggers after their first fire', async () => {
  let queued: Record<string, unknown> | undefined;
  let updated: Record<string, unknown> | undefined;
  const prisma = {
    scheduledTrigger: {
      findMany: async () => [
        {
          id: 'trigger-1',
          sessionId: 'session-1',
          ownerNodeId: 'node-1',
          cron: new Date(Date.now() - 60_000).toISOString(),
          status: 'active',
          payload: {},
          nextRunAt: new Date(Date.now() - 1_000),
          lastRunAt: null,
        },
      ],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated = data;
        return data;
      },
    },
  };
  const supervisor = {
    queueScheduledTrigger: async (input: Record<string, unknown>) => {
      queued = input;
    },
  };

  const svc = new SchedulerService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    supervisor as never,
  );

  await svc.tick();

  assert.deepEqual(queued, {
    sessionId: 'session-1',
    triggerId: 'trigger-1',
  });
  assert.equal(updated?.status, 'paused');
  assert.ok(updated?.lastRunAt instanceof Date);
  assert.ok(updated?.nextRunAt instanceof Date);
  assert.equal(
    (updated?.nextRunAt as Date).getTime(),
    (updated?.lastRunAt as Date).getTime(),
  );
});

test('tick keeps recurring triggers active', async () => {
  let updated: Record<string, unknown> | undefined;
  const prisma = {
    scheduledTrigger: {
      findMany: async () => [
        {
          id: 'trigger-2',
          sessionId: 'session-1',
          ownerNodeId: 'node-2',
          cron: 'every:5m',
          status: 'active',
          payload: {},
          nextRunAt: new Date(Date.now() - 1_000),
          lastRunAt: null,
        },
      ],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated = data;
        return data;
      },
    },
  };
  const supervisor = {
    queueScheduledTrigger: async () => undefined,
  };

  const svc = new SchedulerService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    supervisor as never,
  );

  await svc.tick();

  assert.equal(updated?.status, 'active');
  assert.ok(updated?.lastRunAt instanceof Date);
  assert.ok(updated?.nextRunAt instanceof Date);
  assert.ok((updated?.nextRunAt as Date).getTime() > (updated?.lastRunAt as Date).getTime());
});
