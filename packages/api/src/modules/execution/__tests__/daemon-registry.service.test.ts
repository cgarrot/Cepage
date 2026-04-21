import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCatalogProvider } from '@cepage/shared-core';
import { DaemonRegistryService } from '../daemon/daemon-registry.service.js';

type RegisterCall = {
  workerId: string;
  kind: string;
  metadata?: Record<string, unknown>;
};

type HeartbeatCall = {
  workerId: string;
  activeJobId?: string;
  load?: Record<string, unknown>;
  metadataPatch?: Record<string, unknown>;
};

type SummarizeRow = {
  id: string;
  lastSeenAt: Date;
  host: string | null;
  metadata: Record<string, unknown> | null;
};

function stubWorkers(initialSummary: SummarizeRow[] = []) {
  const calls = {
    register: [] as RegisterCall[],
    heartbeat: [] as HeartbeatCall[],
    stopped: [] as string[],
    summarize: [] as string[],
  };
  let summaryRows = initialSummary;
  return {
    calls,
    setSummary(rows: SummarizeRow[]) {
      summaryRows = rows;
    },
    registerWorker: async (input: RegisterCall) => {
      calls.register.push(input);
    },
    heartbeat: async (input: HeartbeatCall) => {
      calls.heartbeat.push(input);
    },
    markStopped: async (workerId: string) => {
      calls.stopped.push(workerId);
    },
    summarizeRunningWorkers: async (kind: string) => {
      calls.summarize.push(kind);
      return {
        online: summaryRows.length > 0,
        count: summaryRows.length,
        lastSeenAt: summaryRows[0]?.lastSeenAt ?? null,
        runtimes: summaryRows,
      };
    },
  };
}

type LeaseRefreshCall = { jobId: string; workerId: string };

function stubQueue(refreshResult: boolean = true) {
  const calls = { heartbeatJobByWorker: [] as LeaseRefreshCall[] };
  return {
    calls,
    heartbeatJobByWorker: async (jobId: string, workerId: string) => {
      calls.heartbeatJobByWorker.push({ jobId, workerId });
      return refreshResult;
    },
  };
}

test('DaemonRegistryService proxies registration with kind=daemon', async () => {
  const workers = stubWorkers();
  const svc = new DaemonRegistryService(workers as never, stubQueue() as never);
  const catalog: AgentCatalogProvider[] = [
    {
      agentType: 'opencode',
      providerID: 'opencode',
      label: 'OpenCode',
      availability: 'ready',
      models: [{ providerID: 'anthropic', modelID: 'claude-opus-4.6', label: 'Claude Opus 4.6' }],
    },
  ];
  await svc.register({
    runtimeId: 'daemon-abc',
    name: 'laptop',
    supportedAgents: ['opencode'],
    version: '0.1.0',
    catalog,
  });
  assert.equal(workers.calls.register.length, 1);
  const record = workers.calls.register[0];
  assert.equal(record.kind, 'daemon');
  assert.equal(record.workerId, 'daemon-abc');
  assert.deepEqual(record.metadata, {
    mode: 'daemon',
    name: 'laptop',
    supportedAgents: ['opencode'],
    version: '0.1.0',
    catalog,
  });
});

test('DaemonRegistryService forwards heartbeat with activeJobId', async () => {
  const workers = stubWorkers();
  const svc = new DaemonRegistryService(workers as never, stubQueue() as never);
  await svc.heartbeat({ runtimeId: 'daemon-abc', activeJobId: 'job-1' });
  assert.deepEqual(workers.calls.heartbeat, [
    {
      workerId: 'daemon-abc',
      activeJobId: 'job-1',
      load: undefined,
      // No catalog supplied -> no metadata patch (preserves last-known catalog)
      metadataPatch: undefined,
    },
  ]);
});

test('DaemonRegistryService propagates a refreshed catalog through metadataPatch', async () => {
  const workers = stubWorkers();
  const svc = new DaemonRegistryService(workers as never, stubQueue() as never);
  const catalog: AgentCatalogProvider[] = [
    {
      agentType: 'cursor_agent',
      providerID: 'cursor_agent',
      label: 'Cursor Agent',
      availability: 'ready',
      models: [],
    },
  ];
  await svc.heartbeat({ runtimeId: 'daemon-abc', catalog });
  assert.deepEqual(workers.calls.heartbeat, [
    {
      workerId: 'daemon-abc',
      activeJobId: undefined,
      load: undefined,
      metadataPatch: { catalog },
    },
  ]);
});

test('DaemonRegistryService refreshes the active job lease on heartbeat', async () => {
  const workers = stubWorkers();
  const queue = stubQueue();
  const svc = new DaemonRegistryService(workers as never, queue as never);
  await svc.heartbeat({ runtimeId: 'daemon-abc', activeJobId: 'job-42' });
  assert.deepEqual(queue.calls.heartbeatJobByWorker, [
    { jobId: 'job-42', workerId: 'daemon-abc' },
  ]);
});

test('DaemonRegistryService skips lease refresh when no active job is reported', async () => {
  const workers = stubWorkers();
  const queue = stubQueue();
  const svc = new DaemonRegistryService(workers as never, queue as never);
  await svc.heartbeat({ runtimeId: 'daemon-abc' });
  assert.equal(queue.calls.heartbeatJobByWorker.length, 0);
});

test('DaemonRegistryService tolerates a stale activeJobId without throwing', async () => {
  const workers = stubWorkers();
  const queue = stubQueue(false);
  const svc = new DaemonRegistryService(workers as never, queue as never);
  // The daemon thinks it owns this job but the API has no matching running row.
  // The heartbeat must still succeed so the daemon is not marked degraded by an
  // out-of-band state discrepancy.
  await svc.heartbeat({ runtimeId: 'daemon-abc', activeJobId: 'job-stale' });
  assert.deepEqual(queue.calls.heartbeatJobByWorker, [
    { jobId: 'job-stale', workerId: 'daemon-abc' },
  ]);
});

test('DaemonRegistryService marks the worker stopped on deregister', async () => {
  const workers = stubWorkers();
  const svc = new DaemonRegistryService(workers as never, stubQueue() as never);
  await svc.deregister('daemon-abc');
  assert.deepEqual(workers.calls.stopped, ['daemon-abc']);
});

test('getMergedCatalog returns null when no daemon is online', async () => {
  const workers = stubWorkers([]);
  const svc = new DaemonRegistryService(workers as never, stubQueue() as never);
  const catalog = await svc.getMergedCatalog();
  assert.equal(catalog, null);
});

test('getMergedCatalog merges providers across daemons, first-seen wins', async () => {
  const opencodeProvider: AgentCatalogProvider = {
    agentType: 'opencode',
    providerID: 'opencode',
    label: 'OpenCode (newest)',
    availability: 'ready',
    models: [{ providerID: 'anthropic', modelID: 'claude-opus-4.6', label: 'Claude Opus 4.6' }],
  };
  const cursorProvider: AgentCatalogProvider = {
    agentType: 'cursor_agent',
    providerID: 'cursor_agent',
    label: 'Cursor Agent',
    availability: 'ready',
    models: [],
  };
  const stalerOpencode: AgentCatalogProvider = {
    ...opencodeProvider,
    label: 'OpenCode (stale)',
  };
  const workers = stubWorkers([
    {
      id: 'daemon-newest',
      lastSeenAt: new Date('2026-04-20T10:00:00Z'),
      host: 'host-newest',
      metadata: { catalog: [opencodeProvider] },
    },
    {
      id: 'daemon-old',
      lastSeenAt: new Date('2026-04-19T10:00:00Z'),
      host: 'host-old',
      metadata: { catalog: [stalerOpencode, cursorProvider] },
    },
  ]);
  const svc = new DaemonRegistryService(workers as never, stubQueue() as never);
  const merged = await svc.getMergedCatalog();
  assert.ok(merged);
  assert.deepEqual(
    merged!.providers.map((p) => `${p.agentType}:${p.label}`),
    ['opencode:OpenCode (newest)', 'cursor_agent:Cursor Agent'],
  );
});
