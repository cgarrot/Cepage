import { z } from 'zod';
import {
  agentDelegationContextSchema,
  agentKernelRecallEntrySchema,
  agentModelRefSchema,
  agentPromptPartSchema,
  agentToolsetIdSchema,
  agentTypeSchema,
  wakeReasonSchema,
} from '@cepage/shared-core';

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const agentRunJobPayloadSchema = z.object({
  mode: z.enum(['graph', 'execution']),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  executionId: z.string().optional(),
  rootNodeId: z.string().min(1),
  outputNodeId: z.string().optional(),
  ownerNodeId: z.string().optional(),
  triggerNodeId: z.string().optional(),
  stepNodeId: z.string().optional(),
  type: agentTypeSchema,
  model: agentModelRefSchema.optional(),
  seedNodeIds: z.array(z.string().min(1)),
  role: z.string().min(1),
  wakeReason: wakeReasonSchema,
  startedAtIso: z.string().min(1),
  initialEventId: z.number().int().nonnegative().optional(),
  cwd: z.string().min(1),
  promptText: z.string(),
  parts: z.array(agentPromptPartSchema),
  externalSessionId: z.string().optional(),
  toolset: agentToolsetIdSchema.optional(),
  recall: z.array(agentKernelRecallEntrySchema).optional(),
  delegation: agentDelegationContextSchema.optional(),
  errorPosition: positionSchema.optional(),
  requestId: z.string().optional(),
  worktreeId: z.string().optional(),
  budgetAccountId: z.string().optional(),
});
export type AgentRunJobPayload = z.infer<typeof agentRunJobPayloadSchema>;

/**
 * Payload sent to the daemon for a workflow-copilot chat turn. The daemon runs
 * the agent stream locally (it has the agent CLI binaries) and pushes events
 * back via the standard /jobs/:id/messages endpoint, which the API drains
 * inside WorkflowCopilotService instead of spawning the agent itself.
 */
export const workflowCopilotRunJobPayloadSchema = z.object({
  sessionId: z.string().min(1),
  threadId: z.string().min(1),
  type: agentTypeSchema,
  model: agentModelRefSchema.optional(),
  // Optional: the API only knows host paths when the session has an explicit
  // workspace configured. When omitted, the daemon resolves a per-session
  // workspace under its own workspaceRoot (path.join(root, sessionId)), which
  // is guaranteed to exist on the host. We never send the API's process.cwd()
  // because that path lives inside the API container and is meaningless on the
  // daemon host.
  cwd: z.string().min(1).optional(),
  promptText: z.string(),
  parts: z.array(agentPromptPartSchema).optional(),
  externalSessionId: z.string().optional(),
  toolset: agentToolsetIdSchema.optional(),
  recall: z.array(agentKernelRecallEntrySchema).optional(),
  role: z.string().min(1),
  wakeReason: wakeReasonSchema,
  startedAtIso: z.string().min(1),
  // Optional opencode HTTP server connection. Daemon may ignore if it
  // prefers to spawn its own opencode child.
  connection: z
    .object({
      port: z.number().int().nonnegative().optional(),
      hostname: z.string().optional(),
    })
    .optional(),
});
export type WorkflowCopilotRunJobPayload = z.infer<typeof workflowCopilotRunJobPayloadSchema>;

export const flowJobPayloadSchema = z.object({
  flowId: z.string().min(1),
});
export type FlowJobPayload = z.infer<typeof flowJobPayloadSchema>;

export const controllerJobPayloadSchema = z.object({
  controllerId: z.string().min(1),
});
export type ControllerJobPayload = z.infer<typeof controllerJobPayloadSchema>;

export const runtimeJobPayloadSchema = z.object({
  sessionId: z.string().min(1),
  operation: z.enum(['start', 'stop', 'restart']),
  targetNodeId: z.string().optional(),
  runNodeId: z.string().optional(),
  approvalId: z.string().optional(),
});
export type RuntimeJobPayload = z.infer<typeof runtimeJobPayloadSchema>;

export const connectorJobPayloadSchema = z.object({
  sessionId: z.string().min(1),
  targetNodeId: z.string().min(1),
  requestId: z.string().optional(),
});
export type ConnectorJobPayload = z.infer<typeof connectorJobPayloadSchema>;

export const scheduledTriggerJobPayloadSchema = z.object({
  sessionId: z.string().min(1),
  triggerId: z.string().min(1),
});
export type ScheduledTriggerJobPayload = z.infer<typeof scheduledTriggerJobPayloadSchema>;

export const watchTriggerJobPayloadSchema = z.object({
  sessionId: z.string().min(1),
  subscriptionId: z.string().min(1),
  eventId: z.number().int().nonnegative().optional(),
});
export type WatchTriggerJobPayload = z.infer<typeof watchTriggerJobPayloadSchema>;

export const approvalResolutionJobPayloadSchema = z.object({
  sessionId: z.string().min(1),
  approvalId: z.string().min(1),
});
export type ApprovalResolutionJobPayload = z.infer<typeof approvalResolutionJobPayloadSchema>;
