import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

// DTOs for webhook subscriptions. A subscription pairs an HTTPS target
// with an optional skillId filter + list of event names it cares about.
// The service generates the shared secret server-side on create and
// reveals it exactly once so clients can persist it locally.
//
// Event names follow dot.case. We ship with:
//   - skill-run.started
//   - skill-run.succeeded
//   - skill-run.failed
//   - skill-run.cancelled
//   - skill-run.progress  (optional, low-cardinality)
// plus a meta event "webhook.ping" for connectivity testing.
//
// See docs/product-plan/06-distribution-and-integrations.md.

export const WEBHOOK_EVENT_NAMES = [
  'skill-run.started',
  'skill-run.succeeded',
  'skill-run.failed',
  'skill-run.cancelled',
  'skill-run.progress',
  'webhook.ping',
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENT_NAMES)[number];

export class CreateWebhookDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  secret?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsString()
  skillId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsString()
  skillId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(['rotate', 'keep'])
  secretAction?: 'rotate' | 'keep';
}

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  skillId: string | null;
  active: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // Secret is only surfaced on `create` and `rotate-secret`; the plain
  // list/get endpoints redact it so it never appears in logs.
  secret?: string;
}

// Envelope posted to subscriber URLs. `id` is a server-generated uuid
// that lets consumers deduplicate if they see a retry. `createdAt` is
// the ISO timestamp of the originating event, not the delivery attempt.
export interface WebhookDelivery<TData = unknown> {
  id: string;
  type: WebhookEventName | string;
  createdAt: string;
  data: TData;
}

// Row shape for a persisted delivery attempt.
export interface WebhookDeliveryAttemptRow {
  id: string;
  webhookSubscriptionId: string;
  event: string;
  payload: unknown;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  attemptedAt: string;
  succeededAt: string | null;
  createdAt: string;
  updatedAt: string;
}
