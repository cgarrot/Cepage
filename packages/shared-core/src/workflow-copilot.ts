import { z } from 'zod';
import { agentModelRefSchema, agentTypeSchema, workflowRunRequestSchema } from './agent';
import { edgeDirectionSchema, edgeRelationSchema, nodeStatusSchema, nodeTypeSchema } from './graph';
import {
  workflowControllerRunRequestSchema,
  workflowManagedFlowRunRequestSchema,
} from './workflow-control';
import { agentToolsetIdSchema } from './agent-kernel';
import { workflowTransferSchema } from './workflow';
import { workflowSkillRefSchema } from './workflow-skill';
import {
  workflowArchitectStateSchema,
  workflowArchitectureSpecSchema,
} from './workflow-architect';

const textSchema = z.string().min(1);
const jsonSchema = z.record(z.string(), z.unknown());
const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
const dimensionsSchema = z.object({
  width: z.number(),
  height: z.number(),
});
const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const workflowCopilotSurfaceSchema = z.enum(['sidebar', 'node']);
export type WorkflowCopilotSurface = z.infer<typeof workflowCopilotSurfaceSchema>;

export const workflowCopilotScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }),
  z.object({ kind: z.literal('node'), nodeId: textSchema }),
  z.object({
    kind: z.literal('subgraph'),
    nodeId: textSchema,
    nodeIds: z.array(textSchema).optional(),
  }),
]);
export type WorkflowCopilotScope = z.infer<typeof workflowCopilotScopeSchema>;

export const workflowCopilotModeSchema = z.enum(['edit', 'ask']);
export type WorkflowCopilotMode = z.infer<typeof workflowCopilotModeSchema>;

export const workflowCopilotRoleSchema = z.enum(['copilot', 'concierge']);
export type WorkflowCopilotRole = z.infer<typeof workflowCopilotRoleSchema>;

export const workflowCopilotThreadMetadataSchema = z.object({
  role: workflowCopilotRoleSchema.optional(),
  presentation: z.enum(['studio', 'simple']).optional(),
  skill: workflowSkillRefSchema.optional(),
  lockSkill: z.boolean().optional(),
  toolset: agentToolsetIdSchema.optional(),
  clarificationStatus: z.enum(['idle', 'needs_input', 'ready']).optional(),
  clarificationCount: z.number().int().nonnegative().optional(),
  architect: workflowArchitectStateSchema.optional(),
});
export type WorkflowCopilotThreadMetadata = z.infer<typeof workflowCopilotThreadMetadataSchema>;

export const workflowCopilotNodePatchSchema = z.object({
  content: jsonSchema.optional(),
  position: positionSchema.optional(),
  dimensions: dimensionsSchema.optional(),
  status: nodeStatusSchema.optional(),
  metadata: jsonSchema.optional(),
  branches: z.array(textSchema).optional(),
});
export type WorkflowCopilotNodePatch = z.infer<typeof workflowCopilotNodePatchSchema>;

export const workflowCopilotOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add_node'),
    ref: textSchema.optional(),
    type: nodeTypeSchema,
    position: positionSchema,
    content: jsonSchema.optional(),
    metadata: jsonSchema.optional(),
    status: nodeStatusSchema.optional(),
    branches: z.array(textSchema).optional(),
    dimensions: dimensionsSchema.optional(),
  }),
  z.object({
    kind: z.literal('patch_node'),
    nodeId: textSchema,
    patch: workflowCopilotNodePatchSchema,
  }),
  z.object({
    kind: z.literal('remove_node'),
    nodeId: textSchema,
  }),
  z.object({
    kind: z.literal('add_edge'),
    source: textSchema,
    target: textSchema,
    relation: edgeRelationSchema,
    direction: edgeDirectionSchema.optional(),
    metadata: jsonSchema.optional(),
  }),
  z.object({
    kind: z.literal('remove_edge'),
    edgeId: textSchema,
  }),
  z.object({
    kind: z.literal('create_branch'),
    fromNodeId: textSchema,
    name: textSchema,
    color: textSchema,
  }),
  z.object({
    kind: z.literal('merge_branch'),
    sourceBranchId: textSchema,
    targetBranchId: textSchema,
  }),
  z.object({
    kind: z.literal('abandon_branch'),
    branchId: textSchema,
  }),
  z.object({
    kind: z.literal('set_viewport'),
    viewport: viewportSchema,
  }),
]);
export type WorkflowCopilotOp = z.infer<typeof workflowCopilotOpSchema>;

/** Max copilot-emitted execution intents per model turn (YOLO guardrail). */
export const WORKFLOW_COPILOT_MAX_EXECUTIONS = 5;

export const workflowCopilotWorkflowRunExecutionSchema = workflowRunRequestSchema.extend({
  kind: z.literal('workflow_run'),
  triggerRef: z.string().optional(),
});
export type WorkflowCopilotWorkflowRunExecution = z.infer<typeof workflowCopilotWorkflowRunExecutionSchema>;

export const workflowCopilotManagedFlowRunExecutionSchema = workflowManagedFlowRunRequestSchema.extend({
  kind: z.literal('managed_flow_run'),
  flowNodeId: z.string().optional(),
  flowRef: z.string().optional(),
});
export type WorkflowCopilotManagedFlowRunExecution = z.infer<
  typeof workflowCopilotManagedFlowRunExecutionSchema
>;

export const workflowCopilotControllerRunExecutionSchema = workflowControllerRunRequestSchema.extend({
  kind: z.literal('controller_run'),
  controllerNodeId: z.string().optional(),
  controllerRef: z.string().optional(),
});
export type WorkflowCopilotControllerRunExecution = z.infer<
  typeof workflowCopilotControllerRunExecutionSchema
>;

export const workflowCopilotExecutionSchema = z.discriminatedUnion('kind', [
  workflowCopilotWorkflowRunExecutionSchema,
  workflowCopilotManagedFlowRunExecutionSchema,
  workflowCopilotControllerRunExecutionSchema,
]);
export type WorkflowCopilotExecution = z.infer<typeof workflowCopilotExecutionSchema>;

export const workflowCopilotExecutionResultSchema = z.object({
  kind: z.enum(['workflow_run', 'managed_flow_run', 'controller_run']),
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export type WorkflowCopilotExecutionResult = z.infer<typeof workflowCopilotExecutionResultSchema>;

export const workflowCopilotApplySummarySchema = z.object({
  checkpointId: textSchema,
  summary: z.array(textSchema),
  createdNodeIds: z.array(textSchema),
  updatedNodeIds: z.array(textSchema),
  removedNodeIds: z.array(textSchema),
  createdEdgeIds: z.array(textSchema),
  removedEdgeIds: z.array(textSchema),
  createdBranchIds: z.array(textSchema),
  mergedBranchIds: z.array(textSchema),
  abandonedBranchIds: z.array(textSchema),
  viewportUpdated: z.boolean(),
  appliedAt: textSchema,
  refMap: z.record(z.string(), z.string()).optional(),
});
export type WorkflowCopilotApplySummary = z.infer<typeof workflowCopilotApplySummarySchema>;

/** Where to persist the **current user message** chat attachments on the graph (agent-decided). */
export const workflowCopilotAttachmentGraphSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('new'),
    position: positionSchema.optional(),
    branches: z.array(textSchema).optional(),
  }),
  z.object({
    kind: z.literal('existing'),
    nodeId: textSchema,
  }),
]);
export type WorkflowCopilotAttachmentGraph = z.infer<typeof workflowCopilotAttachmentGraphSchema>;

export const workflowCopilotTurnSchema = z.object({
  analysis: z.string().default(''),
  reply: z.string().default(''),
  summary: z.array(textSchema).default([]),
  warnings: z.array(textSchema).default([]),
  ops: z.array(workflowCopilotOpSchema).default([]),
  executions: z.array(workflowCopilotExecutionSchema).max(WORKFLOW_COPILOT_MAX_EXECUTIONS).default([]),
  attachmentGraph: workflowCopilotAttachmentGraphSchema.default({ kind: 'none' }),
  architecture: workflowArchitectureSpecSchema.optional(),
});
export type WorkflowCopilotTurn = z.infer<typeof workflowCopilotTurnSchema>;

export const workflowCopilotMessageRoleSchema = z.enum(['system', 'user', 'assistant']);
export type WorkflowCopilotMessageRole = z.infer<typeof workflowCopilotMessageRoleSchema>;

export const workflowCopilotMessageStatusSchema = z.enum(['pending', 'completed', 'error']);
export type WorkflowCopilotMessageStatus = z.infer<typeof workflowCopilotMessageStatusSchema>;
export const WORKFLOW_COPILOT_STOPPED = 'WORKFLOW_COPILOT_STOPPED' as const;

/** Max attachments per copilot message (client + server). */
export const WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT = 64;
/** Max decoded payload size per attachment (bytes). */
export const WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
/** Max decoded payload size across all attachments in one message. */
export const WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
/** Max decoded text payload Cursor Agent may inline into one prompt turn. */
export const WORKFLOW_COPILOT_CURSOR_ATTACHMENT_INLINE_MAX_BYTES = 512 * 1024;

/**
 * HTTP JSON body size ceiling for routes that accept copilot attachments (base64 ~4/3 of decoded + framing).
 * Align with {@link WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES}.
 */
export const WORKFLOW_COPILOT_MAX_JSON_BODY_BYTES =
  Math.ceil(WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES * (4 / 3)) + 2 * 1024 * 1024;

const dataUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('data:') && value.includes(','), 'expected data URL');

function normalizeAttachmentPathValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  if (!next) return undefined;
  const path = next.replace(/[\\]+/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.some((part) => part === '.' || part === '..')) return undefined;
  return parts.join('/');
}

const attachmentPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .transform((value) => normalizeAttachmentPathValue(value) ?? '')
  .refine((value) => value.length > 0, 'invalid relative path');

export const workflowCopilotAttachmentMimeAllowlist = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
] as const;

export function workflowCopilotAttachmentMimeAllowed(mime: string): boolean {
  const m = mime.trim().toLowerCase();
  if (m.startsWith('text/')) return true;
  return (workflowCopilotAttachmentMimeAllowlist as readonly string[]).includes(m);
}

/** MIME types Cursor Agent can receive as UTF-8 inlined attachment bodies in the text prompt (no file parts). */
export function workflowCopilotAttachmentMimeInlinableForCursorAgent(mime: string): boolean {
  const m = mime.trim().toLowerCase();
  if (m.startsWith('text/')) return true;
  return m === 'application/json';
}

/** Payload bytes for a base64 data URL (approximate), or null if not base64 data URL. */
export function workflowCopilotDataUrlPayloadBytes(dataUrl: string): number | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice(0, comma).toLowerCase();
  if (!meta.includes(';base64')) return null;
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
  return Math.floor((b64.length * 3) / 4);
}

export function normalizeWorkflowCopilotAttachmentPath(value: string | undefined): string | undefined {
  return normalizeAttachmentPathValue(value);
}

export const workflowCopilotAttachmentSchema = z.object({
  filename: z.string().min(1).max(512),
  relativePath: attachmentPathSchema.optional(),
  mime: z.string().min(1).max(256),
  data: dataUrlSchema,
});
export type WorkflowCopilotAttachment = z.infer<typeof workflowCopilotAttachmentSchema>;

export function workflowCopilotAttachmentDisplayName(
  attachment: Pick<WorkflowCopilotAttachment, 'filename' | 'relativePath'>,
): string {
  return normalizeAttachmentPathValue(attachment.relativePath) ?? attachment.filename;
}

export function workflowCopilotAttachmentTotalBytes(
  attachments: readonly Pick<WorkflowCopilotAttachment, 'data'>[],
): number | null {
  let total = 0;
  for (const attachment of attachments) {
    const bytes = workflowCopilotDataUrlPayloadBytes(attachment.data);
    if (bytes === null) return null;
    total += bytes;
  }
  return total;
}

function refineCopilotAttachmentPayloads(
  attachments: WorkflowCopilotAttachment[],
  ctx: z.RefinementCtx,
  pathRoot: (string | number)[],
) {
  for (let i = 0; i < attachments.length; i += 1) {
    const a = attachments[i]!;
    if (!workflowCopilotAttachmentMimeAllowed(a.mime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mime not allowed: ${a.mime}`,
        path: [...pathRoot, i, 'mime'],
      });
    }
    const bytes = workflowCopilotDataUrlPayloadBytes(a.data);
    if (bytes === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'attachment must be a base64 data URL',
        path: [...pathRoot, i, 'data'],
      });
      continue;
    }
    if (bytes > WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `attachment exceeds ${WORKFLOW_COPILOT_ATTACHMENT_MAX_BYTES} bytes`,
        path: [...pathRoot, i, 'data'],
      });
    }
  }
  const total = workflowCopilotAttachmentTotalBytes(attachments);
  if (total != null && total > WORKFLOW_COPILOT_ATTACHMENT_MAX_TOTAL_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'attachments total size too large',
      path: pathRoot,
    });
  }
}

/** Inline payload on `file_summary` node content during copilot apply; stripped before persist. */
export const WORKFLOW_COPILOT_FILE_SUMMARY_EMBEDDED_KEY = 'copilotEmbeddedFiles' as const;

export const workflowCopilotEmbeddedFilesListSchema = z
  .array(workflowCopilotAttachmentSchema)
  .max(WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT)
  .superRefine((attachments, ctx) => refineCopilotAttachmentPayloads(attachments, ctx, []));

export function peelCopilotEmbeddedFilesFromNodeContent(
  content: unknown,
):
  | { ok: true; rest: unknown; files: WorkflowCopilotAttachment[] }
  | { ok: false; error: string } {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: true, rest: content, files: [] };
  }
  const rec = content as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(rec, WORKFLOW_COPILOT_FILE_SUMMARY_EMBEDDED_KEY)) {
    return { ok: true, rest: content, files: [] };
  }
  const raw = rec[WORKFLOW_COPILOT_FILE_SUMMARY_EMBEDDED_KEY];
  const { [WORKFLOW_COPILOT_FILE_SUMMARY_EMBEDDED_KEY]: _, ...rest } = rec;
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'copilotEmbeddedFiles must be an array' };
  }
  if (raw.length === 0) {
    return { ok: true, rest: Object.keys(rest).length ? rest : {}, files: [] };
  }
  const parsed = workflowCopilotEmbeddedFilesListSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((issue) => issue.message).join('; ');
    return { ok: false, error: msg || 'invalid copilotEmbeddedFiles' };
  }
  return { ok: true, rest: Object.keys(rest).length ? rest : {}, files: parsed.data };
}

export const workflowCopilotThreadSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  surface: workflowCopilotSurfaceSchema,
  ownerNodeId: z.string().optional(),
  title: z.string().optional(),
  agentType: agentTypeSchema,
  model: agentModelRefSchema.optional(),
  scope: workflowCopilotScopeSchema,
  mode: workflowCopilotModeSchema.default('edit'),
  autoApply: z.boolean(),
  autoRun: z.boolean(),
  externalSessionId: z.string().optional(),
  metadata: workflowCopilotThreadMetadataSchema.optional(),
  createdAt: textSchema,
  updatedAt: textSchema,
});
export type WorkflowCopilotThread = z.infer<typeof workflowCopilotThreadSchema>;

export const workflowCopilotMessageSchema = z.object({
  id: textSchema,
  threadId: textSchema,
  role: workflowCopilotMessageRoleSchema,
  status: workflowCopilotMessageStatusSchema,
  content: z.string(),
  analysis: z.string().optional(),
  summary: z.array(textSchema).default([]),
  warnings: z.array(textSchema).default([]),
  ops: z.array(workflowCopilotOpSchema).default([]),
  executions: z.array(workflowCopilotExecutionSchema).default([]),
  executionResults: z.array(workflowCopilotExecutionResultSchema).default([]),
  apply: workflowCopilotApplySummarySchema.optional(),
  error: z.string().optional(),
  scope: workflowCopilotScopeSchema.optional(),
  agentType: agentTypeSchema.optional(),
  model: agentModelRefSchema.optional(),
  rawOutput: z.string().optional(),
  // Live reasoning / chain-of-thought stream replayed by the Copilot UI as a
  // collapsible "Thinking…" panel. Empty for agents/models that don't surface
  // a separate reasoning channel; persisted on the assistant row so reloads
  // after the run still show the captured trail.
  thinkingOutput: z.string().optional(),
  attachments: z.array(workflowCopilotAttachmentSchema).optional(),
  createdAt: textSchema,
  updatedAt: textSchema,
});
export type WorkflowCopilotMessage = z.infer<typeof workflowCopilotMessageSchema>;

export const workflowCopilotCheckpointSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  threadId: textSchema,
  messageId: textSchema,
  summary: z.array(textSchema).default([]),
  createdAt: textSchema,
  restoredAt: z.string().optional(),
});
export type WorkflowCopilotCheckpoint = z.infer<typeof workflowCopilotCheckpointSchema>;

export const workflowCopilotThreadBundleSchema = z.object({
  thread: workflowCopilotThreadSchema,
  messages: z.array(workflowCopilotMessageSchema),
  checkpoints: z.array(workflowCopilotCheckpointSchema),
});
export type WorkflowCopilotThreadBundle = z.infer<typeof workflowCopilotThreadBundleSchema>;

export const workflowCopilotLiveMessagePayloadSchema = z.object({
  thread: workflowCopilotThreadSchema,
  message: workflowCopilotMessageSchema,
  checkpoints: z.array(workflowCopilotCheckpointSchema).optional(),
});
export type WorkflowCopilotLiveMessagePayload = z.infer<typeof workflowCopilotLiveMessagePayloadSchema>;

export const workflowCopilotEnsureThreadSchema = z.object({
  surface: workflowCopilotSurfaceSchema,
  ownerNodeId: z.string().optional(),
  title: z.string().optional(),
  scope: workflowCopilotScopeSchema.optional(),
  mode: workflowCopilotModeSchema.optional(),
  agentType: agentTypeSchema.optional(),
  model: agentModelRefSchema.optional(),
  autoApply: z.boolean().optional(),
  autoRun: z.boolean().optional(),
  metadata: workflowCopilotThreadMetadataSchema.optional(),
});
export type WorkflowCopilotEnsureThread = z.infer<typeof workflowCopilotEnsureThreadSchema>;

export const workflowCopilotThreadPatchSchema = z.object({
  title: z.string().optional(),
  scope: workflowCopilotScopeSchema.optional(),
  mode: workflowCopilotModeSchema.optional(),
  agentType: agentTypeSchema.optional(),
  model: agentModelRefSchema.optional(),
  autoApply: z.boolean().optional(),
  autoRun: z.boolean().optional(),
  externalSessionId: z.string().optional(),
  metadata: workflowCopilotThreadMetadataSchema.optional(),
});
export type WorkflowCopilotThreadPatch = z.infer<typeof workflowCopilotThreadPatchSchema>;

export const workflowCopilotSendMessageSchema = z
  .object({
    content: z.string(),
    attachments: z.array(workflowCopilotAttachmentSchema).max(WORKFLOW_COPILOT_ATTACHMENT_MAX_COUNT).optional(),
    scope: workflowCopilotScopeSchema.optional(),
    mode: workflowCopilotModeSchema.optional(),
    agentType: agentTypeSchema.optional(),
    model: agentModelRefSchema.optional(),
    autoApply: z.boolean().optional(),
    autoRun: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const trimmed = data.content.trim();
    const ac = data.attachments?.length ?? 0;
    if (!trimmed && ac === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content or attachments required',
        path: ['content'],
      });
    }
    if (data.attachments?.length) {
      refineCopilotAttachmentPayloads(data.attachments, ctx, ['attachments']);
    }
  });
export type WorkflowCopilotSendMessage = z.infer<typeof workflowCopilotSendMessageSchema>;

export const workflowCopilotSendResultSchema = z.object({
  thread: workflowCopilotThreadSchema,
  userMessage: workflowCopilotMessageSchema,
  assistantMessage: workflowCopilotMessageSchema,
  checkpoints: z.array(workflowCopilotCheckpointSchema),
  fileSummaryNodeId: textSchema.optional(),
});
export type WorkflowCopilotSendResult = z.infer<typeof workflowCopilotSendResultSchema>;

export const workflowCopilotApplyResultSchema = z.object({
  thread: workflowCopilotThreadSchema,
  message: workflowCopilotMessageSchema,
  checkpoints: z.array(workflowCopilotCheckpointSchema),
});
export type WorkflowCopilotApplyResult = z.infer<typeof workflowCopilotApplyResultSchema>;

export const workflowCopilotRestoreResultSchema = z.object({
  thread: workflowCopilotThreadSchema,
  messages: z.array(workflowCopilotMessageSchema),
  checkpoint: workflowCopilotCheckpointSchema,
  checkpoints: z.array(workflowCopilotCheckpointSchema),
});
export type WorkflowCopilotRestoreResult = z.infer<typeof workflowCopilotRestoreResultSchema>;

export const workflowCopilotSnapshotSchema = z.object({
  threadId: textSchema,
  messageId: textSchema,
  flow: workflowTransferSchema,
});
export type WorkflowCopilotSnapshot = z.infer<typeof workflowCopilotSnapshotSchema>;
