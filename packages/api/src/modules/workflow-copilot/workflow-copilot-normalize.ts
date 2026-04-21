import { BadRequestException } from '@nestjs/common';
import type {
  AgentModelRef,
  AgentType,
  GraphNode,
  WorkflowManagedFlowPhase,
  WorkflowCopilotNodePatch,
  WorkflowTransfer,
} from '@cepage/shared-core';
import {
  applyNodeAgentSelection,
  parseWorkflowTransfer,
  readNodeAgentSelection,
  readWorkflowInputContent,
  readWorkflowManagedFlowContent,
} from '@cepage/shared-core';
import { agentTypeSchemaOrThrow, readModelRef } from './workflow-copilot-rows';
import { DEFAULT_AGENT_TYPE } from './workflow-copilot.types';

export function resolveNodeRef(value: string, refs: Map<string, string>): string {
  return refs.get(value) ?? value;
}

export function defaultNodeContent(type: string): GraphNode['content'] {
  if (type === 'human_message' || type === 'note') {
    return { text: '', format: 'markdown' };
  }
  if (type === 'agent_step' || type === 'agent_spawn') {
    return { agentType: DEFAULT_AGENT_TYPE };
  }
  if (type === 'input') {
    return {
      mode: 'template',
      label: 'Input',
      accepts: ['text', 'image', 'file'],
      multiple: true,
      required: false,
    };
  }
  if (type === 'workspace_file') {
    return {
      title: 'Workspace file',
      relativePath: 'notes.md',
      pathMode: 'static',
      role: 'output',
      origin: 'derived',
      kind: 'text',
      transferMode: 'reference',
      status: 'declared',
    };
  }
  if (type === 'file_summary') {
    return { files: [], status: 'empty' };
  }
  if (type === 'workflow_copilot') {
    return { title: 'Workflow copilot', text: '' };
  }
  if (type === 'managed_flow') {
    return {
      title: 'Managed flow',
      syncMode: 'managed',
      phases: [
        {
          id: 'phase-1',
          kind: 'loop_phase',
          nodeId: 'replace-loop-node-id',
          title: 'Primary loop',
        },
      ],
    };
  }
  return {};
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readModel(value: unknown): AgentModelRef | undefined {
  const record = readRecord(value);
  return readModelRef(
    readString(record?.providerID) ?? null,
    readString(record?.modelID) ?? null,
  );
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function resolveOptionalNodeRef(value: unknown, refs: Map<string, string>): string | undefined {
  const next = readString(value)?.trim();
  return next ? resolveNodeRef(next, refs) : undefined;
}

function normalizePositiveInt(value: unknown): number | undefined {
  const num =
    typeof value === 'number'
      ? value
      : Number.parseInt(readString(value)?.trim() ?? '', 10);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  return Math.trunc(num);
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

function normalizeInputAccepts(value: unknown): Array<'text' | 'image' | 'file'> | undefined {
  if (!Array.isArray(value)) return undefined;
  const accepts = value
    .map((entry) => readString(entry)?.trim())
    .filter((entry): entry is 'text' | 'image' | 'file' => entry === 'text' || entry === 'image' || entry === 'file');
  return accepts.length > 0 ? [...new Set(accepts)] : undefined;
}

function normalizeInputBase(value: unknown): Record<string, unknown> {
  const record = readRecord(value);
  const key = readString(record?.key)?.trim();
  const label = readString(record?.label)?.trim();
  const accepts = normalizeInputAccepts(record?.accepts);
  const multiple = readBoolean(record?.multiple);
  const required = readBoolean(record?.required);
  const instructions = readString(record?.instructions)?.trim();
  return {
    ...(key ? { key } : {}),
    ...(label ? { label } : {}),
    ...(accepts ? { accepts } : {}),
    ...(multiple !== undefined ? { multiple } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function normalizeInputPart(value: unknown, index: number): Record<string, unknown> | null {
  const text = readString(value);
  if (text?.trim()) {
    return {
      id: `part-${index + 1}`,
      type: 'text',
      text,
    };
  }
  const record = readRecord(value);
  if (!record) return null;
  const id = readString(record.id)?.trim() || `part-${index + 1}`;
  const nextText = readString(record.text);
  const type = readString(record.type)?.trim();
  if ((type === 'text' || (!type && nextText?.trim())) && nextText?.trim()) {
    return {
      id,
      type: 'text',
      text: nextText,
    };
  }
  if (type !== 'file' && type !== 'image') {
    return null;
  }
  const file = readRecord(record.file);
  const name = readString(file?.name)?.trim();
  const mimeType = readString(file?.mimeType)?.trim();
  const size = typeof file?.size === 'number' && Number.isFinite(file.size) && file.size >= 0 ? file.size : null;
  const kind = readString(file?.kind)?.trim();
  const uploadedAt = readString(file?.uploadedAt)?.trim();
  if (!name || !mimeType || size == null || !uploadedAt || (kind !== 'text' && kind !== 'image' && kind !== 'binary')) {
    return null;
  }
  const extension = readString(file?.extension)?.trim();
  const width = typeof file?.width === 'number' && Number.isFinite(file.width) ? file.width : undefined;
  const height = typeof file?.height === 'number' && Number.isFinite(file.height) ? file.height : undefined;
  const relativePath = readString(record.relativePath)?.trim();
  const transferMode = readString(record.transferMode)?.trim();
  const workspaceFileNodeId = readString(record.workspaceFileNodeId)?.trim();
  const claimRef = readString(record.claimRef)?.trim();
  const extractedText = readString(record.extractedText);
  const extractedTextChars =
    typeof record.extractedTextChars === 'number' && Number.isFinite(record.extractedTextChars)
      ? Math.max(0, record.extractedTextChars)
      : undefined;
  const extractedTextTruncated = readBoolean(record.extractedTextTruncated);
  return {
    id,
    type,
    file: {
      name,
      mimeType,
      size,
      kind,
      uploadedAt,
      ...(extension ? { extension } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    },
    ...(relativePath ? { relativePath } : {}),
    ...(transferMode ? { transferMode } : {}),
    ...(workspaceFileNodeId ? { workspaceFileNodeId } : {}),
    ...(claimRef ? { claimRef } : {}),
    ...(extractedText !== undefined ? { extractedText } : {}),
    ...(extractedTextChars !== undefined ? { extractedTextChars } : {}),
    ...(extractedTextTruncated !== undefined ? { extractedTextTruncated } : {}),
  };
}

function normalizeInputParts(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((entry, index) => normalizeInputPart(entry, index))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return parts.length > 0 ? parts : undefined;
}

function splitStructuredTextItems(text: string): string[] {
  const bulletItems = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter(Boolean);
  if (bulletItems.length >= 2) {
    return bulletItems;
  }
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => /^(?:chunk|morceau|requirement|task)\s+\d+\b[:.)-]?\s*/i.test(block))
    .map((block) => block.replace(/^(?:chunk|morceau|requirement|task)\s+\d+\b[:.)-]?\s*/i, '').trim())
    .filter(Boolean);
  return blocks.length >= 2 ? blocks : [];
}

function expandStructuredInputParts(
  parts: Record<string, unknown>[] | undefined,
  context: {
    key?: string;
    label?: string;
    summary?: string;
    instructions?: string;
    multiple?: boolean;
  },
): Record<string, unknown>[] | undefined {
  if (!parts || parts.length !== 1) {
    return parts;
  }
  const text = readString(parts[0]?.text)?.trim();
  if (!text) {
    return parts;
  }
  const looksChunky = [context.key, context.label, context.summary, context.instructions]
    .filter((value): value is string => Boolean(value))
    .some((value) => /\b(app|bootstrap|chunk|chunks|morceau|morceaux|requirement|requirements|task|tasks)\b/i.test(value));
  if (!context.multiple && !looksChunky) {
    return parts;
  }
  const items = splitStructuredTextItems(text);
  if (items.length < 2) {
    return parts;
  }
  return items.map((entry, index) => ({
    id: `part-${index + 1}`,
    type: 'text',
    text: entry,
  }));
}

function buildTemplateInputContent(value: unknown): GraphNode['content'] | null {
  const next = {
    mode: 'template',
    ...normalizeInputBase(value),
  };
  const parsed = readWorkflowInputContent(next);
  return parsed?.mode === 'template' ? parsed : null;
}

function buildBoundInputContent(
  value: unknown,
  inherited?: Record<string, unknown>,
): GraphNode['content'] | null {
  const record = readRecord(value);
  if (!record) return null;
  const runId = readString(record.runId)?.trim();
  const executionId = readString(record.executionId)?.trim();
  const templateNodeId = readString(record.templateNodeId)?.trim();
  const summary = readString(record.summary)?.trim();
  const base = {
    ...normalizeInputBase(inherited),
    ...normalizeInputBase(record),
  };
  const parts = expandStructuredInputParts(normalizeInputParts(record.parts), {
    key: readString(base.key)?.trim(),
    label: readString(base.label)?.trim(),
    summary,
    instructions: readString(base.instructions)?.trim(),
    multiple: readBoolean(base.multiple),
  });
  const next = {
    ...base,
    mode: 'bound',
    ...(runId ? { runId } : {}),
    ...(executionId ? { executionId } : {}),
    ...(templateNodeId ? { templateNodeId } : {}),
    ...(parts ? { parts } : {}),
    ...(summary ? { summary } : {}),
  };
  const parsed = readWorkflowInputContent(next);
  return parsed?.mode === 'bound' ? parsed : null;
}

function normalizeWorkflowInputNodeContent(
  content: GraphNode['content'],
  refs: Map<string, string>,
  nodesById: Map<string, GraphNode>,
): GraphNode['content'] {
  const record = readRecord(content);
  const mode = readString(record?.mode)?.trim();
  if (mode === 'template') {
    return buildTemplateInputContent(content) ?? content;
  }
  if (mode === 'bound') {
    const templateNodeId = resolveOptionalNodeRef(record?.templateNodeId, refs) ?? readString(record?.templateNodeId)?.trim();
    const templateNode = templateNodeId ? nodesById.get(templateNodeId) : undefined;
    const template = templateNode ? readWorkflowInputContent(templateNode.content) : null;
    return (
      buildBoundInputContent(
        {
          ...(record ?? {}),
          ...(templateNodeId ? { templateNodeId } : {}),
        },
        template?.mode === 'template' ? normalizeInputBase(template) : undefined,
      ) ?? content
    );
  }
  return content;
}

function normalizeValidatorAction(
  value: unknown,
  fallback: 'pass' | 'retry_same_item' | 'retry_new_execution' | 'block' | 'request_human' | 'complete',
): 'pass' | 'retry_same_item' | 'retry_new_execution' | 'block' | 'request_human' | 'complete' {
  const raw = readString(value)?.trim();
  if (!raw) return fallback;
  if (
    raw === 'pass' ||
    raw === 'retry_same_item' ||
    raw === 'retry_new_execution' ||
    raw === 'block' ||
    raw === 'request_human' ||
    raw === 'complete'
  ) {
    return raw;
  }
  if (raw === 'advance') return 'pass';
  if (raw === 'retry_body' || raw === 'retry' || raw === 'retry_item') return 'retry_same_item';
  if (raw === 'retry_execution' || raw === 'retry_new_run') return 'retry_new_execution';
  if (raw === 'pause' || raw === 'pause_controller') return 'block';
  if (raw === 'human' || raw === 'ask_human') return 'request_human';
  return fallback;
}

function normalizeValidatorCheck(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value);
  const rawKind = readString(record?.kind)?.trim();
  const kind =
    rawKind === 'file_ends_with' || rawKind === 'file_final_line_equals'
      ? 'file_last_line_equals'
      : rawKind;
  if (!kind) return null;
  if (kind === 'file_contains' || kind === 'file_not_contains' || kind === 'file_last_line_equals') {
    const path = readString(record?.path)?.trim();
    const text =
      readString(record?.text)?.trim() ??
      readString(record?.substring)?.trim() ??
      readString(record?.contains)?.trim() ??
      readString(record?.line)?.trim() ??
      readString(record?.lastLine)?.trim();
    if (!path || !text) return null;
    return { kind, path, text };
  }
  if (
    kind === 'path_exists'
    || kind === 'path_not_exists'
    || kind === 'path_nonempty'
    || kind === 'json_array_nonempty'
    || kind === 'workflow_transfer_valid'
  ) {
    const path = readString(record?.path)?.trim();
    if (!path) return null;
    return { kind, path };
  }
  if (
    kind === 'json_path_exists'
    || kind === 'json_path_nonempty'
    || kind === 'json_path_array_nonempty'
  ) {
    const path = readString(record?.path)?.trim();
    const jsonPath =
      readString(record?.jsonPath)?.trim() ??
      readString(record?.pathInJson)?.trim() ??
      readString(record?.pointer)?.trim();
    if (!path || !jsonPath) return null;
    return { kind, path, jsonPath };
  }
  return null;
}

function normalizeWorkflowDecisionContent(content: GraphNode['content']): GraphNode['content'] {
  const record = readRecord(content);
  if (readString(record?.mode)?.trim() !== 'workspace_validator') {
    return content;
  }
  const checks = Array.isArray(record?.checks)
    ? record.checks.map(normalizeValidatorCheck).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  return {
    mode: 'workspace_validator',
    requirements: normalizeStringList(record?.requirements),
    evidenceFrom: normalizeStringList(record?.evidenceFrom),
    checks,
    passAction: normalizeValidatorAction(record?.passAction, 'pass'),
    failAction: normalizeValidatorAction(record?.failAction, 'retry_same_item'),
    blockAction: normalizeValidatorAction(record?.blockAction, 'block'),
  };
}

function normalizeLoopSessionPolicy(value: unknown): { withinItem: 'reuse_execution' | 'new_execution'; betweenItems: 'reuse_execution' | 'new_execution' } {
  const record = readRecord(value);
  const within = readString(record?.withinItem)?.trim();
  const between = readString(record?.betweenItems)?.trim();
  if (
    (within === 'reuse_execution' || within === 'new_execution') &&
    (between === 'reuse_execution' || between === 'new_execution')
  ) {
    return {
      withinItem: within,
      betweenItems: between,
    };
  }
  const legacy = readString(value)?.trim();
  if (legacy === 'new_within_item') {
    return { withinItem: 'new_execution', betweenItems: 'new_execution' };
  }
  return { withinItem: 'reuse_execution', betweenItems: 'new_execution' };
}

function normalizeLoopSource(value: unknown, refs: Map<string, string>): Record<string, unknown> | null {
  const source = readRecord(value);
  const kind = readString(source?.kind)?.trim();
  if (!kind) return null;
  if (kind === 'input_parts') {
    const templateNodeId =
      resolveOptionalNodeRef(source?.templateNodeId, refs) ??
      resolveOptionalNodeRef(source?.inputNodeId, refs) ??
      resolveOptionalNodeRef(source?.sourceNodeId, refs);
    if (!templateNodeId) return null;
    const boundNodeId =
      resolveOptionalNodeRef(source?.boundNodeId, refs) ??
      resolveOptionalNodeRef(source?.boundInputNodeId, refs);
    return {
      kind,
      templateNodeId,
      ...(boundNodeId ? { boundNodeId } : {}),
    };
  }
  if (kind === 'json_file') {
    const fileNodeId = resolveOptionalNodeRef(source?.fileNodeId, refs);
    const relativePath = readString(source?.relativePath)?.trim();
    if (!fileNodeId && !relativePath) return null;
    return {
      kind,
      ...(fileNodeId ? { fileNodeId } : {}),
      ...(relativePath ? { relativePath } : {}),
    };
  }
  if (kind === 'inline_list') {
    const items = Array.isArray(source?.items) ? source.items : [];
    if (items.length === 0) return null;
    return { kind, items };
  }
  if (kind === 'future_source') {
    const sourceKey =
      readString(source?.sourceKey)?.trim() ??
      readString(source?.key)?.trim();
    if (!sourceKey) return null;
    return { kind, sourceKey };
  }
  return null;
}

function normalizeLoopAdvancePolicy(value: unknown): 'only_on_pass' | 'always_advance' {
  return readString(value)?.trim() === 'always_advance' ? 'always_advance' : 'only_on_pass';
}

function normalizeLoopBlockedPolicy(value: unknown): 'pause_controller' | 'request_human' | 'skip_item' | 'stop_controller' {
  const raw = readString(value)?.trim();
  if (raw === 'request_human' || raw === 'skip_item' || raw === 'stop_controller') {
    return raw;
  }
  return 'pause_controller';
}

function normalizeWorkflowLoopContent(
  content: GraphNode['content'],
  refs: Map<string, string>,
): GraphNode['content'] {
  const record = readRecord(content);
  const mode = readString(record?.mode)?.trim();
  const source = normalizeLoopSource(record?.source, refs);
  const bodyNodeId =
    resolveOptionalNodeRef(record?.bodyNodeId, refs) ??
    resolveOptionalNodeRef(record?.stepNodeId, refs) ??
    resolveOptionalNodeRef(record?.childNodeId, refs);
  if ((mode !== 'for_each' && mode !== 'while') || !source || !bodyNodeId) {
    return content;
  }
  const validatorNodeId =
    resolveOptionalNodeRef(record?.validatorNodeId, refs) ??
    resolveOptionalNodeRef(record?.decisionNodeId, refs);
  const itemLabel = readString(record?.itemLabel)?.trim();
  const maxAttemptsPerItem = normalizePositiveInt(record?.maxAttemptsPerItem);
  const maxIterations = normalizePositiveInt(record?.maxIterations);
  return {
    mode,
    source,
    bodyNodeId,
    ...(validatorNodeId ? { validatorNodeId } : {}),
    advancePolicy: normalizeLoopAdvancePolicy(record?.advancePolicy),
    sessionPolicy: normalizeLoopSessionPolicy(record?.sessionPolicy),
    ...(maxAttemptsPerItem ? { maxAttemptsPerItem } : {}),
    ...(maxIterations ? { maxIterations } : {}),
    blockedPolicy: normalizeLoopBlockedPolicy(record?.blockedPolicy),
    ...(itemLabel ? { itemLabel } : {}),
  };
}

function normalizeWorkflowArtifactNodeContent(content: GraphNode['content']): GraphNode['content'] {
  const record = readRecord(content);
  const relativePath = readString(record?.relativePath)?.trim();
  const role = readString(record?.role)?.trim();
  const origin = readString(record?.origin)?.trim();
  const kind = readString(record?.kind)?.trim();
  if (
    !relativePath ||
    (role !== 'input' && role !== 'output' && role !== 'intermediate') ||
    (origin !== 'user_upload' && origin !== 'agent_output' && origin !== 'workspace_existing' && origin !== 'derived') ||
    (kind !== 'text' && kind !== 'image' && kind !== 'binary' && kind !== 'directory')
  ) {
    return content;
  }
  const pathMode = readString(record?.pathMode)?.trim();
  const transferMode = readString(record?.transferMode)?.trim();
  const status = readString(record?.status)?.trim();
  const change = readString(record?.change)?.trim();
  const resolvedRelativePath =
    pathMode === 'per_run'
      ? undefined
      : readString(record?.resolvedRelativePath)?.trim();
  const size =
    typeof record?.size === 'number' && Number.isFinite(record.size) && record.size >= 0
      ? record.size
      : undefined;
  return {
    ...(readString(record?.title)?.trim() ? { title: readString(record?.title)?.trim() } : {}),
    relativePath,
    ...(pathMode === 'static' || pathMode === 'per_run' ? { pathMode } : {}),
    ...(resolvedRelativePath ? { resolvedRelativePath } : {}),
    role,
    origin,
    kind,
    ...(readString(record?.mimeType)?.trim() ? { mimeType: readString(record?.mimeType)?.trim() } : {}),
    ...(size != null ? { size } : {}),
    ...(transferMode === 'reference' || transferMode === 'context' || transferMode === 'claim_check'
      ? { transferMode }
      : {}),
    ...(readString(record?.summary)?.trim() ? { summary: readString(record?.summary)?.trim() } : {}),
    ...(readString(record?.excerpt)?.trim() ? { excerpt: readString(record?.excerpt)?.trim() } : {}),
    ...(readString(record?.sourceTemplateNodeId)?.trim()
      ? { sourceTemplateNodeId: readString(record?.sourceTemplateNodeId)?.trim() }
      : {}),
    ...(readString(record?.sourceExecutionId)?.trim()
      ? { sourceExecutionId: readString(record?.sourceExecutionId)?.trim() }
      : {}),
    ...(readString(record?.sourceRunId)?.trim() ? { sourceRunId: readString(record?.sourceRunId)?.trim() } : {}),
    ...(readString(record?.claimRef)?.trim() ? { claimRef: readString(record?.claimRef)?.trim() } : {}),
    ...(status === 'declared' || status === 'available' || status === 'missing' || status === 'deleted'
      ? { status }
      : {}),
    ...(readString(record?.lastSeenAt)?.trim() ? { lastSeenAt: readString(record?.lastSeenAt)?.trim() } : {}),
    ...(change === 'added' || change === 'modified' || change === 'deleted' ? { change } : {}),
  };
}

function normalizeSubgraphBinding(value: unknown): string | { template: string; format?: 'text' | 'json' } | null {
  const text = readString(value)?.trim();
  if (text) return text;
  const record = readRecord(value);
  const template = readString(record?.template)?.trim();
  if (!template) return null;
  return readString(record?.format)?.trim() === 'json'
    ? { template, format: 'json' }
    : { template };
}

function normalizeWorkflowRef(value: unknown, sessionId: string): Record<string, unknown> {
  const record = readRecord(value);
  const kind = readString(record?.kind)?.trim();
  const refSessionId = readString(record?.sessionId)?.trim() ?? sessionId;
  if (kind === 'library') {
    const versionTag = readString(record?.versionTag)?.trim();
    return {
      kind,
      sessionId: refSessionId,
      ...(versionTag ? { versionTag } : {}),
    };
  }
  return {
    kind: 'session',
    sessionId: refSessionId,
  };
}

function normalizeWorkflowSubgraphContent(
  content: GraphNode['content'],
  refs: Map<string, string>,
  sessionId: string,
): GraphNode['content'] {
  const record = readRecord(content);
  if (!record) return content;
  const inputMapRecord = readRecord(record.inputMap);
  const inputMap = Object.fromEntries(
    Object.entries(inputMapRecord ?? {})
      .map(([key, value]) => [key, normalizeSubgraphBinding(value)] as const)
      .filter((entry): entry is readonly [string, string | { template: string; format?: 'text' | 'json' }] => Boolean(entry[1])),
  );
  const executionRecord = readRecord(record.execution);
  const execType = readString(executionRecord?.type)?.trim();
  const model = readModel(executionRecord?.model);
  const expectedOutputs = normalizeStringList(record.expectedOutputs);
  const entryNodeId =
    resolveOptionalNodeRef(record.entryNodeId, refs) ??
    resolveOptionalNodeRef(record.stepNodeId, refs);
  const next = {
    workflowRef: normalizeWorkflowRef(record.workflowRef, sessionId),
    inputMap,
    execution: {
      ...((executionRecord?.newExecution === true || execType === 'new_execution') ? { newExecution: true } : {}),
      ...(execType && execType !== 'new_execution' ? { type: agentTypeSchemaOrThrow(execType) } : {}),
      ...(model ? { model } : {}),
    },
    ...(expectedOutputs.length > 0 ? { expectedOutputs } : {}),
    ...(entryNodeId ? { entryNodeId } : {}),
  };
  const selection = readNodeAgentSelection(record);
  return selection ? applyNodeAgentSelection('sub_graph', next, selection) : next;
}

function normalizeManagedFlowPhaseKind(value: unknown): WorkflowManagedFlowPhase['kind'] | null {
  const raw = readString(value)?.trim();
  if (!raw) return null;
  if (
    raw === 'loop_phase'
    || raw === 'agent_phase'
    || raw === 'validation_phase'
    || raw === 'derive_input_phase'
    || raw === 'runtime_verify_phase'
  ) {
    return raw;
  }
  if (raw === 'loop' || raw === 'controller' || raw === 'loop_controller' || raw === 'dev_loop') {
    return 'loop_phase';
  }
  if (raw === 'agent' || raw === 'agent_step' || raw === 'execution' || raw === 'audit' || raw === 'audit_phase') {
    return 'agent_phase';
  }
  if (raw === 'validator' || raw === 'validation' || raw === 'validator_phase' || raw === 'workspace_validation') {
    return 'validation_phase';
  }
  if (raw === 'derive' || raw === 'derive_phase' || raw === 'derive_work' || raw === 'derive_inputs') {
    return 'derive_input_phase';
  }
  if (raw === 'verify' || raw === 'verify_phase' || raw === 'runtime_check' || raw === 'verify_runtime') {
    return 'runtime_verify_phase';
  }
  return null;
}

function normalizeManagedFlowSelection(value: unknown): { type?: AgentType; model?: AgentModelRef } | undefined {
  const record = readRecord(value);
  const rawType =
    readString(record?.type)?.trim()
    ?? readString(record?.agentType)?.trim()
    ?? readString(record?.providerType)?.trim();
  const model = readModel(record?.model ?? value);
  const type = rawType ? agentTypeSchemaOrThrow(rawType) : undefined;
  if (!type && !model) {
    return undefined;
  }
  return {
    ...(type ? { type } : {}),
    ...(model ? { model } : {}),
  };
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

function normalizeManagedFlowPhase(
  value: unknown,
  index: number,
  refs: Map<string, string>,
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
      resolveOptionalNodeRef(record.nodeId, refs)
      ?? resolveOptionalNodeRef(record.loopNodeId, refs)
      ?? resolveOptionalNodeRef(record.controllerNodeId, refs);
    if (!nodeId) return null;
    return {
      id,
      kind,
      ...(title ? { title } : {}),
      nodeId,
      ...((readBoolean(record.forceRestart) ?? readBoolean(record.restart)) === true
        ? { forceRestart: true }
        : {}),
    };
  }
  if (kind === 'agent_phase' || kind === 'runtime_verify_phase') {
    const nodeId =
      resolveOptionalNodeRef(record.nodeId, refs)
      ?? resolveOptionalNodeRef(record.stepNodeId, refs)
      ?? resolveOptionalNodeRef(record.agentNodeId, refs)
      ?? resolveOptionalNodeRef(record.runtimeNodeId, refs);
    if (!nodeId) return null;
    const validatorNodeId =
      resolveOptionalNodeRef(record.validatorNodeId, refs)
      ?? resolveOptionalNodeRef(record.decisionNodeId, refs);
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
      resolveOptionalNodeRef(record.validatorNodeId, refs)
      ?? resolveOptionalNodeRef(record.decisionNodeId, refs)
      ?? resolveOptionalNodeRef(record.nodeId, refs);
    if (!validatorNodeId) return null;
    const sourceNodeId =
      resolveOptionalNodeRef(record.sourceNodeId, refs)
      ?? resolveOptionalNodeRef(record.fileNodeId, refs)
      ?? resolveOptionalNodeRef(record.sourceFileNodeId, refs);
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
    resolveOptionalNodeRef(record.sourceNodeId, refs)
    ?? resolveOptionalNodeRef(record.fileNodeId, refs)
    ?? resolveOptionalNodeRef(record.reportNodeId, refs)
    ?? resolveOptionalNodeRef(record.nodeId, refs);
  const targetTemplateNodeId =
    resolveOptionalNodeRef(record.targetTemplateNodeId, refs)
    ?? resolveOptionalNodeRef(record.templateNodeId, refs)
    ?? resolveOptionalNodeRef(record.inputTemplateNodeId, refs)
    ?? resolveOptionalNodeRef(record.targetNodeId, refs);
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

function normalizeWorkflowManagedFlowContent(
  content: GraphNode['content'],
  refs: Map<string, string>,
): GraphNode['content'] {
  const record = readRecord(content);
  if (!record) return content;
  const rawPhases =
    Array.isArray(record.phases) ? record.phases : Array.isArray(record.steps) ? record.steps : [];
  if (rawPhases.length === 0) {
    return content;
  }
  const used = new Set<string>();
  const phases = rawPhases
    .map((phase, index) => normalizeManagedFlowPhase(phase, index, refs, used))
    .filter((phase): phase is WorkflowManagedFlowPhase => Boolean(phase));
  if (phases.length === 0) {
    return content;
  }
  const title = readString(record.title)?.trim() ?? readString(record.label)?.trim();
  const entryPhaseId =
    [
      readString(record.entryPhaseId)?.trim(),
      readString(record.entry)?.trim(),
      readString(record.startPhaseId)?.trim(),
    ].find((value): value is string => Boolean(value && phases.some((phase) => phase.id === value)))
    ?? phases[0]?.id;
  const next = {
    ...(title ? { title } : {}),
    syncMode: readString(record.syncMode)?.trim() === 'mirrored' ? 'mirrored' : 'managed',
    ...(entryPhaseId ? { entryPhaseId } : {}),
    phases,
  };
  return readWorkflowManagedFlowContent(next) ?? content;
}

export function buildDerivedBoundInputContent(
  node: GraphNode,
  patch: WorkflowCopilotNodePatch,
): GraphNode['content'] | null {
  if (node.type !== 'input' || !patch.content) {
    return null;
  }
  const current = readWorkflowInputContent(node.content);
  if (current?.mode !== 'template') {
    return null;
  }
  const content = readRecord(patch.content);
  if (readString(content?.mode)?.trim() !== 'bound') {
    return null;
  }
  return buildBoundInputContent(
    {
      ...normalizeInputBase(current),
      ...content,
      mode: 'bound',
      templateNodeId: node.id,
    },
    normalizeInputBase(current),
  );
}

export function normalizeNodeContent(
  type: GraphNode['type'],
  content: GraphNode['content'],
  fallback: AgentType,
  refs: Map<string, string>,
  sessionId: string,
  nodesById: Map<string, GraphNode>,
): Pick<GraphNode, 'type' | 'content'> {
  const step =
    type === 'agent_step' || type === 'agent_spawn'
      ? normalizeStepNode(type, content, fallback)
      : { type, content };
  return {
    type: step.type,
    content:
      step.type === 'loop'
        ? normalizeWorkflowLoopContent(step.content, refs)
        : step.type === 'managed_flow'
          ? normalizeWorkflowManagedFlowContent(step.content, refs)
          : step.type === 'sub_graph'
            ? normalizeWorkflowSubgraphContent(step.content, refs, sessionId)
            : step.type === 'workspace_file'
              ? normalizeWorkflowArtifactNodeContent(step.content)
              : step.type === 'input'
                ? normalizeWorkflowInputNodeContent(step.content, refs, nodesById)
                : step.type === 'decision'
                  ? normalizeWorkflowDecisionContent(step.content)
                  : step.content,
  };
}

function normalizeStepNode(
  type: GraphNode['type'],
  content: GraphNode['content'],
  fallback: AgentType,
): Pick<GraphNode, 'type' | 'content'> {
  if (type !== 'agent_step' && type !== 'agent_spawn') {
    return { type, content };
  }
  const raw =
    content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  const { agentType: rawType, model: rawModel, agentSelection: _rawSelection, ...rest } = raw;
  const selection = readNodeAgentSelection(raw);
  if (selection) {
    return {
      type: 'agent_step',
      content: applyNodeAgentSelection('agent_step', rest as GraphNode['content'], selection),
    };
  }
  const model = readModelRef(
    readString((rawModel as { providerID?: unknown } | undefined)?.providerID) ?? null,
    readString((rawModel as { modelID?: unknown } | undefined)?.modelID) ?? null,
  );
  return {
    type: 'agent_step',
    content: applyNodeAgentSelection('agent_step', rest as GraphNode['content'], {
      mode: 'locked',
      selection: {
        type: agentTypeSchemaOrThrow(readString(rawType) ?? fallback),
        ...(model ? { model } : {}),
      },
    }),
  };
}

export function normalizeNodePatch(
  type: GraphNode['type'] | undefined,
  patch: WorkflowCopilotNodePatch,
  refs: Map<string, string>,
  sessionId: string,
  fallback: AgentType,
  nodesById: Map<string, GraphNode>,
): WorkflowCopilotNodePatch {
  if (!type || !patch.content) {
    return patch;
  }
  return {
    ...patch,
    content: normalizeNodeContent(type, patch.content, fallback, refs, sessionId, nodesById).content as Record<string, unknown>,
  };
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function workflowFromSafeJson(value: unknown): WorkflowTransfer {
  const parsed = parseWorkflowTransfer(value);
  if (parsed.success) return parsed.data;
  throw new BadRequestException('WORKFLOW_COPILOT_FLOW_INVALID');
}
