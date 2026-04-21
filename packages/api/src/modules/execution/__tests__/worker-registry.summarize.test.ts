import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerRegistryService } from '../worker-registry.service.js';

type WorkerNodeRow = {
  id: string;
  kind: string;
  status: string;
  lastSeenAt: Date;
  host: string | null;
  metadata: unknown;
};

function makePrismaStub(rows: WorkerNodeRow[]) {
  let lastWhere: Record<string, unknown> | null = null;
  let lastOrderBy: Record<string, unknown> | null = null;
  return {
    workerNode: {
      findMany: async (args: { where: Record<string, unknown>; orderBy: Record<string, unknown>; select: Record<string, unknown> }) => {
        lastWhere = args.where;
        lastOrderBy = args.orderBy;
        return rows.map((row) => ({
          id: row.id,
          lastSeenAt: row.lastSeenAt,
          host: row.host,
          metadata: row.metadata,
        }));
      },
    },
    inspect: () => ({ where: lastWhere, orderBy: lastOrderBy }),
  };
}

test('summarizeRunningWorkers returns offline summary when no rows', async () => {
  const prisma = makePrismaStub([]);
  const svc = new WorkerRegistryService(prisma as never);
  const summary = await svc.summarizeRunningWorkers('daemon');
  assert.deepEqual(summary, { online: false, count: 0, lastSeenAt: null, runtimes: [] });

  const inspected = prisma.inspect();
  assert.equal((inspected.where as { kind: string }).kind, 'daemon');
  assert.equal((inspected.where as { status: string }).status, 'running');
  assert.deepEqual(inspected.orderBy, { lastSeenAt: 'desc' });
});

test('summarizeRunningWorkers normalizes metadata and surfaces newest heartbeat', async () => {
  const newest = new Date('2026-01-02T10:00:00Z');
  const older = new Date('2026-01-02T09:00:00Z');
  const rows: WorkerNodeRow[] = [
    {
      id: 'daemon-newest',
      kind: 'daemon',
      status: 'running',
      lastSeenAt: newest,
      host: 'host-a',
      metadata: { name: 'laptop', supportedAgents: ['opencode'] },
    },
    {
      id: 'daemon-older',
      kind: 'daemon',
      status: 'running',
      lastSeenAt: older,
      host: 'host-b',
      metadata: ['ignored-non-object'],
    },
  ];
  const svc = new WorkerRegistryService(makePrismaStub(rows) as never);
  const summary = await svc.summarizeRunningWorkers('daemon');

  assert.equal(summary.online, true);
  assert.equal(summary.count, 2);
  assert.equal(summary.lastSeenAt?.toISOString(), newest.toISOString());
  assert.equal(summary.runtimes[0].id, 'daemon-newest');
  assert.deepEqual(summary.runtimes[0].metadata, {
    name: 'laptop',
    supportedAgents: ['opencode'],
  });
  assert.equal(summary.runtimes[1].id, 'daemon-older');
  assert.equal(summary.runtimes[1].metadata, null);
});
