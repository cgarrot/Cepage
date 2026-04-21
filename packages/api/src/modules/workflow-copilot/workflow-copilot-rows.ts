import { BadRequestException, HttpException } from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentModelRef,
  AgentType,
  WorkflowCopilotApplySummary,
  WorkflowCopilotCheckpoint,
  WorkflowCopilotExecution,
  WorkflowCopilotExecutionResult,
  WorkflowCopilotMessage,
  WorkflowCopilotMode,
  WorkflowCopilotOp,
  WorkflowCopilotScope,
  WorkflowCopilotThread,
  WorkflowCopilotThreadBundle,
  WorkflowCopilotTurn,
} from '@cepage/shared-core';
import {
  workflowCopilotApplySummarySchema,
  workflowCopilotAttachmentSchema,
  workflowCopilotCheckpointSchema,
  workflowCopilotMessageSchema,
  workflowCopilotModeSchema,
  workflowCopilotScopeSchema,
  workflowCopilotThreadMetadataSchema,
  workflowCopilotThreadSchema,
} from '@cepage/shared-core';
import { WORKFLOW_COPILOT_PARSE_FAILED, parseWorkflowCopilotTurn } from './workflow-copilot-turn';
import type { BundleRow, CheckpointRow, MessageRow, ThreadRow } from './workflow-copilot.types';
import { DEFAULT_AGENT_TYPE, DEFAULT_MODE, DEFAULT_SCOPE } from './workflow-copilot.types';

export function bundleToThread(row: BundleRow): WorkflowCopilotThreadBundle {
  const thread = rowToThread(row);
  return {
    thread,
    messages: row.messages.map((message) => rowToMessage(message, thread.mode)),
    checkpoints: row.checkpoints.map(rowToCheckpoint),
  };
}

export function rowToThread(row: ThreadRow): WorkflowCopilotThread {
  return workflowCopilotThreadSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    surface: row.surface,
    ownerNodeId: row.ownerNodeId ?? undefined,
    title: row.title ?? undefined,
    agentType: readAgentType(row.agentType),
    model: readModelRef(row.modelProviderId, row.modelId),
    scope: readScope(row.scope),
    mode: readMode(row.mode),
    autoApply: row.autoApply,
    autoRun: row.autoRun,
    externalSessionId: row.externalSessionId ?? undefined,
    metadata: readThreadMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function rowToMessage(row: MessageRow, mode: WorkflowCopilotMode = DEFAULT_MODE): WorkflowCopilotMessage {
  const repaired =
    row.error === WORKFLOW_COPILOT_PARSE_FAILED && row.rawOutput
      ? parseWorkflowCopilotTurn(row.rawOutput)
      : null;
  const turn = repaired?.success ? sanitizeTurn(repaired.turn, mode) : null;
  return workflowCopilotMessageSchema.parse({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    status: turn ? 'completed' : row.status,
    content: turn ? turn.reply : row.content,
    analysis: turn ? turn.analysis || undefined : row.analysis ?? undefined,
    summary: turn ? turn.summary : readSummary(row.summary),
    warnings: turn ? turn.warnings : readSummary(row.warnings),
    ops: turn ? turn.ops : mode === 'ask' ? [] : readOps(row.ops),
    executions:
      turn ? turn.executions : mode === 'ask' ? [] : readCopilotExecutions(row.executions),
    executionResults: readExecutionResults(row.executionResults),
    apply: readApply(row.apply),
    error: turn ? undefined : row.error ?? undefined,
    scope: row.scope ? readScope(row.scope) : undefined,
    agentType: row.agentType ? readAgentType(row.agentType) : undefined,
    model: readModelRef(row.modelProviderId, row.modelId),
    rawOutput: row.rawOutput ?? undefined,
    thinkingOutput: row.thinkingOutput ?? undefined,
    attachments: readCopilotAttachments(row.attachments),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function rowToCheckpoint(row: CheckpointRow): WorkflowCopilotCheckpoint {
  return workflowCopilotCheckpointSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    threadId: row.threadId,
    messageId: row.messageId,
    summary: readSummary(row.summary),
    createdAt: row.createdAt.toISOString(),
    restoredAt: row.restoredAt?.toISOString(),
  });
}

export function readAgentType(value: string): AgentType {
  return agentTypeSchemaOrThrow(value);
}

export function agentTypeSchemaOrThrow(value: string): AgentType {
  const parsed = workflowCopilotThreadSchema.shape.agentType.safeParse(value);
  if (!parsed.success) return DEFAULT_AGENT_TYPE;
  return parsed.data;
}

export function readModelRef(providerID: string | null, modelID: string | null): AgentModelRef | undefined {
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function readScope(value: unknown): WorkflowCopilotScope {
  const parsed = workflowCopilotScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SCOPE;
}

export function readMode(value: unknown): WorkflowCopilotMode {
  const parsed = workflowCopilotModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_MODE;
}

export function readThreadMetadata(value: unknown): WorkflowCopilotThread['metadata'] {
  if (value == null) return undefined;
  const parsed = workflowCopilotThreadMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readCopilotAttachments(
  value: unknown,
): WorkflowCopilotMessage['attachments'] {
  if (value == null) return undefined;
  const parsed = z.array(workflowCopilotAttachmentSchema).safeParse(value);
  if (!parsed.success || parsed.data.length === 0) return undefined;
  return parsed.data;
}

export function decodeBase64DataUrlUtf8(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice(0, comma);
  if (!meta.toLowerCase().includes(';base64')) return null;
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function decodeBase64DataUrlBuffer(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice(0, comma);
  if (!meta.toLowerCase().includes(';base64')) return null;
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

export function sanitizeTurn(turn: WorkflowCopilotTurn, mode: WorkflowCopilotMode): WorkflowCopilotTurn {
  if (mode !== 'ask') return turn;
  return {
    analysis: turn.analysis,
    reply: turn.reply,
    summary: [...turn.summary],
    warnings: [...turn.warnings],
    ops: [],
    executions: [],
    attachmentGraph: turn.attachmentGraph,
    ...(turn.architecture ? { architecture: turn.architecture } : {}),
  };
}

export function readSummary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function readOps(value: unknown): WorkflowCopilotOp[] {
  const parsed = workflowCopilotMessageSchema.shape.ops.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function readApply(value: unknown): WorkflowCopilotApplySummary | undefined {
  const parsed = workflowCopilotApplySummarySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readCopilotExecutions(value: unknown): WorkflowCopilotExecution[] {
  if (value == null) return [];
  const parsed = workflowCopilotMessageSchema.shape.executions.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function readExecutionResults(value: unknown): WorkflowCopilotExecutionResult[] {
  if (value == null) return [];
  const parsed = workflowCopilotMessageSchema.shape.executionResults.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function executionResultRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return { value };
}

export function readCopilotExecutionError(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.filter((x): x is string => typeof x === 'string').join(', ');
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function threadOwnerKey(surface: WorkflowCopilotThread['surface'], ownerNodeId?: string): string {
  if (surface === 'node') {
    if (!ownerNodeId) throw new BadRequestException('WORKFLOW_COPILOT_OWNER_NODE_REQUIRED');
    return ownerNodeId;
  }
  return 'sidebar';
}

export function defaultScope(surface: WorkflowCopilotThread['surface'], ownerNodeId?: string): WorkflowCopilotScope {
  if (surface === 'node' && ownerNodeId) {
    return { kind: 'node', nodeId: ownerNodeId };
  }
  return DEFAULT_SCOPE;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
