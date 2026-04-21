import { z } from 'zod';
import { agentCatalogProviderSchema, agentTypeSchema } from './agent';
import { executionJobKindSchema } from './autonomy';

export const daemonRegisterRequestSchema = z.object({
  runtimeId: z.string().min(1),
  name: z.string().optional(),
  supportedAgents: z.array(agentTypeSchema).min(1),
  version: z.string().optional(),
  // Daemon-side discovery of locally available agent providers (opencode,
  // cursor-agent, ...). Sent at register so the API can serve a real catalog
  // without spawning the agent CLI inside the (possibly containerised) API.
  catalog: z.array(agentCatalogProviderSchema).optional(),
});
export type DaemonRegisterRequest = z.infer<typeof daemonRegisterRequestSchema>;

export const daemonRegisterResponseSchema = z.object({
  runtimeId: z.string().min(1),
  pollIntervalMs: z.number().int().positive(),
  heartbeatIntervalMs: z.number().int().positive(),
});
export type DaemonRegisterResponse = z.infer<typeof daemonRegisterResponseSchema>;

export const daemonHeartbeatRequestSchema = z.object({
  activeJobId: z.string().optional(),
  load: z.record(z.string(), z.unknown()).optional(),
  // Optional refresh of the agent catalog. Daemons may resend this if the
  // local agent CLIs gain or lose providers between restarts.
  catalog: z.array(agentCatalogProviderSchema).optional(),
});
export type DaemonHeartbeatRequest = z.infer<typeof daemonHeartbeatRequestSchema>;

export const daemonHeartbeatResponseSchema = z.object({
  cancelledJobIds: z.array(z.string()),
});
export type DaemonHeartbeatResponse = z.infer<typeof daemonHeartbeatResponseSchema>;

export const daemonClaimRequestSchema = z.object({
  supportedAgents: z.array(agentTypeSchema).min(1),
});
export type DaemonClaimRequest = z.infer<typeof daemonClaimRequestSchema>;

export const daemonClaimJobSchema = z.object({
  id: z.string().min(1),
  kind: executionJobKindSchema,
  leaseToken: z.string().min(1),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type DaemonClaimJob = z.infer<typeof daemonClaimJobSchema>;

export const daemonMessageTypeSchema = z.enum([
  'session',
  'stdout',
  'stderr',
  // Reasoning / chain-of-thought stream emitted by agents that surface a
  // separate thinking channel (currently routed only to the Copilot panel).
  'thinking',
  'status',
  'snapshot',
  'artifact_manifest',
  'runtime_hint',
  'file_write',
  'spawn_request',
  'done',
  'error',
]);
export type DaemonMessageType = z.infer<typeof daemonMessageTypeSchema>;

/**
 * Daemon-to-API event message. `type` mirrors the agent-core adapter event
 * vocabulary so the API processor can fan out updates without re-running the
 * agent locally.
 */
export const daemonMessageSchema = z.object({
  eventAt: z.string().min(1),
  type: daemonMessageTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type DaemonMessage = z.infer<typeof daemonMessageSchema>;

export const daemonMessagesRequestSchema = z.object({
  leaseToken: z.string().min(1),
  messages: z.array(daemonMessageSchema).min(1),
});
export type DaemonMessagesRequest = z.infer<typeof daemonMessagesRequestSchema>;

export const daemonCompleteRequestSchema = z.object({
  leaseToken: z.string().min(1),
  result: z.record(z.string(), z.unknown()).optional(),
});
export type DaemonCompleteRequest = z.infer<typeof daemonCompleteRequestSchema>;

export const daemonFailRequestSchema = z.object({
  leaseToken: z.string().min(1),
  error: z.string().min(1),
});
export type DaemonFailRequest = z.infer<typeof daemonFailRequestSchema>;

export const daemonStartRequestSchema = z.object({
  leaseToken: z.string().min(1),
});
export type DaemonStartRequest = z.infer<typeof daemonStartRequestSchema>;

/**
 * Resolved spawn instructions for a runtime_target.  The API materializes
 * ports/templates and hands the daemon a ready-to-spawn spec so the daemon
 * never reaches into the graph by itself.
 */
export const runtimeProcessPortSchema = z.object({
  name: z.string(),
  port: z.number().int().nonnegative(),
  protocol: z.string(),
});
export type RuntimeProcessPort = z.infer<typeof runtimeProcessPortSchema>;

export const runtimeProcessSpecSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()),
  ports: z.array(runtimeProcessPortSchema).default([]),
  readinessUrl: z.string().optional(),
});
export type RuntimeProcessSpec = z.infer<typeof runtimeProcessSpecSchema>;

/**
 * Response payload returned from POST /api/v1/daemon/jobs/:id/start.  Shape
 * varies per job kind so the daemon knows how to drive the rest of the
 * lifecycle locally.
 */
export const daemonJobStartResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent_run') }),
  z.object({ kind: z.literal('workflow_copilot_run') }),
  z.object({
    kind: z.literal('runtime_start'),
    runNodeId: z.string().min(1),
    spec: runtimeProcessSpecSchema.optional(),
    plannedReason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('runtime_stop'),
    runNodeId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('runtime_restart'),
    runNodeId: z.string().min(1),
  }),
]);
export type DaemonJobStartResponse = z.infer<typeof daemonJobStartResponseSchema>;
