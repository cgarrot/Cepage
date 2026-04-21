import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowControllerState } from '@cepage/shared-core';
import type { LiveRunDescriptor } from '../workspace-types.js';
import {
  deriveActiveControllers,
  deriveActiveRuns,
  indexControllers,
  upsertController,
} from '../live.js';

function controller(
  input: Partial<WorkflowControllerState> & Pick<WorkflowControllerState, 'id' | 'status'>,
): WorkflowControllerState {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'session-1',
    controllerNodeId: input.controllerNodeId ?? 'loop-1',
    parentExecutionId: input.parentExecutionId,
    executionId: input.executionId,
    currentChildExecutionId: input.currentChildExecutionId,
    currentChildRunId: input.currentChildRunId,
    status: input.status,
    mode: input.mode ?? 'for_each',
    sourceKind: input.sourceKind ?? 'inline_list',
    currentIndex: input.currentIndex,
    totalItems: input.totalItems ?? 2,
    attemptsTotal: input.attemptsTotal ?? 0,
    lastDecision: input.lastDecision,
    lastDecisionDetail: input.lastDecisionDetail,
    completedSummaries: input.completedSummaries ?? [],
    items: input.items ?? [],
    data: input.data ?? {},
    startedAt: input.startedAt ?? '2026-04-03T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-04-03T10:00:00.000Z',
    endedAt: input.endedAt,
  };
}

function run(input: Partial<LiveRunDescriptor> & Pick<LiveRunDescriptor, 'id' | 'status' | 'type'>): LiveRunDescriptor {
  return {
    id: input.id,
    executionId: input.executionId,
    type: input.type,
    status: input.status,
    agentLabel: input.agentLabel ?? 'Builder',
    model: input.model,
    workspacePath: input.workspacePath,
    rootNodeId: input.rootNodeId,
    outputNodeId: input.outputNodeId,
    sourceNodeId: input.sourceNodeId,
    triggerNodeId: input.triggerNodeId,
    stepNodeId: input.stepNodeId,
    seedNodeIds: input.seedNodeIds ?? [],
    output: input.output ?? '',
    isStreaming: input.isStreaming ?? false,
    isActive: input.isActive ?? false,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    lastUpdateAt: input.lastUpdateAt ?? '2026-04-03T10:00:00.000Z',
  };
}

test('deriveActiveControllers keeps active loop controllers sorted by latest update', () => {
  const rows = indexControllers([
    controller({
      id: 'ctl-complete',
      status: 'completed',
      updatedAt: '2026-04-03T10:10:00.000Z',
      endedAt: '2026-04-03T10:10:00.000Z',
    }),
    controller({
      id: 'ctl-retry',
      status: 'retrying',
      updatedAt: '2026-04-03T10:11:00.000Z',
    }),
  ]);
  const next = upsertController(
    rows,
    controller({
      id: 'ctl-live',
      status: 'blocked',
      updatedAt: '2026-04-03T10:12:00.000Z',
    }),
  );

  assert.deepEqual(
    deriveActiveControllers(next).map((row) => [row.id, row.status]),
    [
      ['ctl-live', 'blocked'],
      ['ctl-retry', 'retrying'],
    ],
  );
});

test('deriveActiveRuns keeps only active runs sorted by last update', () => {
  const rows = deriveActiveRuns([
    run({
      id: 'run-old',
      type: 'opencode',
      status: 'running',
      isActive: true,
      lastUpdateAt: '2026-04-03T10:01:00.000Z',
    }),
    run({
      id: 'run-idle',
      type: 'opencode',
      status: 'completed',
      isActive: false,
      lastUpdateAt: '2026-04-03T10:03:00.000Z',
    }),
    run({
      id: 'run-new',
      type: 'orchestrator',
      status: 'running',
      isActive: true,
      lastUpdateAt: '2026-04-03T10:02:00.000Z',
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.id),
    ['run-new', 'run-old'],
  );
});
