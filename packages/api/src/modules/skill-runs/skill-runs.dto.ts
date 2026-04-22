import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { JsonSchemaValidationError } from '../../common/validation/json-schema-validator.service';

// Body for POST /api/v1/skills/:slug/runs. `inputs` is validated against
// the skill's `inputsSchema` (via ajv) before a run row is created.
//
// The endpoint supports two execution modes:
//   - `wait=true` (default): block until the run finishes, return inline.
//   - `wait=false`: return {runId, status} immediately and stream updates
//     via GET /api/v1/skill-runs/:runId or SSE /stream.

export class CreateSkillRunDto {
  @IsObject()
  inputs!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsIn(['api', 'ui', 'cli', 'mcp', 'schedule', 'webhook', 'sdk'])
  triggeredBy?: 'api' | 'ui' | 'cli' | 'mcp' | 'schedule' | 'webhook' | 'sdk';

  @IsOptional()
  @IsObject()
  workspace?: {
    parentDirectory?: string;
    directoryName?: string;
  };
}

export type SkillRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type SkillRunError = {
  code: string;
  message: string;
  details?: unknown;
};

export type SkillRunRow = {
  id: string;
  skillId: string;
  skillVersion: string;
  skillKind: string;
  userSkillId: string | null;
  status: SkillRunStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  error: SkillRunError | null;
  sessionId: string | null;
  triggeredBy: string;
  idempotencyKey: string | null;
  correlationId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillRunValidationFailure = {
  code: 'INVALID_INPUT' | 'OUTPUT_SCHEMA_MISMATCH';
  errors: JsonSchemaValidationError[];
};
