import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AgentLifecycleStatus,
  WorkflowControllerState,
  WorkflowManagedFlowContent,
  WorkflowManagedFlowPhase,
  WorkflowManagedFlowPhaseRecord,
  WorkflowManagedFlowRunResult,
  WorkflowManagedFlowState,
} from '@cepage/shared-core';
import {
  readWorkflowManagedFlowState,
  workflowManagedFlowRunResultSchema,
} from '@cepage/shared-core';

export const ACTIVE_AGENT_STATUSES = new Set<AgentLifecycleStatus>([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
]);

export const ACTIVE_CONTROLLER_STATUSES = new Set<WorkflowControllerState['status']>([
  'pending',
  'running',
  'retrying',
]);

export const TERMINAL_FLOW_STATUSES = new Set<WorkflowManagedFlowState['status']>([
  'completed',
  'failed',
  'cancelled',
]);

export type FlowAdvance = 'continue' | 'yield' | 'stop';

export type PhaseEvaluation = {
  outcome: 'pass' | 'complete' | 'retry_same_item' | 'retry_new_execution' | 'block' | 'request_human';
  detail: string;
};

export function assertPhaseIds(content: WorkflowManagedFlowContent): void {
  const ids = new Set<string>();
  for (const phase of content.phases) {
    if (ids.has(phase.id)) {
      throw new BadRequestException('WORKFLOW_MANAGED_FLOW_PHASE_DUPLICATE');
    }
    ids.add(phase.id);
  }
  if (content.entryPhaseId && !ids.has(content.entryPhaseId)) {
    throw new BadRequestException('WORKFLOW_MANAGED_FLOW_ENTRY_PHASE_MISSING');
  }
}

export function initialPhaseRecord(
  phase: WorkflowManagedFlowPhase,
  updatedAt: string,
): WorkflowManagedFlowPhaseRecord {
  return {
    phaseId: phase.id,
    kind: phase.kind,
    status: 'pending',
    attempts: 0,
    ...(phase.kind === 'validation_phase'
      ? { nodeId: phase.validatorNodeId }
      : phase.kind === 'derive_input_phase'
        ? { nodeId: phase.sourceNodeId }
        : 'nodeId' in phase
          ? { nodeId: phase.nodeId }
          : {}),
    updatedAt,
  };
}

export function phaseForceRestartIds(state: WorkflowManagedFlowState): Set<string> {
  const current = state.state && typeof state.state === 'object' && !Array.isArray(state.state) ? state.state : {};
  const raw = (current as { forceRestartPhaseIds?: unknown }).forceRestartPhaseIds;
  if (!Array.isArray(raw)) {
    return new Set<string>();
  }
  return new Set(
    raw.flatMap((value) => (typeof value === 'string' && value.trim() ? [value.trim()] : [])),
  );
}

export function withPhaseRestart(
  state: WorkflowManagedFlowState,
  phaseId: string,
  enabled: boolean,
): WorkflowManagedFlowState['state'] {
  const current = state.state && typeof state.state === 'object' && !Array.isArray(state.state) ? { ...state.state } : {};
  const ids = phaseForceRestartIds(state);
  if (enabled) {
    ids.add(phaseId);
  } else {
    ids.delete(phaseId);
  }
  if (ids.size === 0) {
    delete (current as { forceRestartPhaseIds?: unknown }).forceRestartPhaseIds;
    return current;
  }
  return {
    ...current,
    forceRestartPhaseIds: [...ids].sort((a, b) => a.localeCompare(b)),
  };
}

export function phaseRequestKeys(state: WorkflowManagedFlowState): Record<string, string> {
  const curr = state.state && typeof state.state === 'object' && !Array.isArray(state.state) ? state.state : {};
  const raw = (curr as { phaseRequestKeys?: unknown }).phaseRequestKeys;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw)
      .flatMap(([id, value]) => (typeof value === 'string' && value.trim() ? [[id, value.trim()]] : []))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function withPhaseRequestReset(
  state: WorkflowManagedFlowState,
  phaseIds: string[],
): WorkflowManagedFlowState['state'] {
  const curr = state.state && typeof state.state === 'object' && !Array.isArray(state.state) ? { ...state.state } : {};
  const ids = [...new Set(phaseIds.filter((value) => value.trim()))].sort((a, b) => a.localeCompare(b));
  const keys = {
    ...phaseRequestKeys(state),
  };
  for (const id of ids) {
    keys[id] = randomUUID();
  }
  return {
    ...curr,
    phaseRequestKeys: Object.fromEntries(
      Object.entries(keys).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function phaseRequestId(
  state: WorkflowManagedFlowState,
  phaseId: string,
  attempt: number,
): string {
  const key = phaseRequestKeys(state)[phaseId] ?? phaseId;
  return `workflow-flow:${state.id}:${key}:${phaseId}:${attempt}`;
}

export function buildInitialFlowState(input: {
  flowId: string;
  sessionId: string;
  entryNodeId: string;
  content: WorkflowManagedFlowContent;
  revision: number;
  now: string;
  forceRestart?: boolean;
}): WorkflowManagedFlowState {
  const entryPhaseId = input.content.entryPhaseId ?? input.content.phases[0]?.id;
  const currentPhaseIndex = input.content.phases.findIndex((phase) => phase.id === entryPhaseId);
  if (!entryPhaseId || currentPhaseIndex < 0) {
    throw new BadRequestException('WORKFLOW_MANAGED_FLOW_ENTRY_PHASE_INVALID');
  }
  return {
    id: input.flowId,
    sessionId: input.sessionId,
    entryNodeId: input.entryNodeId,
    syncMode: input.content.syncMode,
    status: 'queued',
    revision: input.revision,
    currentPhaseId: entryPhaseId,
    currentPhaseIndex,
    phases: input.content.phases,
    phaseRecords: Object.fromEntries(
      input.content.phases.map((phase) => [phase.id, initialPhaseRecord(phase, input.now)]),
    ),
    state: {
      phaseRequestKeys: Object.fromEntries(
        input.content.phases
          .map((phase) => [phase.id, randomUUID()] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      ...(input.forceRestart
        ? {
            forceRestartPhaseIds: input.content.phases.map((phase) => phase.id),
          }
        : {}),
    },
    cancelRequested: false,
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export function serializeFlowState(row: {
  id: string;
  sessionId: string;
  entryNodeId: string;
  status: string;
  syncMode: string;
  revision: number;
  currentPhaseId: string | null;
  currentPhaseIndex: number | null;
  cancelRequested: boolean;
  wait: unknown;
  state: unknown;
  startedAt: Date;
  endedAt: Date | null;
  updatedAt: Date;
}): WorkflowManagedFlowState {
  const parsed = readWorkflowManagedFlowState({
    ...(row.state && typeof row.state === 'object' && !Array.isArray(row.state)
      ? (row.state as Record<string, unknown>)
      : {}),
    id: row.id,
    sessionId: row.sessionId,
    entryNodeId: row.entryNodeId,
    status: row.status,
    syncMode: row.syncMode,
    revision: row.revision,
    ...(row.currentPhaseId ? { currentPhaseId: row.currentPhaseId } : {}),
    ...(row.currentPhaseIndex != null ? { currentPhaseIndex: row.currentPhaseIndex } : {}),
    cancelRequested: row.cancelRequested,
    ...(row.wait && typeof row.wait === 'object' ? { wait: row.wait } : {}),
    startedAt: row.startedAt.toISOString(),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed) {
    throw new Error(`INVALID_WORKFLOW_MANAGED_FLOW_STATE:${row.id}`);
  }
  return parsed;
}

export function flowJson(state: WorkflowManagedFlowState): Prisma.InputJsonValue {
  return {
    phases: state.phases,
    phaseRecords: state.phaseRecords,
    state: state.state,
    ...(state.lastDetail ? { lastDetail: state.lastDetail } : {}),
  } as Prisma.InputJsonValue;
}

export function currentPhase(state: WorkflowManagedFlowState): WorkflowManagedFlowPhase | null {
  if (state.currentPhaseId) {
    return state.phases.find((phase) => phase.id === state.currentPhaseId) ?? null;
  }
  if (state.currentPhaseIndex != null) {
    return state.phases[state.currentPhaseIndex] ?? null;
  }
  return state.phases[0] ?? null;
}

export function phaseRecord(
  state: WorkflowManagedFlowState,
  phase: WorkflowManagedFlowPhase,
): WorkflowManagedFlowPhaseRecord {
  return state.phaseRecords[phase.id] ?? initialPhaseRecord(phase, state.updatedAt);
}

export function phaseIndex(state: WorkflowManagedFlowState, phaseId: string): number {
  return state.phases.findIndex((phase) => phase.id === phaseId);
}

export function waitingState(
  state: WorkflowManagedFlowState,
  phase: WorkflowManagedFlowPhase,
  record: WorkflowManagedFlowPhaseRecord,
  wait: WorkflowManagedFlowState['wait'],
): WorkflowManagedFlowState {
  return {
    ...state,
    status: 'waiting',
    wait,
    lastDetail: record.detail,
    updatedAt: new Date().toISOString(),
    phaseRecords: {
      ...state.phaseRecords,
      [phase.id]: record,
    },
  };
}

export function completedState(
  state: WorkflowManagedFlowState,
  phase: WorkflowManagedFlowPhase,
  record: WorkflowManagedFlowPhaseRecord,
  detail: string,
  nextPhaseId?: string,
): WorkflowManagedFlowState {
  const now = new Date().toISOString();
  const currentIndex = phaseIndex(state, phase.id);
  const nextIndex =
    nextPhaseId
      ? phaseIndex(state, nextPhaseId)
      : currentIndex >= 0
        ? currentIndex + 1
        : state.currentPhaseIndex != null
          ? state.currentPhaseIndex + 1
          : state.phases.length;
  const hasNext = nextIndex >= 0 && nextIndex < state.phases.length;
  const revisit = hasNext && currentIndex >= 0 && nextIndex <= currentIndex;
  const phaseRecords: WorkflowManagedFlowState['phaseRecords'] = {
    ...state.phaseRecords,
    [phase.id]: {
      ...record,
      status: 'completed',
      detail,
      endedAt: now,
      updatedAt: now,
    },
  };
  let nextState = state.state;
  if (revisit) {
    const ids: string[] = [];
    for (let index = nextIndex; index < state.phases.length; index += 1) {
      const current = state.phases[index];
      if (!current || current.id === phase.id) {
        continue;
      }
      phaseRecords[current.id] = initialPhaseRecord(current, now);
      ids.push(current.id);
    }
    if (ids.length > 0) {
      nextState = withPhaseRequestReset({ ...state, state: nextState }, ids);
    }
    const target = state.phases[nextIndex];
    if (target?.kind === 'loop_phase') {
      nextState = withPhaseRestart({ ...state, state: nextState }, target.id, true);
    }
  }
  return {
    ...state,
    status: hasNext ? 'running' : 'completed',
    currentPhaseId: hasNext ? state.phases[nextIndex]?.id : undefined,
    currentPhaseIndex: hasNext ? nextIndex : undefined,
    wait: undefined,
    state: nextState,
    lastDetail: detail,
    updatedAt: now,
    ...(hasNext ? { endedAt: undefined } : { endedAt: now }),
    phaseRecords,
  };
}

export function blockedState(
  state: WorkflowManagedFlowState,
  phase: WorkflowManagedFlowPhase,
  record: WorkflowManagedFlowPhaseRecord,
  detail: string,
): WorkflowManagedFlowState {
  const now = new Date().toISOString();
  return {
    ...state,
    status: 'blocked',
    wait: {
      kind: 'manual',
      phaseId: phase.id,
      reason: detail,
    },
    lastDetail: detail,
    updatedAt: now,
    phaseRecords: {
      ...state.phaseRecords,
      [phase.id]: {
        ...record,
        status: 'failed',
        detail,
        endedAt: now,
        updatedAt: now,
      },
    },
  };
}

export function failedState(
  state: WorkflowManagedFlowState,
  phase: WorkflowManagedFlowPhase,
  record: WorkflowManagedFlowPhaseRecord,
  detail: string,
  status: WorkflowManagedFlowState['status'] = 'failed',
): WorkflowManagedFlowState {
  const now = new Date().toISOString();
  return {
    ...state,
    status,
    wait: undefined,
    lastDetail: detail,
    updatedAt: now,
    endedAt: now,
    phaseRecords: {
      ...state.phaseRecords,
      [phase.id]: {
        ...record,
        status: status === 'cancelled' ? 'cancelled' : 'failed',
        detail,
        endedAt: now,
        updatedAt: now,
      },
    },
  };
}

export function flowMetadata(state: WorkflowManagedFlowState): Record<string, unknown> {
  const phase = currentPhase(state);
  const completedPhaseCount = Object.values(state.phaseRecords).filter((record) => record.status === 'completed').length;
  return {
    flow: {
      id: state.id,
      status: state.status,
      revision: state.revision,
      currentPhaseId: phase?.id,
      currentPhaseKind: phase?.kind,
      currentPhaseNodeId: currentPhaseNodeId(phase),
      completedPhaseCount,
      phaseCount: state.phases.length,
      waitKind: state.wait?.kind,
      waitDetail: flowWaitDetail(state.wait),
      lastDetail: state.lastDetail,
      cancelRequested: state.cancelRequested,
    },
  };
}

export function toManagedFlowRunResult(
  state: WorkflowManagedFlowState,
  launchMode: WorkflowManagedFlowRunResult['launchMode'],
): WorkflowManagedFlowRunResult {
  const phase = currentPhase(state);
  return workflowManagedFlowRunResultSchema.parse({
    flowId: state.id,
    entryNodeId: state.entryNodeId,
    status: state.status,
    launchMode,
    currentPhaseId: phase?.id,
    currentPhaseKind: phase?.kind,
  });
}

export function currentPhaseNodeId(phase: WorkflowManagedFlowPhase | null): string | undefined {
  if (!phase) {
    return undefined;
  }
  if ('nodeId' in phase) {
    return phase.nodeId;
  }
  if (phase.kind === 'validation_phase') {
    return phase.validatorNodeId;
  }
  if (phase.kind === 'derive_input_phase') {
    return phase.sourceNodeId;
  }
  return undefined;
}

function flowWaitDetail(wait: WorkflowManagedFlowState['wait']): string | undefined {
  if (!wait) {
    return undefined;
  }
  if (wait.kind === 'manual') {
    return wait.reason;
  }
  if (wait.kind === 'controller') {
    return `controller ${wait.controllerId}`;
  }
  return wait.runId ? `run ${wait.runId}` : `execution ${wait.executionId}`;
}
