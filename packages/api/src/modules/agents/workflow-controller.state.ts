import {
  readWorkflowControllerState,
  readWorkflowLoopContent,
  type AgentLifecycleStatus,
  type WorkflowControllerItem,
  type WorkflowControllerRunResult,
  type WorkflowControllerState,
  workflowControllerRunResultSchema,
} from '@cepage/shared-core';
import type { WorkflowControllerItemValue } from './workflow-controller.util';

export const ACTIVE_RUN_STATUSES = new Set<AgentLifecycleStatus>([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
]);

export type ControllerRuntimeItem = {
  lastRunId?: string;
  lastExecutionId?: string;
  outputs?: ControllerRuntimeOutput[];
};

export type ControllerRuntimeOutput = {
  nodeId: string;
  relativePath: string;
  resolvedRelativePath: string;
  pathMode: 'static' | 'per_run';
};

export type ControllerMaterializedSource = {
  templateNodeId?: string;
  requestedBoundNodeId?: string;
  resolvedBoundNodeId?: string;
  partCount: number;
  itemCount: number;
  itemHintCount?: number;
  warning?: string;
};

export type ControllerRuntimeData = {
  retryFeedback?: string;
  promptNodeId?: string;
  outputNodeIds?: string[];
  source?: ControllerMaterializedSource;
  items?: Record<string, ControllerRuntimeItem>;
};

export type MaterializedLoopItems = {
  items: WorkflowControllerItemValue[];
  source?: ControllerMaterializedSource;
};

export type ControllerAdvance = 'continue' | 'wait';

export function buildInitialControllerState(input: {
  controllerId: string;
  sessionId: string;
  controllerNodeId: string;
  executionId: string;
  loop: NonNullable<ReturnType<typeof readWorkflowLoopContent>>;
  items: WorkflowControllerItemValue[];
  source?: ControllerMaterializedSource;
  now: string;
}): WorkflowControllerState {
  const items = input.items.map<WorkflowControllerItem>((item, index) => ({
    index,
    key: item.key,
    label: item.label,
    status: 'pending',
    attempts: 0,
  }));
  return {
    id: input.controllerId,
    sessionId: input.sessionId,
    controllerNodeId: input.controllerNodeId,
    executionId: input.executionId,
    status: 'running',
    mode: input.loop.mode,
    sourceKind: input.loop.source.kind,
    currentIndex: items.length > 0 ? 0 : undefined,
    totalItems: items.length,
    attemptsTotal: 0,
    completedSummaries: [],
    items,
    data: {
      itemValues: Object.fromEntries(
        input.items.map((item) => [item.key, { value: item.value, text: item.text }]),
      ),
      ...(input.source ? { source: input.source } : {}),
    },
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export function serializeControllerState(row: {
  id: string;
  sessionId: string;
  controllerNodeId: string;
  parentExecutionId: string | null;
  executionId: string | null;
  currentChildExecutionId: string | null;
  mode: string;
  sourceKind: string;
  status: string;
  state: unknown;
  startedAt: Date;
  endedAt: Date | null;
  updatedAt: Date;
}): WorkflowControllerState {
  const candidate = {
    ...(row.state && typeof row.state === 'object' && !Array.isArray(row.state)
      ? (row.state as Record<string, unknown>)
      : {}),
    id: row.id,
    sessionId: row.sessionId,
    controllerNodeId: row.controllerNodeId,
    ...(row.parentExecutionId ? { parentExecutionId: row.parentExecutionId } : {}),
    ...(row.executionId ? { executionId: row.executionId } : {}),
    ...(row.currentChildExecutionId ? { currentChildExecutionId: row.currentChildExecutionId } : {}),
    mode: row.mode,
    sourceKind: row.sourceKind,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
  const parsed = readWorkflowControllerState(candidate);
  if (!parsed) {
    throw new Error(`INVALID_WORKFLOW_CONTROLLER_STATE:${row.id}`);
  }
  return parsed;
}

export function controllerDynamicState(state: WorkflowControllerState): Record<string, unknown> {
  return {
    ...(state.currentIndex != null ? { currentIndex: state.currentIndex } : {}),
    ...(state.totalItems != null ? { totalItems: state.totalItems } : {}),
    attemptsTotal: state.attemptsTotal,
    ...(state.lastDecision ? { lastDecision: state.lastDecision } : {}),
    ...(state.lastDecisionDetail ? { lastDecisionDetail: state.lastDecisionDetail } : {}),
    ...(state.currentChildRunId ? { currentChildRunId: state.currentChildRunId } : {}),
    completedSummaries: state.completedSummaries,
    items: state.items,
    data: state.data,
  };
}

export function mapExecutionStatus(status: WorkflowControllerState['status']): AgentLifecycleStatus {
  if (status === 'blocked') {
    return 'paused';
  }
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'running';
}

export function isControllerRunning(status: WorkflowControllerState['status']): boolean {
  return status === 'pending' || status === 'running' || status === 'retrying';
}

export function runtimeData(state: WorkflowControllerState): ControllerRuntimeData {
  const data = state.data && typeof state.data === 'object' && !Array.isArray(state.data) ? state.data : {};
  const rawItems =
    (data as { items?: unknown }).items && typeof (data as { items?: unknown }).items === 'object'
      ? ((data as { items?: Record<string, unknown> }).items ?? {})
      : {};
  const items = Object.fromEntries(
    Object.entries(rawItems)
      .map(([key, value]) => [key, readControllerRuntimeItem(value)] as const)
      .filter((entry): entry is readonly [string, ControllerRuntimeItem] => Boolean(entry[1])),
  );
  const fallbackPromptNodeId = Object.values(rawItems)
    .flatMap((item) =>
      typeof (item as { promptNodeId?: unknown }).promptNodeId === 'string'
        ? [((item as { promptNodeId?: string }).promptNodeId ?? '')]
        : [],
    )[0];
  const fallbackOutputNodeIds = Object.values(rawItems)
    .flatMap((item) =>
      Array.isArray((item as { outputNodeIds?: unknown }).outputNodeIds)
        ? [
            ((item as { outputNodeIds?: unknown[] }).outputNodeIds ?? []).filter(
              (value): value is string => typeof value === 'string' && value.length > 0,
            ),
          ]
        : [],
    )[0];
  return {
    retryFeedback:
      typeof (data as { retryFeedback?: unknown }).retryFeedback === 'string'
        ? ((data as { retryFeedback?: string }).retryFeedback ?? '')
        : undefined,
    promptNodeId:
      typeof (data as { promptNodeId?: unknown }).promptNodeId === 'string'
        ? ((data as { promptNodeId?: string }).promptNodeId ?? '')
        : fallbackPromptNodeId,
    outputNodeIds:
      Array.isArray((data as { outputNodeIds?: unknown }).outputNodeIds)
        ? ((data as { outputNodeIds?: unknown[] }).outputNodeIds ?? []).filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
          )
        : fallbackOutputNodeIds,
    source: readControllerMaterializedSource((data as { source?: unknown }).source) ?? undefined,
    items,
  };
}

export function withRuntimeData(
  state: WorkflowControllerState,
  patch: Partial<ControllerRuntimeData>,
): WorkflowControllerState {
  const current = runtimeData(state);
  return {
    ...state,
    data: {
      ...state.data,
      ...current,
      ...patch,
    },
  };
}

export function controllerMetadata(state: WorkflowControllerState): Record<string, unknown> {
  const runtime = runtimeData(state);
  const currentItem =
    state.currentIndex != null ? state.items.find((item) => item.index === state.currentIndex) ?? null : null;
  const counts = state.items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return {
    controller: {
      id: state.id,
      status: state.status,
      currentIndex: state.currentIndex,
      totalItems: state.totalItems,
      attemptsTotal: state.attemptsTotal,
      currentChildExecutionId: state.currentChildExecutionId,
      currentChildRunId: state.currentChildRunId,
      lastDecision: state.lastDecision,
      lastDecisionDetail: state.lastDecisionDetail,
      currentItemLabel: currentItem?.label,
      sourceTemplateNodeId: runtime.source?.templateNodeId,
      requestedBoundNodeId: runtime.source?.requestedBoundNodeId,
      resolvedBoundNodeId: runtime.source?.resolvedBoundNodeId,
      sourcePartCount: runtime.source?.partCount,
      materializedItemCount: runtime.source?.itemCount,
      materializedHintCount: runtime.source?.itemHintCount,
      materializationWarning: runtime.source?.warning,
      counts,
    },
  };
}

export function toControllerRunResult(
  state: WorkflowControllerState,
  launchMode: WorkflowControllerRunResult['launchMode'],
  terminalStatus?: WorkflowControllerRunResult['terminalStatus'],
): WorkflowControllerRunResult {
  return workflowControllerRunResultSchema.parse({
    controllerId: state.id,
    controllerNodeId: state.controllerNodeId,
    status: state.status,
    launchMode,
    ...(terminalStatus ? { terminalStatus } : {}),
    executionId: state.executionId,
    currentChildExecutionId: state.currentChildExecutionId,
    currentChildRunId: state.currentChildRunId,
  });
}

function readControllerRuntimeItem(value: unknown): ControllerRuntimeItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as {
    lastRunId?: unknown;
    lastExecutionId?: unknown;
    outputs?: unknown;
  };
  const outputs = Array.isArray(record.outputs)
    ? record.outputs
        .map((entry) => readControllerRuntimeOutput(entry))
        .filter((entry): entry is ControllerRuntimeOutput => Boolean(entry))
    : undefined;
  return {
    ...(typeof record.lastRunId === 'string' ? { lastRunId: record.lastRunId } : {}),
    ...(typeof record.lastExecutionId === 'string' ? { lastExecutionId: record.lastExecutionId } : {}),
    ...(outputs && outputs.length > 0 ? { outputs } : {}),
  };
}

function readControllerRuntimeOutput(value: unknown): ControllerRuntimeOutput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as {
    nodeId?: unknown;
    relativePath?: unknown;
    resolvedRelativePath?: unknown;
    pathMode?: unknown;
  };
  if (
    typeof record.nodeId !== 'string'
    || typeof record.relativePath !== 'string'
    || typeof record.resolvedRelativePath !== 'string'
  ) {
    return null;
  }
  return {
    nodeId: record.nodeId,
    relativePath: record.relativePath,
    resolvedRelativePath: record.resolvedRelativePath,
    pathMode: record.pathMode === 'per_run' ? 'per_run' : 'static',
  };
}

function readControllerMaterializedSource(value: unknown): ControllerMaterializedSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as {
    templateNodeId?: unknown;
    requestedBoundNodeId?: unknown;
    resolvedBoundNodeId?: unknown;
    partCount?: unknown;
    itemCount?: unknown;
    itemHintCount?: unknown;
    warning?: unknown;
  };
  if (typeof record.partCount !== 'number' || typeof record.itemCount !== 'number') {
    return null;
  }
  return {
    ...(typeof record.templateNodeId === 'string' ? { templateNodeId: record.templateNodeId } : {}),
    ...(typeof record.requestedBoundNodeId === 'string'
      ? { requestedBoundNodeId: record.requestedBoundNodeId }
      : {}),
    ...(typeof record.resolvedBoundNodeId === 'string'
      ? { resolvedBoundNodeId: record.resolvedBoundNodeId }
      : {}),
    partCount: record.partCount,
    itemCount: record.itemCount,
    ...(typeof record.itemHintCount === 'number' ? { itemHintCount: record.itemHintCount } : {}),
    ...(typeof record.warning === 'string' ? { warning: record.warning } : {}),
  };
}
