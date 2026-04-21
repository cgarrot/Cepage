import { z } from 'zod';
import { agentModelRefSchema, agentTypeSchema } from './agent';
import { connectorExecutionStatusSchema } from './connector';
import { readNodeAgentSelection, nodeAgentSelectionSchema } from './node-agent-selection';

const textSchema = z.string().min(1);

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => readString(entry)?.trim())
      .filter((entry): entry is string => Boolean(entry));
  }
  const text = readString(value)?.trim();
  return text ? text.split('\n').map((entry) => entry.trim()).filter(Boolean) : [];
}

export const workflowLoopModeSchema = z.enum(['for_each', 'while']);
export type WorkflowLoopMode = z.infer<typeof workflowLoopModeSchema>;

export const workflowLoopAdvancePolicySchema = z.enum(['only_on_pass', 'always_advance']);
export type WorkflowLoopAdvancePolicy = z.infer<typeof workflowLoopAdvancePolicySchema>;

export const workflowLoopBlockedPolicySchema = z.enum([
  'pause_controller',
  'request_human',
  'skip_item',
  'stop_controller',
]);
export type WorkflowLoopBlockedPolicy = z.infer<typeof workflowLoopBlockedPolicySchema>;

export const workflowLoopSourceKindSchema = z.enum([
  'input_parts',
  'json_file',
  'inline_list',
  'future_source',
]);
export type WorkflowLoopSourceKind = z.infer<typeof workflowLoopSourceKindSchema>;

export const workflowLoopSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('input_parts'),
    templateNodeId: textSchema,
    boundNodeId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('json_file'),
    fileNodeId: z.string().optional(),
    relativePath: z.string().optional(),
  }),
  z.object({
    kind: z.literal('inline_list'),
    items: z.array(z.unknown()).min(1),
  }),
  z.object({
    kind: z.literal('future_source'),
    sourceKey: textSchema,
  }),
]);
export type WorkflowLoopSource = z.infer<typeof workflowLoopSourceSchema>;

export const workflowLoopSessionStrategySchema = z.object({
  withinItem: z.enum(['reuse_execution', 'new_execution']).default('reuse_execution'),
  betweenItems: z.enum(['reuse_execution', 'new_execution']).default('new_execution'),
});
export type WorkflowLoopSessionStrategy = z.infer<typeof workflowLoopSessionStrategySchema>;

const workflowLoopLegacySessionPolicySchema = z.enum([
  'reuse_within_item',
  'new_within_item',
  'new_between_items',
]);

function normalizeLoopSessionPolicy(value: unknown): WorkflowLoopSessionStrategy | undefined {
  if (value == null) {
    return {
      withinItem: 'reuse_execution',
      betweenItems: 'new_execution',
    };
  }
  const parsed = workflowLoopSessionStrategySchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const legacy = workflowLoopLegacySessionPolicySchema.safeParse(value);
  if (!legacy.success) {
    return undefined;
  }
  if (legacy.data === 'new_within_item') {
    return {
      withinItem: 'new_execution',
      betweenItems: 'new_execution',
    };
  }
  if (legacy.data === 'new_between_items') {
    return {
      withinItem: 'reuse_execution',
      betweenItems: 'new_execution',
    };
  }
  return {
    withinItem: 'reuse_execution',
    betweenItems: 'new_execution',
  };
}

export interface WorkflowLoopContent {
  mode: WorkflowLoopMode;
  source: WorkflowLoopSource;
  bodyNodeId: string;
  validatorNodeId?: string;
  advancePolicy: WorkflowLoopAdvancePolicy;
  sessionPolicy: WorkflowLoopSessionStrategy;
  maxAttemptsPerItem?: number;
  maxIterations?: number;
  blockedPolicy: WorkflowLoopBlockedPolicy;
  itemLabel?: string;
}

const workflowLoopContentBaseSchema = z.object({
  mode: workflowLoopModeSchema,
  source: workflowLoopSourceSchema,
  bodyNodeId: textSchema,
  validatorNodeId: z.string().optional(),
  advancePolicy: workflowLoopAdvancePolicySchema.default('only_on_pass'),
  maxAttemptsPerItem: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
  blockedPolicy: workflowLoopBlockedPolicySchema.default('pause_controller'),
  itemLabel: z.string().optional(),
});

export function readWorkflowLoopContent(value: unknown): WorkflowLoopContent | null {
  const parsed = workflowLoopContentBaseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const sessionPolicy = normalizeLoopSessionPolicy(
    (value as { sessionPolicy?: unknown } | null | undefined)?.sessionPolicy,
  );
  if (!sessionPolicy) {
    return null;
  }
  return {
    ...parsed.data,
    sessionPolicy,
  };
}

export const workflowRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session'),
    sessionId: textSchema,
  }),
  z.object({
    kind: z.literal('library'),
    sessionId: textSchema,
    versionTag: z.string().optional(),
  }),
]);
export type WorkflowRef = z.infer<typeof workflowRefSchema>;

export const workflowSubgraphInputBindingSchema = z.union([
  textSchema,
  z.object({
    template: textSchema,
    format: z.enum(['text', 'json']).optional(),
  }),
]);
export type WorkflowSubgraphInputBinding = z.infer<typeof workflowSubgraphInputBindingSchema>;

export const workflowSubgraphExecutionSchema = z.object({
  newExecution: z.boolean().optional(),
  type: agentTypeSchema.optional(),
  model: agentModelRefSchema.optional(),
  fallbackTag: z.string().min(1).optional(),
});
export type WorkflowSubgraphExecution = z.infer<typeof workflowSubgraphExecutionSchema>;

export const workflowSubgraphContentSchema = z.object({
  workflowRef: workflowRefSchema,
  inputMap: z.record(z.string(), workflowSubgraphInputBindingSchema).default({}),
  execution: workflowSubgraphExecutionSchema.default({}),
  agentSelection: nodeAgentSelectionSchema.optional(),
  expectedOutputs: z.array(textSchema).optional(),
  entryNodeId: z.string().optional(),
});
export type WorkflowSubgraphContent = z.infer<typeof workflowSubgraphContentSchema>;

export function readWorkflowSubgraphContent(value: unknown): WorkflowSubgraphContent | null {
  const parsed = workflowSubgraphContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const workflowValidatorOutcomeSchema = z.enum([
  'pass',
  'retry_same_item',
  'retry_new_execution',
  'block',
  'request_human',
  'complete',
]);
export type WorkflowValidatorOutcome = z.infer<typeof workflowValidatorOutcomeSchema>;

export const workflowValidatorCheckSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('path_exists'),
    path: textSchema,
  }),
  z.object({
    kind: z.literal('path_not_exists'),
    path: textSchema,
  }),
  z.object({
    kind: z.literal('path_nonempty'),
    path: textSchema,
  }),
  z.object({
    kind: z.literal('file_contains'),
    path: textSchema,
    text: textSchema,
  }),
  z.object({
    kind: z.literal('file_not_contains'),
    path: textSchema,
    text: textSchema,
  }),
  z.object({
    kind: z.literal('file_last_line_equals'),
    path: textSchema,
    text: textSchema,
  }),
  z.object({
    kind: z.literal('json_array_nonempty'),
    path: textSchema,
  }),
  z.object({
    kind: z.literal('json_path_exists'),
    path: textSchema,
    jsonPath: textSchema,
  }),
  z.object({
    kind: z.literal('json_path_nonempty'),
    path: textSchema,
    jsonPath: textSchema,
  }),
  z.object({
    kind: z.literal('json_path_array_nonempty'),
    path: textSchema,
    jsonPath: textSchema,
  }),
  z.object({
    kind: z.literal('workflow_transfer_valid'),
    path: textSchema,
  }),
  z.object({
    kind: z.literal('connector_status_is'),
    status: connectorExecutionStatusSchema,
  }),
  z.object({
    kind: z.literal('connector_exit_code_in'),
    codes: z.array(z.number().int()).min(1),
  }),
  z.object({
    kind: z.literal('connector_http_status_in'),
    statuses: z.array(z.number().int().min(100).max(599)).min(1),
  }),
]);
export type WorkflowValidatorCheck = z.infer<typeof workflowValidatorCheckSchema>;

export const workflowDecisionValidatorContentSchema = z.object({
  mode: z.literal('workspace_validator'),
  requirements: z.array(textSchema).default([]),
  evidenceFrom: z.array(textSchema).default([]),
  checks: z.array(workflowValidatorCheckSchema).default([]),
  passAction: workflowValidatorOutcomeSchema.default('pass'),
  failAction: workflowValidatorOutcomeSchema.default('retry_same_item'),
  blockAction: workflowValidatorOutcomeSchema.default('block'),
});
export type WorkflowDecisionValidatorContent = z.infer<typeof workflowDecisionValidatorContentSchema>;

export function readWorkflowDecisionValidatorContent(
  value: unknown,
): WorkflowDecisionValidatorContent | null {
  const parsed = workflowDecisionValidatorContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const workflowControllerStatusSchema = z.enum([
  'pending',
  'running',
  'retrying',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkflowControllerStatus = z.infer<typeof workflowControllerStatusSchema>;

export const workflowControllerItemStatusSchema = z.enum([
  'pending',
  'running',
  'retrying',
  'completed',
  'blocked',
  'failed',
  'skipped',
]);
export type WorkflowControllerItemStatus = z.infer<typeof workflowControllerItemStatusSchema>;

export const workflowControllerItemSchema = z.object({
  index: z.number().int().nonnegative(),
  key: textSchema,
  label: z.string().optional(),
  status: workflowControllerItemStatusSchema,
  attempts: z.number().int().nonnegative(),
  summary: z.string().optional(),
});
export type WorkflowControllerItem = z.infer<typeof workflowControllerItemSchema>;

export const workflowControllerStateSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  controllerNodeId: textSchema,
  parentExecutionId: z.string().optional(),
  executionId: z.string().optional(),
  currentChildExecutionId: z.string().optional(),
  currentChildRunId: z.string().optional(),
  status: workflowControllerStatusSchema,
  mode: workflowLoopModeSchema,
  sourceKind: workflowLoopSourceKindSchema,
  currentIndex: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative().optional(),
  attemptsTotal: z.number().int().nonnegative().default(0),
  lastDecision: workflowValidatorOutcomeSchema.optional(),
  lastDecisionDetail: z.string().optional(),
  completedSummaries: z.array(z.string()).default([]),
  items: z.array(workflowControllerItemSchema).default([]),
  data: z.record(z.string(), z.unknown()).default({}),
  startedAt: textSchema,
  updatedAt: textSchema,
  endedAt: z.string().optional(),
});
export type WorkflowControllerState = z.infer<typeof workflowControllerStateSchema>;

export const workflowControllerSummarySchema = z.object({
  id: textSchema,
  status: workflowControllerStatusSchema,
  currentIndex: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative().optional(),
  attemptsTotal: z.number().int().nonnegative().optional(),
  currentChildExecutionId: z.string().optional(),
  currentChildRunId: z.string().optional(),
  lastDecision: workflowValidatorOutcomeSchema.optional(),
  lastDecisionDetail: z.string().optional(),
  currentItemLabel: z.string().optional(),
  sourceTemplateNodeId: z.string().optional(),
  requestedBoundNodeId: z.string().optional(),
  resolvedBoundNodeId: z.string().optional(),
  sourcePartCount: z.number().int().nonnegative().optional(),
  materializedItemCount: z.number().int().nonnegative().optional(),
  materializedHintCount: z.number().int().nonnegative().optional(),
  materializationWarning: z.string().optional(),
  counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type WorkflowControllerSummary = z.infer<typeof workflowControllerSummarySchema>;

export function readWorkflowControllerState(value: unknown): WorkflowControllerState | null {
  const parsed = workflowControllerStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readWorkflowControllerSummary(value: unknown): WorkflowControllerSummary | null {
  const direct = readRecord(value);
  const parsed = workflowControllerSummarySchema.safeParse(readRecord(direct?.controller) ?? direct);
  return parsed.success ? parsed.data : null;
}

export function summarizeWorkflowLoopContent(value: unknown): string {
  const content = readWorkflowLoopContent(value);
  if (!content) {
    return '';
  }
  const lines = [
    `loop · ${content.mode}`,
    `source: ${content.source.kind}`,
    `advance: ${content.advancePolicy}`,
  ];
  if (content.validatorNodeId) {
    lines.push(`validator: ${content.validatorNodeId}`);
  }
  if (content.maxAttemptsPerItem != null) {
    lines.push(`max attempts/item: ${content.maxAttemptsPerItem}`);
  }
  if (content.maxIterations != null) {
    lines.push(`max iterations: ${content.maxIterations}`);
  }
  return lines.join('\n');
}

export function summarizeWorkflowSubgraphContent(value: unknown): string {
  const content = readWorkflowSubgraphContent(value);
  if (!content) {
    return '';
  }
  const ref =
    content.workflowRef.kind === 'session'
      ? `session:${content.workflowRef.sessionId}`
      : `library:${content.workflowRef.sessionId}`;
  const lines = [`workflow: ${ref}`];
  const keys = Object.keys(content.inputMap);
  if (keys.length > 0) {
    lines.push(`inputs: ${keys.join(', ')}`);
  }
  if (content.expectedOutputs?.length) {
    lines.push(`outputs: ${content.expectedOutputs.join(', ')}`);
  }
  const selection = readNodeAgentSelection(content);
  if (selection?.mode === 'locked' && selection.selection) {
    lines.push(`agent: ${selection.selection.type}`);
  }
  return lines.join('\n');
}

export function summarizeWorkflowDecisionValidatorContent(value: unknown): string {
  const content = readWorkflowDecisionValidatorContent(value);
  if (!content) {
    return '';
  }
  const lines = [
    `validator · ${content.mode}`,
    `pass: ${content.passAction}`,
    `fail: ${content.failAction}`,
    `block: ${content.blockAction}`,
  ];
  if (content.requirements.length > 0) {
    lines.push(content.requirements.join('\n'));
  }
  return lines.join('\n');
}

export const workflowControllerRunRequestSchema = z.object({
  requestId: z.string().optional(),
  workingDirectory: z.string().optional(),
  forceRestart: z.boolean().optional(),
});
export type WorkflowControllerRunRequest = z.infer<typeof workflowControllerRunRequestSchema>;

export const workflowLaunchModeSchema = z.enum(['run', 'resume', 'restart', 'noop']);
export type WorkflowLaunchMode = z.infer<typeof workflowLaunchModeSchema>;

export const workflowControllerRunResultSchema = z.object({
  controllerId: textSchema,
  controllerNodeId: textSchema,
  status: workflowControllerStatusSchema,
  launchMode: workflowLaunchModeSchema.default('run'),
  terminalStatus: workflowControllerStatusSchema.optional(),
  executionId: z.string().optional(),
  currentChildExecutionId: z.string().optional(),
  currentChildRunId: z.string().optional(),
});
export type WorkflowControllerRunResult = z.infer<typeof workflowControllerRunResultSchema>;

export const workflowManagedFlowSyncModeSchema = z.enum(['managed', 'mirrored']);
export type WorkflowManagedFlowSyncMode = z.infer<typeof workflowManagedFlowSyncModeSchema>;

export const workflowManagedFlowStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkflowManagedFlowStatus = z.infer<typeof workflowManagedFlowStatusSchema>;

export const workflowManagedFlowPhaseStatusSchema = z.enum([
  'pending',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);
export type WorkflowManagedFlowPhaseStatus = z.infer<typeof workflowManagedFlowPhaseStatusSchema>;

export const workflowManagedFlowPhaseKindSchema = z.enum([
  'loop_phase',
  'agent_phase',
  'connector_phase',
  'validation_phase',
  'derive_input_phase',
  'runtime_verify_phase',
]);
export type WorkflowManagedFlowPhaseKind = z.infer<typeof workflowManagedFlowPhaseKindSchema>;

const workflowManagedFlowPhaseBaseSchema = z.object({
  id: textSchema,
  title: z.string().optional(),
});

const workflowManagedFlowSelectionSchema = z.object({
  type: agentTypeSchema.optional(),
  model: agentModelRefSchema.optional(),
});

export const workflowManagedLoopPhaseSchema = workflowManagedFlowPhaseBaseSchema.extend({
  kind: z.literal('loop_phase'),
  nodeId: textSchema,
  forceRestart: z.boolean().optional(),
});
export type WorkflowManagedLoopPhase = z.infer<typeof workflowManagedLoopPhaseSchema>;

export const workflowManagedAgentPhaseSchema = workflowManagedFlowPhaseBaseSchema.extend({
  kind: z.literal('agent_phase'),
  nodeId: textSchema,
  validatorNodeId: z.string().optional(),
  expectedOutputs: z.array(textSchema).default([]),
  selection: workflowManagedFlowSelectionSchema.optional(),
  newExecution: z.boolean().optional(),
});
export type WorkflowManagedAgentPhase = z.infer<typeof workflowManagedAgentPhaseSchema>;

export const workflowManagedConnectorPhaseSchema = workflowManagedFlowPhaseBaseSchema.extend({
  kind: z.literal('connector_phase'),
  nodeId: textSchema,
  validatorNodeId: z.string().optional(),
  expectedOutputs: z.array(textSchema).default([]),
});
export type WorkflowManagedConnectorPhase = z.infer<typeof workflowManagedConnectorPhaseSchema>;

export const workflowManagedValidationPhaseSchema = workflowManagedFlowPhaseBaseSchema.extend({
  kind: z.literal('validation_phase'),
  validatorNodeId: textSchema,
  sourceNodeId: z.string().optional(),
  expectedOutputs: z.array(textSchema).default([]),
  passDetail: z.string().optional(),
});
export type WorkflowManagedValidationPhase = z.infer<typeof workflowManagedValidationPhaseSchema>;

export const workflowManagedDeriveInputPhaseSchema = workflowManagedFlowPhaseBaseSchema.extend({
  kind: z.literal('derive_input_phase'),
  sourceNodeId: textSchema,
  targetTemplateNodeId: textSchema,
  jsonPath: z.string().default('missing'),
  summaryPath: z.string().optional(),
  restartPhaseId: z.string().optional(),
});
export type WorkflowManagedDeriveInputPhase = z.infer<typeof workflowManagedDeriveInputPhaseSchema>;

export const workflowManagedRuntimeVerifyPhaseSchema = workflowManagedFlowPhaseBaseSchema.extend({
  kind: z.literal('runtime_verify_phase'),
  nodeId: textSchema,
  validatorNodeId: z.string().optional(),
  expectedOutputs: z.array(textSchema).default([]),
  selection: workflowManagedFlowSelectionSchema.optional(),
  newExecution: z.boolean().optional(),
});
export type WorkflowManagedRuntimeVerifyPhase = z.infer<typeof workflowManagedRuntimeVerifyPhaseSchema>;

export const workflowManagedFlowPhaseSchema = z.discriminatedUnion('kind', [
  workflowManagedLoopPhaseSchema,
  workflowManagedAgentPhaseSchema,
  workflowManagedConnectorPhaseSchema,
  workflowManagedValidationPhaseSchema,
  workflowManagedDeriveInputPhaseSchema,
  workflowManagedRuntimeVerifyPhaseSchema,
]);
export type WorkflowManagedFlowPhase = z.infer<typeof workflowManagedFlowPhaseSchema>;

export const workflowManagedFlowContentSchema = z.object({
  title: z.string().optional(),
  syncMode: workflowManagedFlowSyncModeSchema.default('managed'),
  entryPhaseId: z.string().optional(),
  phases: z.array(workflowManagedFlowPhaseSchema).min(1),
});
export type WorkflowManagedFlowContent = z.infer<typeof workflowManagedFlowContentSchema>;

export function readWorkflowManagedFlowContent(value: unknown): WorkflowManagedFlowContent | null {
  const parsed = workflowManagedFlowContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeManagedFlowPhaseKind(value: unknown): WorkflowManagedFlowPhase['kind'] | null {
  const raw = readString(value)?.trim();
  if (!raw) return null;
  if (raw === 'loop_phase' || raw === 'loop') {
    return 'loop_phase';
  }
  if (raw === 'agent_phase' || raw === 'agent' || raw === 'audit' || raw === 'step') {
    return 'agent_phase';
  }
  if (raw === 'connector_phase' || raw === 'connector' || raw === 'tool_phase' || raw === 'tool') {
    return 'connector_phase';
  }
  if (raw === 'validation_phase' || raw === 'validation' || raw === 'validator') {
    return 'validation_phase';
  }
  if (raw === 'derive_input_phase' || raw === 'derive' || raw === 'derive_input') {
    return 'derive_input_phase';
  }
  if (raw === 'runtime_verify_phase' || raw === 'verify' || raw === 'verify_phase' || raw === 'runtime_check') {
    return 'runtime_verify_phase';
  }
  return null;
}

function normalizeManagedFlowPhaseId(
  value: unknown,
  kind: WorkflowManagedFlowPhase['kind'],
  index: number,
  used: Set<string>,
): string {
  const base = readString(value)?.trim() || `${kind.replace(/_phase$/, '')}-${index + 1}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let count = 2;
  while (used.has(`${base}-${count}`)) {
    count += 1;
  }
  const next = `${base}-${count}`;
  used.add(next);
  return next;
}

function normalizeManagedFlowSelection(
  value: unknown,
): { type?: z.infer<typeof agentTypeSchema>; model?: z.infer<typeof agentModelRefSchema> } | undefined {
  const record = readRecord(value);
  const rawType =
    readString(record?.type)?.trim()
    ?? readString(record?.agentType)?.trim()
    ?? readString(record?.providerType)?.trim();
  const type = rawType ? agentTypeSchema.safeParse(rawType) : null;
  const model = agentModelRefSchema.safeParse(record?.model ?? value);
  if (!type?.success && !model.success) {
    return undefined;
  }
  return {
    ...(type?.success ? { type: type.data } : {}),
    ...(model.success ? { model: model.data } : {}),
  };
}

function normalizeManagedFlowPhase(
  value: unknown,
  index: number,
  used: Set<string>,
): WorkflowManagedFlowPhase | null {
  const record = readRecord(value);
  if (!record) return null;
  const kind = normalizeManagedFlowPhaseKind(record.kind ?? record.type ?? record.phaseType);
  if (!kind) return null;
  const id = normalizeManagedFlowPhaseId(record.id ?? record.phaseId, kind, index, used);
  const title = readString(record.title)?.trim() ?? readString(record.label)?.trim();
  if (kind === 'loop_phase') {
    const nodeId =
      readString(record.nodeId)?.trim()
      ?? readString(record.loopNodeId)?.trim()
      ?? readString(record.controllerNodeId)?.trim();
    if (!nodeId) return null;
    return {
      id,
      kind,
      ...(title ? { title } : {}),
      nodeId,
      ...((readBoolean(record.forceRestart) ?? readBoolean(record.restart)) === true ? { forceRestart: true } : {}),
    };
  }
  if (kind === 'connector_phase') {
    const nodeId =
      readString(record.nodeId)?.trim()
      ?? readString(record.connectorNodeId)?.trim()
      ?? readString(record.targetNodeId)?.trim();
    if (!nodeId) return null;
    const validatorNodeId =
      readString(record.validatorNodeId)?.trim()
      ?? readString(record.decisionNodeId)?.trim();
    return {
      id,
      kind,
      ...(title ? { title } : {}),
      nodeId,
      expectedOutputs: normalizeStringList(
        record.expectedOutputs ?? record.outputs ?? record.artifacts,
      ),
      ...(validatorNodeId ? { validatorNodeId } : {}),
    };
  }
  if (kind === 'agent_phase' || kind === 'runtime_verify_phase') {
    const nodeId =
      readString(record.nodeId)?.trim()
      ?? readString(record.stepNodeId)?.trim()
      ?? readString(record.agentNodeId)?.trim()
      ?? readString(record.runtimeNodeId)?.trim();
    if (!nodeId) return null;
    const validatorNodeId =
      readString(record.validatorNodeId)?.trim()
      ?? readString(record.decisionNodeId)?.trim();
    const selection =
      normalizeManagedFlowSelection(record.selection)
      ?? normalizeManagedFlowSelection(record.agentSelection)
      ?? normalizeManagedFlowSelection(record.execution);
    const expectedOutputs = normalizeStringList(
      record.expectedOutputs ?? record.outputs ?? record.artifacts,
    );
    const base = {
      id,
      ...(title ? { title } : {}),
      nodeId,
      expectedOutputs,
      ...(validatorNodeId ? { validatorNodeId } : {}),
      ...(selection ? { selection } : {}),
      ...((readBoolean(record.newExecution) ?? readBoolean(readRecord(record.execution)?.newExecution)) === true
        ? { newExecution: true }
        : {}),
    };
    return kind === 'agent_phase'
      ? {
          ...base,
          kind: 'agent_phase',
        }
      : {
          ...base,
          kind: 'runtime_verify_phase',
        };
  }
  if (kind === 'validation_phase') {
    const validatorNodeId =
      readString(record.validatorNodeId)?.trim()
      ?? readString(record.decisionNodeId)?.trim()
      ?? readString(record.nodeId)?.trim();
    if (!validatorNodeId) return null;
    const sourceNodeId =
      readString(record.sourceNodeId)?.trim()
      ?? readString(record.fileNodeId)?.trim()
      ?? readString(record.sourceFileNodeId)?.trim();
    const expectedOutputs = normalizeStringList(
      record.expectedOutputs ?? record.outputs ?? record.evidenceFrom,
    );
    const passDetail = readString(record.passDetail)?.trim() ?? readString(record.successDetail)?.trim();
    return {
      id,
      kind,
      ...(title ? { title } : {}),
      validatorNodeId,
      ...(sourceNodeId ? { sourceNodeId } : {}),
      expectedOutputs,
      ...(passDetail ? { passDetail } : {}),
    };
  }
  const sourceNodeId =
    readString(record.sourceNodeId)?.trim()
    ?? readString(record.fileNodeId)?.trim()
    ?? readString(record.reportNodeId)?.trim()
    ?? readString(record.nodeId)?.trim();
  const targetTemplateNodeId =
    readString(record.targetTemplateNodeId)?.trim()
    ?? readString(record.templateNodeId)?.trim()
    ?? readString(record.inputTemplateNodeId)?.trim()
    ?? readString(record.targetNodeId)?.trim();
  if (!sourceNodeId || !targetTemplateNodeId) return null;
  const jsonPath =
    readString(record.jsonPath)?.trim()
    ?? readString(record.itemsPath)?.trim()
    ?? readString(record.path)?.trim()
    ?? 'missing';
  const summaryPath =
    readString(record.summaryPath)?.trim()
    ?? readString(record.summaryJsonPath)?.trim();
  const restartPhaseId =
    readString(record.restartPhaseId)?.trim()
    ?? readString(record.restartToPhaseId)?.trim()
    ?? readString(record.restartAt)?.trim();
  return {
    id,
    kind: 'derive_input_phase',
    ...(title ? { title } : {}),
    sourceNodeId,
    targetTemplateNodeId,
    jsonPath,
    ...(summaryPath ? { summaryPath } : {}),
    ...(restartPhaseId ? { restartPhaseId } : {}),
  };
}

export function readLooseWorkflowManagedFlowContent(value: unknown): WorkflowManagedFlowContent | null {
  const strict = readWorkflowManagedFlowContent(value);
  if (strict) {
    return strict;
  }
  const record = readRecord(value);
  if (!record) return null;
  const rawPhases =
    Array.isArray(record.phases) ? record.phases : Array.isArray(record.steps) ? record.steps : [];
  if (rawPhases.length === 0) {
    return null;
  }
  const used = new Set<string>();
  const phases = rawPhases
    .map((phase, index) => normalizeManagedFlowPhase(phase, index, used))
    .filter((phase): phase is WorkflowManagedFlowPhase => Boolean(phase));
  if (phases.length === 0) {
    return null;
  }
  const title = readString(record.title)?.trim() ?? readString(record.label)?.trim();
  const entryPhaseId =
    [
      readString(record.entryPhaseId)?.trim(),
      readString(record.entry)?.trim(),
      readString(record.startPhaseId)?.trim(),
    ].find((entry): entry is string => Boolean(entry && phases.some((phase) => phase.id === entry)))
    ?? phases[0]?.id;
  const next = {
    ...(title ? { title } : {}),
    syncMode: readString(record.syncMode)?.trim() === 'mirrored' ? 'mirrored' : 'managed',
    ...(entryPhaseId ? { entryPhaseId } : {}),
    phases,
  };
  const parsed = workflowManagedFlowContentSchema.safeParse(next);
  return parsed.success ? parsed.data : null;
}

export type WorkflowManagedFlowStructuralEdge = {
  source: string;
  target: string;
  relation: 'contains' | 'feeds_into' | 'references' | 'validates';
};

export function collectManagedFlowReferencedNodeIds(value: unknown): string[] {
  const content = readLooseWorkflowManagedFlowContent(value);
  if (!content) {
    return [];
  }
  const ids = new Set<string>();
  const push = (id?: string) => {
    const next = id?.trim();
    if (next) {
      ids.add(next);
    }
  };
  for (const phase of content.phases) {
    if (phase.kind === 'loop_phase') {
      push(phase.nodeId);
      continue;
    }
    if (phase.kind === 'agent_phase' || phase.kind === 'connector_phase' || phase.kind === 'runtime_verify_phase') {
      push(phase.nodeId);
      push(phase.validatorNodeId);
      continue;
    }
    if (phase.kind === 'validation_phase') {
      push(phase.validatorNodeId);
      push(phase.sourceNodeId);
      continue;
    }
    push(phase.sourceNodeId);
    push(phase.targetTemplateNodeId);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export function collectManagedFlowStructuralEdges(
  flowNodeId: string,
  value: unknown,
): WorkflowManagedFlowStructuralEdge[] {
  const content = readLooseWorkflowManagedFlowContent(value);
  if (!content) {
    return [];
  }
  const edges: WorkflowManagedFlowStructuralEdge[] = [];
  const push = (
    source: string | undefined,
    target: string | undefined,
    relation: WorkflowManagedFlowStructuralEdge['relation'],
  ) => {
    if (!source || !target || source === target) {
      return;
    }
    edges.push({ source, target, relation });
  };
  for (const phase of content.phases) {
    if (phase.kind === 'loop_phase') {
      push(flowNodeId, phase.nodeId, 'contains');
      continue;
    }
    if (phase.kind === 'agent_phase' || phase.kind === 'connector_phase' || phase.kind === 'runtime_verify_phase') {
      push(flowNodeId, phase.nodeId, 'contains');
      push(phase.validatorNodeId, phase.nodeId, 'validates');
      continue;
    }
    if (phase.kind === 'validation_phase') {
      push(flowNodeId, phase.validatorNodeId, 'contains');
      push(phase.sourceNodeId, phase.validatorNodeId, 'feeds_into');
      continue;
    }
    push(flowNodeId, phase.sourceNodeId, 'references');
    push(phase.sourceNodeId, phase.targetTemplateNodeId, 'feeds_into');
  }
  const seen = new Set<string>();
  return edges
    .filter((edge) => {
      const key = `${edge.source}:${edge.target}:${edge.relation}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source)
        || a.target.localeCompare(b.target)
        || a.relation.localeCompare(b.relation),
    );
}

export const workflowManagedFlowPhaseRecordSchema = z.object({
  phaseId: textSchema,
  kind: workflowManagedFlowPhaseKindSchema,
  status: workflowManagedFlowPhaseStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  nodeId: z.string().optional(),
  controllerId: z.string().optional(),
  executionId: z.string().optional(),
  runId: z.string().optional(),
  detail: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  updatedAt: textSchema,
});
export type WorkflowManagedFlowPhaseRecord = z.infer<typeof workflowManagedFlowPhaseRecordSchema>;

export const workflowManagedFlowWaitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('controller'),
    phaseId: textSchema,
    controllerId: textSchema,
    nodeId: textSchema,
  }),
  z.object({
    kind: z.literal('execution'),
    phaseId: textSchema,
    executionId: textSchema,
    nodeId: textSchema,
    runId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('manual'),
    phaseId: textSchema,
    reason: textSchema,
  }),
]);
export type WorkflowManagedFlowWait = z.infer<typeof workflowManagedFlowWaitSchema>;

export const workflowManagedFlowStateSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  entryNodeId: textSchema,
  syncMode: workflowManagedFlowSyncModeSchema.default('managed'),
  status: workflowManagedFlowStatusSchema,
  revision: z.number().int().nonnegative(),
  currentPhaseId: z.string().optional(),
  currentPhaseIndex: z.number().int().nonnegative().optional(),
  phases: z.array(workflowManagedFlowPhaseSchema).min(1),
  phaseRecords: z.record(z.string(), workflowManagedFlowPhaseRecordSchema).default({}),
  wait: workflowManagedFlowWaitSchema.optional(),
  state: z.record(z.string(), z.unknown()).default({}),
  lastDetail: z.string().optional(),
  cancelRequested: z.boolean().default(false),
  startedAt: textSchema,
  updatedAt: textSchema,
  endedAt: z.string().optional(),
});
export type WorkflowManagedFlowState = z.infer<typeof workflowManagedFlowStateSchema>;

export const workflowManagedFlowSummarySchema = z.object({
  id: textSchema,
  status: workflowManagedFlowStatusSchema,
  revision: z.number().int().nonnegative(),
  currentPhaseId: z.string().optional(),
  currentPhaseKind: workflowManagedFlowPhaseKindSchema.optional(),
  currentPhaseNodeId: z.string().optional(),
  completedPhaseCount: z.number().int().nonnegative().default(0),
  phaseCount: z.number().int().nonnegative().default(0),
  waitKind: z.enum(['controller', 'execution', 'manual']).optional(),
  waitDetail: z.string().optional(),
  lastDetail: z.string().optional(),
  cancelRequested: z.boolean().default(false),
});
export type WorkflowManagedFlowSummary = z.infer<typeof workflowManagedFlowSummarySchema>;

export function readWorkflowManagedFlowState(value: unknown): WorkflowManagedFlowState | null {
  const parsed = workflowManagedFlowStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readWorkflowManagedFlowSummary(value: unknown): WorkflowManagedFlowSummary | null {
  const direct = readRecord(value);
  const parsed = workflowManagedFlowSummarySchema.safeParse(readRecord(direct?.flow) ?? direct);
  return parsed.success ? parsed.data : null;
}

export function summarizeWorkflowManagedFlowContent(value: unknown): string {
  const content = readLooseWorkflowManagedFlowContent(value);
  if (!content) {
    return '';
  }
  const lines = [`managed flow · ${content.syncMode}`, `phases: ${content.phases.length}`];
  const first = content.phases[0];
  if (first) {
    lines.push(`entry: ${content.entryPhaseId ?? first.id}`);
  }
  for (const phase of content.phases.slice(0, 4)) {
    if ('nodeId' in phase && phase.nodeId) {
      lines.push(`${phase.kind}: ${phase.nodeId}`);
      continue;
    }
    if (phase.kind === 'validation_phase') {
      lines.push(`${phase.kind}: ${phase.validatorNodeId}`);
      continue;
    }
    if (phase.kind === 'derive_input_phase') {
      lines.push(`${phase.kind}: ${phase.targetTemplateNodeId}`);
    }
  }
  return lines.join('\n');
}

export const workflowManagedFlowRunRequestSchema = z.object({
  requestId: z.string().optional(),
  workingDirectory: z.string().optional(),
  forceRestart: z.boolean().optional(),
});
export type WorkflowManagedFlowRunRequest = z.infer<typeof workflowManagedFlowRunRequestSchema>;

export const workflowManagedFlowRunResultSchema = z.object({
  flowId: textSchema,
  entryNodeId: textSchema,
  status: workflowManagedFlowStatusSchema,
  launchMode: workflowLaunchModeSchema.default('run'),
  currentPhaseId: z.string().optional(),
  currentPhaseKind: workflowManagedFlowPhaseKindSchema.optional(),
});
export type WorkflowManagedFlowRunResult = z.infer<typeof workflowManagedFlowRunResultSchema>;

export const workflowManagedFlowCancelRequestSchema = z.object({
  reason: z.string().optional(),
});
export type WorkflowManagedFlowCancelRequest = z.infer<typeof workflowManagedFlowCancelRequestSchema>;
