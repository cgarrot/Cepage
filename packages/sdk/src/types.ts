// Public types exposed by the Cepage SDK.
//
// These mirror the OpenAPI component schemas produced by
// @cepage/api's OpenapiService (see packages/api/src/modules/openapi/).
// They are hand-rolled (rather than generated) so the SDK stays
// dependency-free at runtime and the public surface stays stable even
// if we later swap the generator.

export type SkillRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type SkillRunTrigger =
  | 'api'
  | 'ui'
  | 'cli'
  | 'mcp'
  | 'schedule'
  | 'webhook'
  | 'sdk';

export type SkillVisibility = 'private' | 'workspace' | 'public';

export type ScheduleStatus = 'active' | 'paused';

export interface WorkflowSkill {
  id: string;
  version: string;
  title: string;
  summary: string;
  kind: string;
  tags?: string[];
  category?: string | null;
  icon?: string | null;
  inputsSchema?: Record<string, unknown>;
  outputsSchema?: Record<string, unknown>;
  execution?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
}

export interface UserSkill {
  id: string;
  slug: string;
  version: string;
  title: string;
  summary: string;
  icon?: string | null;
  category?: string | null;
  tags: string[];
  inputsSchema: Record<string, unknown>;
  outputsSchema: Record<string, unknown>;
  kind: string;
  promptText?: string | null;
  sourceSessionId?: string | null;
  visibility: SkillVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRun {
  id: string;
  skillId: string;
  skillVersion?: string;
  skillKind?: string;
  userSkillId?: string | null;
  status: SkillRunStatus;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown> | null;
  error?: SkillRunError | null;
  sessionId?: string | null;
  triggeredBy?: SkillRunTrigger | string;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRunError {
  code: string;
  message: string;
  details?: unknown;
}

export interface RunSkillOptions<TInputs = Record<string, unknown>> {
  inputs: TInputs;
  triggeredBy?: SkillRunTrigger;
  idempotencyKey?: string;
  correlationId?: string;
  // Block until the run reaches a terminal state. Defaults to true.
  wait?: boolean;
  // Overall wait budget in milliseconds. Defaults to 120_000.
  timeoutMs?: number;
}

export interface ListSkillsOptions {
  kind?: string | string[];
}

export interface ListRunsOptions {
  skillId?: string;
  limit?: number;
}

export interface ScheduledSkillRun {
  id: string;
  label?: string | null;
  skillId: string;
  cron: string;
  request: {
    inputs?: Record<string, unknown>;
    triggeredBy?: SkillRunTrigger;
    correlationId?: string;
    idempotencyKey?: string;
  } & Record<string, unknown>;
  status: ScheduleStatus;
  nextRunAt: string;
  lastRunAt?: string | null;
  lastSessionId?: string | null;
  lastError?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleBody {
  label?: string;
  skillId: string;
  cron: string;
  request: ScheduledSkillRun['request'];
  status?: ScheduleStatus;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateScheduleBody {
  label?: string;
  cron?: string;
  request?: ScheduledSkillRun['request'];
  status?: ScheduleStatus;
  metadata?: Record<string, unknown> | null;
}

export interface DetectInputsResult {
  sessionId: string;
  detected: Array<{
    name: string;
    occurrences: number;
    inferredType: string;
    hint?: string;
  }>;
  inputsSchema: Record<string, unknown>;
  outputsSchema: Record<string, unknown>;
  promptText?: string | null;
}

export interface SaveAsSkillBody {
  slug?: string;
  title: string;
  summary: string;
  icon?: string;
  category?: string;
  tags?: string[];
  inputsSchema?: Record<string, unknown>;
  outputsSchema?: Record<string, unknown>;
  visibility?: SkillVisibility;
}

export interface SkillRunEvent {
  type:
    | 'snapshot'
    | 'started'
    | 'progress'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'heartbeat'
    | string;
  data: unknown;
}

export type WebhookEventName =
  | 'skill-run.started'
  | 'skill-run.succeeded'
  | 'skill-run.failed'
  | 'skill-run.cancelled'
  | 'skill-run.progress'
  | 'webhook.ping';

export interface Webhook {
  id: string;
  url: string;
  events: Array<WebhookEventName | '*' | string>;
  skillId: string | null;
  active: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookWithSecret extends Webhook {
  /**
   * Plaintext HMAC secret. The server surfaces this once on create and
   * rotate; regular list/get endpoints return Webhook (no `secret`).
   */
  secret: string;
}

export interface CreateWebhookBody {
  url: string;
  secret?: string;
  events?: Array<WebhookEventName | '*' | string>;
  skillId?: string | null;
  active?: boolean;
  description?: string;
}

export interface UpdateWebhookBody {
  url?: string;
  events?: Array<WebhookEventName | '*' | string>;
  skillId?: string | null;
  active?: boolean;
  description?: string | null;
  secretAction?: 'rotate' | 'keep';
}

export interface WebhookPingResult {
  id: string;
  status: 'delivered' | 'failed';
  httpStatus: number | null;
}

/** Envelope the server posts to subscriber URLs. */
export interface WebhookDelivery<TData = unknown> {
  id: string;
  type: WebhookEventName | string;
  createdAt: string;
  data: TData;
}
