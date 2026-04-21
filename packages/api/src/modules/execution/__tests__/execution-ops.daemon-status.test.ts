import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionOpsController } from '../execution-ops.controller.js';

type Summary = Awaited<ReturnType<import('../worker-registry.service.js').WorkerRegistryService['summarizeRunningWorkers']>>;

function buildController(summary: Summary) {
  const workers = {
    summarizeRunningWorkers: async (kind: string) => {
      assert.equal(kind, 'daemon');
      return summary;
    },
    listWorkers: async () => [],
  };
  return new ExecutionOpsController(workers as never, {} as never, {} as never);
}

test('GET execution/daemon/status returns offline envelope when no daemons', async () => {
  const ctrl = buildController({
    online: false,
    count: 0,
    lastSeenAt: null,
    runtimes: [],
  });
  const res = await ctrl.daemonStatus();
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.deepEqual(res.data, {
    online: false,
    count: 0,
    lastSeenAt: null,
    runtimes: [],
  });
});

test('GET execution/daemon/status flattens runtime metadata into top-level fields', async () => {
  const seenAt = new Date('2026-01-02T10:00:00Z');
  const ctrl = buildController({
    online: true,
    count: 2,
    lastSeenAt: seenAt,
    runtimes: [
      {
        id: 'daemon-newest',
        lastSeenAt: seenAt,
        host: 'host-a',
        metadata: {
          name: 'laptop',
          version: '0.1.0',
          supportedAgents: ['opencode', 'cursor'],
        },
      },
      {
        id: 'daemon-no-meta',
        lastSeenAt: seenAt,
        host: 'host-b',
        metadata: null,
      },
    ],
  });
  const res = await ctrl.daemonStatus();
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.data.online, true);
  assert.equal(res.data.count, 2);
  assert.equal(res.data.lastSeenAt, seenAt.toISOString());
  assert.equal(res.data.runtimes[0].id, 'daemon-newest');
  assert.equal(res.data.runtimes[0].name, 'laptop');
  assert.equal(res.data.runtimes[0].version, '0.1.0');
  assert.deepEqual(res.data.runtimes[0].supportedAgents, ['opencode', 'cursor']);
  assert.equal(res.data.runtimes[1].id, 'daemon-no-meta');
  assert.equal(res.data.runtimes[1].name, undefined);
  assert.equal(res.data.runtimes[1].version, undefined);
  assert.equal(res.data.runtimes[1].supportedAgents, undefined);
});
