import { z } from 'zod';
import { wakeReasonSchema } from './graph';

const textSchema = z.string().min(1);
const isoDateSchema = z.string().min(1);

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export const executionJobKindSchema = z.enum([
  'agent_run',
  'workflow_controller',
  'workflow_managed_flow',
  'connector_run',
  'runtime_start',
  'runtime_stop',
  'runtime_restart',
  'scheduled_trigger',
  'watch_trigger',
  'approval_resolution',
  // Workflow copilot chat turn delegated to the native daemon. The API
  // enqueues this job and drains agent-core events streamed back via
  // POST /daemon/:runtimeId/jobs/:jobId/messages, so the API container
  // does not need any agent CLI binary itself.
  'workflow_copilot_run',
]);
export type ExecutionJobKind = z.infer<typeof executionJobKindSchema>;

export const executionJobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type ExecutionJobStatus = z.infer<typeof executionJobStatusSchema>;

export const executionJobSchema = z.object({
  id: textSchema,
  key: textSchema,
  kind: executionJobKindSchema,
  status: executionJobStatusSchema,
  ownerKind: textSchema,
  ownerId: textSchema,
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  executionId: z.string().optional(),
  requestId: z.string().optional(),
  wakeReason: wakeReasonSchema.optional(),
  workerId: z.string().optional(),
  priority: z.number().int().default(0),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(8),
  payload: z.record(z.string(), z.unknown()).default({}),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  leaseToken: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
  availableAt: isoDateSchema,
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type ExecutionJob = z.infer<typeof executionJobSchema>;

export function readExecutionJob(value: unknown): ExecutionJob | null {
  const parsed = executionJobSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const workerNodeKindSchema = z.enum(['api', 'embedded', 'execution_worker', 'daemon']);
export type WorkerNodeKind = z.infer<typeof workerNodeKindSchema>;

export const workerNodeStatusSchema = z.enum(['starting', 'running', 'stopped', 'lost']);
export type WorkerNodeStatus = z.infer<typeof workerNodeStatusSchema>;

export const workerNodeSchema = z.object({
  id: textSchema,
  kind: workerNodeKindSchema,
  status: workerNodeStatusSchema,
  host: z.string().optional(),
  pid: z.number().int().optional(),
  startedAt: isoDateSchema,
  lastSeenAt: isoDateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type WorkerNode = z.infer<typeof workerNodeSchema>;

export function readWorkerNode(value: unknown): WorkerNode | null {
  const parsed = workerNodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const workerHeartbeatSchema = z.object({
  id: textSchema,
  workerId: textSchema,
  recordedAt: isoDateSchema,
  activeJobId: z.string().optional(),
  load: z.record(z.string(), z.unknown()).optional(),
});
export type WorkerHeartbeat = z.infer<typeof workerHeartbeatSchema>;

export function readWorkerHeartbeat(value: unknown): WorkerHeartbeat | null {
  const parsed = workerHeartbeatSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const executionLeaseStatusSchema = z.enum(['active', 'released', 'expired', 'conflicted']);
export type ExecutionLeaseStatus = z.infer<typeof executionLeaseStatusSchema>;

export const executionLeaseSchema = z.object({
  id: textSchema,
  sessionId: z.string().optional(),
  resourceKind: textSchema,
  resourceKey: textSchema,
  scopeKey: z.string().optional(),
  holderKind: textSchema,
  holderId: textSchema,
  workerId: z.string().optional(),
  runId: z.string().optional(),
  executionId: z.string().optional(),
  requestId: z.string().optional(),
  status: executionLeaseStatusSchema,
  leaseToken: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  releasedAt: z.string().optional(),
});
export type ExecutionLease = z.infer<typeof executionLeaseSchema>;

export function readExecutionLease(value: unknown): ExecutionLease | null {
  const parsed = executionLeaseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const approvalRiskSchema = z.enum(['low', 'medium', 'high']);
export type ApprovalRisk = z.infer<typeof approvalRiskSchema>;

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRequestSchema = z.object({
  id: textSchema,
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  executionId: z.string().optional(),
  requestId: z.string().optional(),
  kind: textSchema,
  status: approvalStatusSchema,
  title: textSchema,
  detail: z.string().optional(),
  risk: approvalRiskSchema.default('medium'),
  payload: z.record(z.string(), z.unknown()).default({}),
  resolution: z.record(z.string(), z.unknown()).optional(),
  requestedByType: textSchema,
  requestedById: textSchema,
  resolvedByType: z.string().optional(),
  resolvedById: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  resolvedAt: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export function readApprovalRequest(value: unknown): ApprovalRequest | null {
  const parsed = approvalRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const budgetAccountStatusSchema = z.enum(['active', 'paused', 'exhausted']);
export type BudgetAccountStatus = z.infer<typeof budgetAccountStatusSchema>;

export const budgetAccountSchema = z.object({
  id: textSchema,
  sessionId: z.string().optional(),
  scopeKind: textSchema,
  scopeId: textSchema,
  status: budgetAccountStatusSchema,
  unit: z.string().default('points'),
  limit: z.number().int().nonnegative().optional(),
  used: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type BudgetAccount = z.infer<typeof budgetAccountSchema>;

export function readBudgetAccount(value: unknown): BudgetAccount | null {
  const parsed = budgetAccountSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const worktreeAllocationStatusSchema = z.enum(['planned', 'active', 'released', 'failed']);
export type WorktreeAllocationStatus = z.infer<typeof worktreeAllocationStatusSchema>;

export const worktreeAllocationSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  runId: z.string().optional(),
  executionId: z.string().optional(),
  leaseId: z.string().optional(),
  status: worktreeAllocationStatusSchema,
  rootPath: textSchema,
  branchName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  releasedAt: z.string().optional(),
});
export type WorktreeAllocation = z.infer<typeof worktreeAllocationSchema>;

export function readWorktreeAllocation(value: unknown): WorktreeAllocation | null {
  const parsed = worktreeAllocationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const scheduledTriggerStatusSchema = z.enum(['active', 'paused', 'failed']);
export type ScheduledTriggerStatus = z.infer<typeof scheduledTriggerStatusSchema>;

export const scheduledTriggerSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  ownerNodeId: textSchema,
  label: z.string().optional(),
  cron: textSchema,
  status: scheduledTriggerStatusSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  nextRunAt: isoDateSchema,
  lastRunAt: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type ScheduledTrigger = z.infer<typeof scheduledTriggerSchema>;

export function readScheduledTrigger(value: unknown): ScheduledTrigger | null {
  const parsed = scheduledTriggerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const watchSubscriptionKindSchema = z.enum([
  'graph_node',
  'graph_branch',
  'workspace_path',
  'runtime_target',
]);
export type WatchSubscriptionKind = z.infer<typeof watchSubscriptionKindSchema>;

export const watchSubscriptionStatusSchema = z.enum(['active', 'paused', 'failed']);
export type WatchSubscriptionStatus = z.infer<typeof watchSubscriptionStatusSchema>;

export const watchSubscriptionSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  ownerNodeId: z.string().optional(),
  kind: watchSubscriptionKindSchema,
  target: textSchema,
  status: watchSubscriptionStatusSchema,
  cursor: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  lastEventAt: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type WatchSubscription = z.infer<typeof watchSubscriptionSchema>;

export function readWatchSubscription(value: unknown): WatchSubscription | null {
  const parsed = watchSubscriptionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const evaluationOutcomeSchema = z.enum([
  'pass',
  'fail',
  'retry',
  'block',
  'request_human',
  'integrate',
  'rework',
]);
export type EvaluationOutcome = z.infer<typeof evaluationOutcomeSchema>;

export const evaluationReportSchema = z.object({
  id: textSchema,
  sessionId: textSchema,
  runId: z.string().optional(),
  executionId: z.string().optional(),
  flowId: z.string().optional(),
  phaseId: z.string().optional(),
  nodeId: z.string().optional(),
  kind: textSchema,
  outcome: evaluationOutcomeSchema,
  summary: textSchema,
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

export function readEvaluationReport(value: unknown): EvaluationReport | null {
  const parsed = evaluationReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const systemTriggerKindSchema = z.enum(['scheduled', 'graph_change', 'external_event', 'watch']);
export type SystemTriggerKind = z.infer<typeof systemTriggerKindSchema>;

export const systemTriggerContentSchema = z.object({
  triggerKind: systemTriggerKindSchema,
  label: z.string().optional(),
  detail: z.string().optional(),
  schedule: z.string().optional(),
  nextRunAt: z.string().optional(),
  sourceNodeId: z.string().optional(),
  targetNodeId: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type SystemTriggerContent = z.infer<typeof systemTriggerContentSchema>;

export function readSystemTriggerContent(value: unknown): SystemTriggerContent | null {
  const parsed = systemTriggerContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeSystemTriggerContent(value: unknown): string {
  const content = readSystemTriggerContent(value);
  if (!content) return '';
  const lines = [content.label ?? `trigger · ${content.triggerKind}`];
  if (content.schedule?.trim()) lines.push(`schedule: ${content.schedule.trim()}`);
  if (content.nextRunAt?.trim()) lines.push(`next: ${content.nextRunAt.trim()}`);
  if (content.detail?.trim()) lines.push(content.detail.trim());
  return lines.join('\n');
}

export const approvalRequestContentSchema = z.object({
  requestId: textSchema,
  kind: textSchema,
  status: approvalStatusSchema.default('pending'),
  title: textSchema,
  detail: z.string().optional(),
  risk: approvalRiskSchema.default('medium'),
});
export type ApprovalRequestContent = z.infer<typeof approvalRequestContentSchema>;

export function readApprovalRequestContent(value: unknown): ApprovalRequestContent | null {
  const parsed = approvalRequestContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeApprovalRequestContent(value: unknown): string {
  const content = readApprovalRequestContent(value);
  if (!content) return '';
  const lines = [`approval · ${content.status}`, content.title];
  if (content.detail?.trim()) lines.push(content.detail.trim());
  lines.push(`risk: ${content.risk}`);
  return lines.join('\n');
}

export const approvalResolutionContentSchema = z.object({
  requestId: textSchema,
  status: approvalStatusSchema,
  summary: textSchema,
  resolvedBy: z.string().optional(),
});
export type ApprovalResolutionContent = z.infer<typeof approvalResolutionContentSchema>;

export function readApprovalResolutionContent(value: unknown): ApprovalResolutionContent | null {
  const parsed = approvalResolutionContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeApprovalResolutionContent(value: unknown): string {
  const content = readApprovalResolutionContent(value);
  if (!content) return '';
  const lines = [`approval resolution · ${content.status}`, content.summary];
  if (content.resolvedBy?.trim()) lines.push(`by: ${content.resolvedBy.trim()}`);
  return lines.join('\n');
}

export const workerEventKindSchema = z.enum([
  'registered',
  'heartbeat',
  'claimed',
  'completed',
  'failed',
  'lost',
]);
export type WorkerEventKind = z.infer<typeof workerEventKindSchema>;

export const workerEventContentSchema = z.object({
  workerId: textSchema,
  kind: workerEventKindSchema,
  detail: z.string().optional(),
  jobId: z.string().optional(),
  requestId: z.string().optional(),
});
export type WorkerEventContent = z.infer<typeof workerEventContentSchema>;

export function readWorkerEventContent(value: unknown): WorkerEventContent | null {
  const parsed = workerEventContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeWorkerEventContent(value: unknown): string {
  const content = readWorkerEventContent(value);
  if (!content) return '';
  const lines = [`worker · ${content.kind}`, content.workerId];
  if (content.jobId?.trim()) lines.push(`job: ${content.jobId.trim()}`);
  if (content.detail?.trim()) lines.push(content.detail.trim());
  return lines.join('\n');
}

export const leaseConflictContentSchema = z.object({
  resourceKind: textSchema,
  resourceKey: textSchema,
  holderId: z.string().optional(),
  requestedBy: z.string().optional(),
  detail: z.string().optional(),
});
export type LeaseConflictContent = z.infer<typeof leaseConflictContentSchema>;

export function readLeaseConflictContent(value: unknown): LeaseConflictContent | null {
  const parsed = leaseConflictContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeLeaseConflictContent(value: unknown): string {
  const content = readLeaseConflictContent(value);
  if (!content) return '';
  const lines = [`lease conflict · ${content.resourceKind}`, content.resourceKey];
  if (content.holderId?.trim()) lines.push(`holder: ${content.holderId.trim()}`);
  if (content.requestedBy?.trim()) lines.push(`requested by: ${content.requestedBy.trim()}`);
  if (content.detail?.trim()) lines.push(content.detail.trim());
  return lines.join('\n');
}

export const budgetAlertLevelSchema = z.enum(['info', 'warning', 'critical']);
export type BudgetAlertLevel = z.infer<typeof budgetAlertLevelSchema>;

export const budgetAlertContentSchema = z.object({
  accountId: textSchema,
  scope: textSchema,
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  level: budgetAlertLevelSchema.default('warning'),
  detail: z.string().optional(),
});
export type BudgetAlertContent = z.infer<typeof budgetAlertContentSchema>;

export function readBudgetAlertContent(value: unknown): BudgetAlertContent | null {
  const parsed = budgetAlertContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeBudgetAlertContent(value: unknown): string {
  const content = readBudgetAlertContent(value);
  if (!content) return '';
  const lines = [`budget · ${content.level}`, `${content.scope} ${content.used}/${content.limit}`];
  if (content.detail?.trim()) lines.push(content.detail.trim());
  return lines.join('\n');
}

export function readTimelineMetadata(value: unknown): {
  requestId?: string;
  workerId?: string;
  worktreeId?: string;
  wakeReason?: string;
} {
  const record = readRecord(value);
  return {
    requestId: readString(record?.requestId)?.trim() || undefined,
    workerId: readString(record?.workerId)?.trim() || undefined,
    worktreeId: readString(record?.worktreeId)?.trim() || undefined,
    wakeReason: readString(record?.wakeReason)?.trim() || undefined,
  };
}

export function formatBudgetUsage(value: unknown): string {
  const used = readNumber(readRecord(value)?.used);
  const limit = readNumber(readRecord(value)?.limit);
  if (used == null || limit == null) return '';
  return `${used}/${limit}`;
}
