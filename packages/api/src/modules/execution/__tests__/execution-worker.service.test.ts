import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionJobKind } from '@cepage/shared-core';
import { DAEMON_JOB_KINDS } from '../daemon/daemon-dispatch.service.js';
import { ExecutionWorkerService } from '../execution-worker.service.js';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/cepage?schema=public';
process.env.EXECUTION_WORKER_MODE = 'api';
// Tighten the poll loop so the runLoop test doesn't block on the default 400ms.
process.env.EXECUTION_WORKER_POLL_MS = '5';

type ClaimFilter = { includeKinds?: ExecutionJobKind[]; excludeKinds?: ExecutionJobKind[] };

function createService(claimRecorder: { last?: ClaimFilter }) {
  return new ExecutionWorkerService(
    {
      claimNextJob: async (_workerId: string, filter?: ClaimFilter) => {
        claimRecorder.last = filter;
        return null;
      },
    } as never,
    {} as never, // workers
    {} as never, // recovery
    {} as never, // scheduler
    {} as never, // watches
    {} as never, // approvals
    {} as never, // controllers
    {} as never, // flows
    {} as never, // connectors
    {} as never, // activity
  );
}

test('runLoop excludes daemon-owned job kinds from claim filter', async () => {
  const recorder: { last?: ClaimFilter } = {};
  const service = createService(recorder) as unknown as {
    running: boolean;
    runLoop: () => Promise<void>;
  };
  service.running = true;
  const loop = service.runLoop();
  // Wait long enough for one claim attempt + the short poll sleep.
  await new Promise((resolve) => setTimeout(resolve, 30));
  service.running = false;
  await loop;
  assert.deepEqual(recorder.last, { excludeKinds: DAEMON_JOB_KINDS });
});

test('dispatch refuses daemon-owned job kinds with an actionable error', async () => {
  const service = createService({}) as unknown as {
    dispatch: (kind: string, payload: Record<string, unknown>) => Promise<unknown>;
  };
  for (const kind of DAEMON_JOB_KINDS) {
    await assert.rejects(
      () => service.dispatch(kind, {}),
      (err: Error) => err.message === `DAEMON_JOB_KIND_REJECTED:${kind}`,
    );
  }
});
