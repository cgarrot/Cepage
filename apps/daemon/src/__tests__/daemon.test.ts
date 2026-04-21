import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Daemon } from '../daemon.js';
import { DaemonApiClient } from '../client.js';
import { HealthServer } from '../health-server.js';
import { JobRunner } from '../job-runner.js';
import { RuntimeRegistry } from '../runtime-registry.js';
import { WorkspaceManager } from '../workspace.js';
import type { DaemonConfig } from '../config.js';
import { createLogger } from '../logger.js';

type RecordedCall = {
  url: string;
  method: string;
  body: string | null;
};

function buildFetch(handlers: {
  onRegister?: () => { pollIntervalMs: number; heartbeatIntervalMs: number };
  onClaim?: () => 204 | Record<string, unknown>;
  onClaimSequence?: (Record<string, unknown> | 204)[];
  onHeartbeat?: () => Record<string, unknown>;
  onJobStart?: (jobId: string) => Record<string, unknown> | undefined;
}) {
  const calls: RecordedCall[] = [];
  const claimQueue = handlers.onClaimSequence ? [...handlers.onClaimSequence] : null;
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });
    if (url.endsWith('/register')) {
      const payload =
        handlers.onRegister?.() ?? { pollIntervalMs: 25, heartbeatIntervalMs: 50 };
      return new Response(JSON.stringify({ runtimeId: 'daemon-test', ...payload }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/heartbeat')) {
      const payload = handlers.onHeartbeat?.() ?? { cancelledJobIds: [] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/deregister')) {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/claim')) {
      let outcome: 204 | Record<string, unknown> = 204;
      if (claimQueue) {
        outcome = claimQueue.shift() ?? 204;
      } else {
        outcome = handlers.onClaim?.() ?? 204;
      }
      if (outcome === 204) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(outcome), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const startMatch = url.match(/\/jobs\/([^/]+)\/start$/);
    if (startMatch) {
      const jobId = startMatch[1];
      const payload = handlers.onJobStart?.(jobId) ?? { kind: 'agent_run' };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/jobs/') && (url.endsWith('/messages') || url.endsWith('/complete') || url.endsWith('/fail'))) {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };
  return { impl, calls };
}

function buildConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    apiBaseUrl: 'http://localhost:3001',
    runtimeId: 'daemon-test',
    name: 'test-daemon',
    workspaceRoot: '/tmp/cepage-daemon-test',
    healthPort: 0,
    pollIntervalMs: 25,
    heartbeatIntervalMs: 50,
    logLevel: 'error',
    supportedAgents: ['opencode'],
    version: '0.1.0-test',
    ...overrides,
  };
}

test('daemon registers, heartbeats, and deregisters through the HTTP client', async () => {
  const fetchMock = buildFetch({});
  const config = buildConfig();
  const client = new DaemonApiClient({
    baseUrl: config.apiBaseUrl,
    runtimeId: config.runtimeId,
    fetchImpl: fetchMock.impl,
  });
  const logger = createLogger({ level: 'error' });
  const health = new HealthServer(0, () => ({
    runtimeId: config.runtimeId,
    startedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    status: 'starting',
  }), logger);
  const daemon = new Daemon(config, { client, logger, healthServer: health });

  await daemon.start();
  // Give the poll loop a chance to tick at least once.
  await sleep(80);
  await daemon.stop();

  const urls = fetchMock.calls.map((c) => c.url);
  const registerCalls = urls.filter((u) => u.endsWith('/register')).length;
  const heartbeatCalls = urls.filter((u) => u.endsWith('/heartbeat')).length;
  const claimCalls = urls.filter((u) => u.endsWith('/claim')).length;
  const deregisterCalls = urls.filter((u) => u.endsWith('/deregister')).length;

  assert.equal(registerCalls, 1, 'daemon should register exactly once');
  assert.ok(claimCalls >= 1, 'daemon should poll at least once');
  assert.ok(heartbeatCalls >= 1, 'daemon should heartbeat at least once');
  assert.equal(deregisterCalls, 1, 'daemon should deregister on stop');

  const registerCall = fetchMock.calls.find((c) => c.url.endsWith('/register'));
  assert.ok(registerCall?.body);
  const parsed = JSON.parse(registerCall.body ?? '{}');
  assert.equal(parsed.runtimeId, config.runtimeId);
  assert.deepEqual(parsed.supportedAgents, ['opencode']);
});

test('daemon spawns a runtime_start process and streams stdout to the API', async () => {
  let claimCount = 0;
  const fetchMock = buildFetch({
    onClaim: () => {
      claimCount += 1;
      if (claimCount === 1) {
        return {
          id: 'job-start',
          kind: 'runtime_start',
          leaseToken: 'lease-start',
          payload: { sessionId: 'sess-1', operation: 'start', targetNodeId: 'tgt-1' },
        };
      }
      return 204;
    },
    onJobStart: (jobId) => {
      if (jobId === 'job-start') {
        return {
          kind: 'runtime_start',
          runNodeId: 'run-node-1',
          spec: {
            command: '/bin/echo',
            args: ['hello'],
            cwd: '/tmp',
            env: {},
            ports: [],
          },
        };
      }
      return undefined;
    },
  });
  const config = buildConfig();
  const client = new DaemonApiClient({
    baseUrl: config.apiBaseUrl,
    runtimeId: config.runtimeId,
    fetchImpl: fetchMock.impl,
  });
  const logger = createLogger({ level: 'error' });
  const health = new HealthServer(0, () => ({
    runtimeId: config.runtimeId,
    startedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    status: 'starting',
  }), logger);
  const fakeChild = makeFakeChildProcess();
  const registry = new RuntimeRegistry({
    logger,
    spawnImpl: ((command: string, args: readonly string[]) => {
      void command;
      void args;
      return fakeChild as unknown as ReturnType<typeof import('node:child_process').spawn>;
    }) as unknown as typeof import('node:child_process').spawn,
    probeImpl: async () => true,
  });
  const workspace = new WorkspaceManager(config.workspaceRoot);
  const jobRunner = new JobRunner({
    client,
    workspace,
    logger,
    runtimeRegistry: registry,
    flushIntervalMs: 5,
    maxBatchSize: 4,
  });
  const daemon = new Daemon(config, {
    client,
    logger,
    healthServer: health,
    workspace,
    runtimeRegistry: registry,
    jobRunner,
  });

  await daemon.start();
  await sleep(60);
  fakeChild.emitStdout('hello world\n');
  await sleep(40);
  fakeChild.emitExit(0, null);
  await sleep(60);
  await daemon.stop();

  const startCall = fetchMock.calls.find((c) => c.url.endsWith('/jobs/job-start/start'));
  assert.ok(startCall, 'daemon should call the start endpoint');
  const messageCalls = fetchMock.calls.filter((c) => c.url.endsWith('/jobs/job-start/messages'));
  assert.ok(messageCalls.length >= 1, 'daemon should report runtime messages');
  const flatMessages = messageCalls.flatMap((c) => {
    const parsed = JSON.parse(c.body ?? '{}') as { messages?: { type: string; payload?: { chunk?: string; status?: string } }[] };
    return parsed.messages ?? [];
  });
  assert.ok(
    flatMessages.some((m) => m.type === 'status' && m.payload?.status === 'started'),
    'should report status started',
  );
  assert.ok(
    flatMessages.some((m) => m.type === 'stdout' && typeof m.payload?.chunk === 'string'),
    'should report stdout chunks',
  );
  const completeCall = fetchMock.calls.find((c) => c.url.endsWith('/jobs/job-start/complete'));
  assert.ok(completeCall, 'daemon should mark runtime_start complete after process exit');
  const completeBody = JSON.parse(completeCall.body ?? '{}') as { result?: { exitCode?: number | null; runNodeId?: string } };
  assert.equal(completeBody.result?.exitCode, 0);
  assert.equal(completeBody.result?.runNodeId, 'run-node-1');
});

test('daemon stops a tracked runtime process when handed a runtime_stop job', async () => {
  // First claim returns a runtime_start, second returns a runtime_stop, the rest 204.
  const startResponses: Record<string, Record<string, unknown>> = {
    'job-start': {
      kind: 'runtime_start',
      runNodeId: 'run-node-2',
      spec: {
        command: '/bin/sleep',
        args: ['30'],
        cwd: '/tmp',
        env: {},
        ports: [],
      },
    },
    'job-stop': {
      kind: 'runtime_stop',
      runNodeId: 'run-node-2',
    },
  };
  let claimCount = 0;
  const fetchMock = buildFetch({
    onClaim: () => {
      claimCount += 1;
      if (claimCount === 1) {
        return {
          id: 'job-start',
          kind: 'runtime_start',
          leaseToken: 'lease-a',
          payload: { sessionId: 'sess-2', operation: 'start', targetNodeId: 'tgt-2' },
        };
      }
      if (claimCount === 2) {
        return {
          id: 'job-stop',
          kind: 'runtime_stop',
          leaseToken: 'lease-b',
          payload: { sessionId: 'sess-2', operation: 'stop', runNodeId: 'run-node-2' },
        };
      }
      return 204;
    },
    onJobStart: (jobId) => startResponses[jobId],
  });
  const config = buildConfig();
  const client = new DaemonApiClient({
    baseUrl: config.apiBaseUrl,
    runtimeId: config.runtimeId,
    fetchImpl: fetchMock.impl,
  });
  const logger = createLogger({ level: 'error' });
  const health = new HealthServer(0, () => ({
    runtimeId: config.runtimeId,
    startedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    status: 'starting',
  }), logger);
  const fakeChild = makeFakeChildProcess();
  const registry = new RuntimeRegistry({
    logger,
    spawnImpl: (() => fakeChild as unknown as ReturnType<typeof import('node:child_process').spawn>) as unknown as typeof import('node:child_process').spawn,
    probeImpl: async () => true,
  });
  const workspace = new WorkspaceManager(config.workspaceRoot);
  const jobRunner = new JobRunner({
    client,
    workspace,
    logger,
    runtimeRegistry: registry,
    flushIntervalMs: 5,
    maxBatchSize: 4,
  });
  const daemon = new Daemon(config, {
    client,
    logger,
    healthServer: health,
    workspace,
    runtimeRegistry: registry,
    jobRunner,
  });

  await daemon.start();
  // Wait for start poll → spawn → status
  await sleep(80);
  // Wait for second claim → runtime_stop → kill → child exit
  await sleep(120);
  await daemon.stop();

  const stopCompleteCall = fetchMock.calls.find((c) => c.url.endsWith('/jobs/job-stop/complete'));
  assert.ok(stopCompleteCall, 'daemon should complete the runtime_stop job');
  const stopBody = JSON.parse(stopCompleteCall.body ?? '{}') as { result?: { stopped?: boolean; runNodeId?: string } };
  assert.equal(stopBody.result?.runNodeId, 'run-node-2');
  assert.equal(stopBody.result?.stopped, true);
  assert.ok(fakeChild.killed, 'fake child should have received a kill signal');
});

function makeFakeChildProcess() {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (enc: BufferEncoding) => void };
  stdout.setEncoding = () => {};
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (enc: BufferEncoding) => void };
  stderr.setEncoding = () => {};
  let killed = false;
  return {
    pid: 4242,
    stdout,
    stderr,
    once: emitter.once.bind(emitter),
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
    get killed() {
      return killed;
    },
    kill: (signal?: NodeJS.Signals) => {
      killed = true;
      // Schedule the exit on the next tick so the registry has time to
      // wire its `once('exit', ...)` callback before we fire it.
      setTimeout(() => {
        emitter.emit('exit', null, signal ?? 'SIGTERM');
      }, 5);
      return true;
    },
    emitStdout: (chunk: string) => stdout.emit('data', chunk),
    emitStderr: (chunk: string) => stderr.emit('data', chunk),
    emitExit: (code: number | null, signal: NodeJS.Signals | null) =>
      emitter.emit('exit', code, signal),
  };
}

test('daemon surfaces degraded state when register fails', async () => {
  const failingFetch: typeof fetch = async () => new Response('boom', { status: 500 });
  const config = buildConfig();
  const client = new DaemonApiClient({
    baseUrl: config.apiBaseUrl,
    runtimeId: config.runtimeId,
    fetchImpl: failingFetch,
  });
  const logger = createLogger({ level: 'error' });
  const health = new HealthServer(0, () => ({
    runtimeId: config.runtimeId,
    startedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    status: 'starting',
  }), logger);
  const daemon = new Daemon(config, { client, logger, healthServer: health });

  await assert.rejects(() => daemon.start());
  const state = daemon.getState();
  assert.equal(state.status, 'degraded');
  assert.ok(state.lastError);
  await daemon.stop();
});
