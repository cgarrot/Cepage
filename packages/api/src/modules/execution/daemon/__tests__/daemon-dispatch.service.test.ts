import assert from 'node:assert/strict';
import test from 'node:test';
import { DaemonDispatchService } from '../daemon-dispatch.service.js';

test('emitAgentStatus notifies managed-flow listeners for daemon-owned runs', () => {
  const events: unknown[] = [];
  const notifications: Array<{ sessionId: string; run: { id?: string; status?: string } }> = [];
  const svc = new DaemonDispatchService(
    {} as never,
    {} as never,
    {
      emitSession: (_sessionId: string, event: unknown) => {
        events.push(event);
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      notifyAgentStatus: (sessionId: string, run: { id?: string; status?: string }) => {
        notifications.push({ sessionId, run });
      },
    } as never,
  );

  (svc as unknown as {
    emitAgentStatus: (
      ctx: {
        payload: { sessionId: string; runId: string };
        baseRun: { id: string; sessionId: string; role: string };
        buffer: string;
      },
      status: string,
      endedAtIso?: string,
    ) => void;
  }).emitAgentStatus(
    {
      payload: { sessionId: 'session-1', runId: 'run-1' },
      baseRun: { id: 'run-1', sessionId: 'session-1', role: 'builder' },
      buffer: 'done',
    },
    'completed',
    '2026-04-25T10:00:00.000Z',
  );

  assert.equal(events.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].sessionId, 'session-1');
  assert.equal(notifications[0].run.id, 'run-1');
  assert.equal(notifications[0].run.status, 'completed');
});
