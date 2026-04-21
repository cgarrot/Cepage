import { BadRequestException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaService } from '../../../common/database/prisma.service.js';
import { TimelineService } from '../timeline.service.js';

test('list paginates activity entries with a stable cursor', async () => {
  const calls: unknown[] = [];
  const prisma = {
    session: {
      findUnique: async () => ({ id: 'session-1' }),
    },
    activityEntry: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return [
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
            timestamp: new Date('2026-04-06T10:00:00.000Z'),
            actorType: 'agent',
            actorId: 'agent-1',
            runId: 'run-1',
            summary: 'b',
            summaryKey: 'activity.agent_completed',
            summaryParams: { label: 'run-1' },
            relatedNodeIds: null,
          },
          {
            id: 'a',
            timestamp: new Date('2026-04-06T09:00:00.000Z'),
            actorType: 'system',
            actorId: 'system',
            runId: null,
            summary: 'a',
            summaryKey: null,
            summaryParams: null,
            relatedNodeIds: null,
          },
        ];
      },
    },
  };

  const svc = new TimelineService(prisma as unknown as PrismaService);
  const res = await svc.list('session-1', 2);

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.deepEqual(
    res.data.items.map((row: { id: string }) => row.id),
    ['c', 'b'],
  );
  assert.equal(res.data.nextCursor, '2026-04-06T10:00:00.000Z|b');
  assert.deepEqual(calls[0], {
    where: { sessionId: 'session-1' },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: 3,
  });
});

test('list rejects an invalid cursor', async () => {
  const prisma = {
    session: {
      findUnique: async () => ({ id: 'session-1' }),
    },
    activityEntry: {
      findMany: async () => [],
    },
  };

  const svc = new TimelineService(prisma as unknown as PrismaService);
  await assert.rejects(() => svc.list('session-1', 10, 'bad-cursor'), BadRequestException);
});
