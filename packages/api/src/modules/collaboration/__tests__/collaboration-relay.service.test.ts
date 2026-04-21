import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRelayService } from '../collaboration-relay.service.js';

const CHANNEL = 'cepage_collaboration_events';

test('relay hydrates activity events from the database row', async () => {
  const now = new Date('2026-04-08T12:00:00.000Z');
  const service = new CollaborationRelayService({
    graphEvent: { findUnique: async () => null },
    activityEntry: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'activity-1'
          ? {
              id: 'activity-1',
              sessionId: 'session-1',
              timestamp: now,
              actorType: 'system',
              actorId: 'worker-1',
              runId: 'run-1',
              wakeReason: 'manual',
              requestId: 'req-1',
              workerId: 'worker-1',
              worktreeId: 'worktree-1',
              summary: 'Audit completed',
              summaryKey: 'activity.audit.completed',
              summaryParams: { phase: 'audit' },
              metadata: { file: 'outputs/gap-report.json' },
              relatedNodeIds: ['audit-step'],
            }
          : null,
    },
    workflowManagedFlow: { findUnique: async () => null },
    workflowControllerState: { findUnique: async () => null },
    agentRun: { findUnique: async () => null },
  } as never);
  const seen: Array<{ instanceId: string; event: { type: string; payload: unknown } }> = [];

  service.subscribe((msg) => {
    seen.push(msg as { instanceId: string; event: { type: string; payload: unknown } });
  });

  await relayHandle(service, {
    kind: 'activity',
    instanceId: 'worker-2',
    sessionId: 'session-1',
    eventId: 0,
    activityId: 'activity-1',
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.instanceId, 'worker-2');
  assert.equal(seen[0]?.event.type, 'activity.logged');
  assert.deepEqual(seen[0]?.event.payload, {
    id: 'activity-1',
    summary: 'Audit completed',
    summaryKey: 'activity.audit.completed',
    summaryParams: { phase: 'audit' },
    metadata: { file: 'outputs/gap-report.json' },
    relatedNodeIds: ['audit-step'],
  });
});

test('relay hydrates managed flow events from persisted state', async () => {
  const now = new Date('2026-04-08T12:05:00.000Z');
  const service = new CollaborationRelayService({
    graphEvent: { findUnique: async () => null },
    activityEntry: { findUnique: async () => null },
    workflowManagedFlow: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'flow-1'
          ? {
              id: 'flow-1',
              sessionId: 'session-1',
              entryNodeId: 'flow-node',
              status: 'running',
              syncMode: 'managed',
              revision: 3,
              currentPhaseId: 'audit',
              currentPhaseIndex: 0,
              cancelRequested: false,
              wait: null,
              state: {
                phases: [
                  {
                    id: 'audit',
                    kind: 'agent_phase',
                    nodeId: 'audit-step',
                    expectedOutputs: ['outputs/gap-report.json'],
                  },
                ],
                phaseRecords: {
                  audit: {
                    phaseId: 'audit',
                    kind: 'agent_phase',
                    status: 'running',
                    attempts: 1,
                    nodeId: 'audit-step',
                    updatedAt: now.toISOString(),
                  },
                },
                state: { phaseRequestKeys: { audit: 'key-1' } },
                lastDetail: 'refreshing gap report',
              },
              startedAt: now,
              endedAt: null,
              updatedAt: now,
            }
          : null,
    },
    workflowControllerState: { findUnique: async () => null },
    agentRun: { findUnique: async () => null },
  } as never);
  const seen: Array<{ instanceId: string; event: { type: string; payload: { id: string; state: unknown } } }> = [];

  service.subscribe((msg) => {
    seen.push(msg as { instanceId: string; event: { type: string; payload: { id: string; state: unknown } } });
  });

  await relayHandle(service, {
    kind: 'flow',
    instanceId: 'worker-3',
    sessionId: 'session-1',
    eventId: 0,
    flowId: 'flow-1',
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.instanceId, 'worker-3');
  assert.equal(seen[0]?.event.type, 'workflow.flow_updated');
  assert.equal(seen[0]?.event.payload.id, 'flow-1');
  assert.deepEqual(seen[0]?.event.payload.state, { phaseRequestKeys: { audit: 'key-1' } });
});

async function relayHandle(service: CollaborationRelayService, payload: Record<string, unknown>): Promise<void> {
  await (
    service as unknown as {
      handleNotification(msg: { channel: string; payload: string }): Promise<void>;
    }
  ).handleNotification({
    channel: CHANNEL,
    payload: JSON.stringify(payload),
  });
}
