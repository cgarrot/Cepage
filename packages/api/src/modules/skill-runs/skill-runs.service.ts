import { EventEmitter } from 'node:events';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WorkflowSkill, WorkflowSkillExecution } from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { json, nullableJson } from '../../common/database/prisma-json';
import {
  JsonSchemaValidatorService,
  type JsonSchemaValidationError,
} from '../../common/validation/json-schema-validator.service';
import { SessionFromSkillService } from '../session-from-skill/session-from-skill.service';
import { WorkflowSkillsService } from '../workflow-skills/workflow-skills.service';
import type { SessionFromSkillBodyDto } from '../session-from-skill/session-from-skill.dto';
import type {
  CreateSkillRunDto,
  SkillRunError,
  SkillRunRow,
  SkillRunStatus,
  SkillRunValidationFailure,
} from './skill-runs.dto';

// Runtime for executing a skill with typed inputs/outputs. Responsibilities:
//   1. Validate inputs against inputsSchema (ajv) — 400 with error list.
//   2. Materialize a SkillRun row with status=queued.
//   3. Execute: either scaffold a session (mode=session) or call a direct
//      handler (mode=direct, phase 3).
//   4. Collect outputs, validate against outputsSchema, persist + emit.
//   5. Stream lifecycle events (started/succeeded/failed) via an
//      EventEmitter that the SSE controller subscribes to.
//
// Idempotency: if a previous completed run has the same idempotencyKey and
// skillId, return that run instead of creating a new one.
//
// See docs/product-plan/03-typed-skill-contract.md + docs/product-plan/05-api-and-ux.md.

type DbRow = {
  id: string;
  skillId: string;
  skillVersion: string;
  skillKind: string;
  userSkillId: string | null;
  status: string;
  inputs: Prisma.JsonValue;
  outputs: Prisma.JsonValue | null;
  error: Prisma.JsonValue | null;
  sessionId: string | null;
  triggeredBy: string;
  idempotencyKey: string | null;
  correlationId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SkillRunEvent =
  | { type: 'started'; runId: string; skillId: string }
  | { type: 'progress'; runId: string; skillId: string; message: string }
  | { type: 'succeeded'; runId: string; skillId: string; outputs: unknown }
  | { type: 'failed'; runId: string; skillId: string; error: SkillRunError }
  | { type: 'cancelled'; runId: string; skillId: string };

const DEFAULT_EXECUTION: WorkflowSkillExecution = {
  mode: 'session',
  copilotFallback: true,
  autoRun: true,
};

const REAPER_INTERVAL_MS = 300_000;
const REAPER_STALE_MINUTES = 30;

@Injectable()
export class SkillRunsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SkillRunsService.name);
  readonly events = new EventEmitter();
  private reaperInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schemaValidator: JsonSchemaValidatorService,
    private readonly catalog: WorkflowSkillsService,
    private readonly fromSkill: SessionFromSkillService,
  ) {
    this.events.setMaxListeners(0);
  }

  async create(
    slug: string,
    dto: CreateSkillRunDto,
    options: { wait: boolean; timeoutMs?: number; idempotencyKey?: string } = { wait: true },
  ): Promise<SkillRunRow | SkillRunValidationFailure> {
    const skill = await this.catalog.getSkill(slug);
    const inputsSchema = skill.inputsSchema;
    const execution = skill.execution ?? DEFAULT_EXECUTION;

    const validation = inputsSchema
      ? this.schemaValidator.validate(inputsSchema, dto.inputs ?? {}, `skill:${slug}:inputs`)
      : { ok: true as const, data: dto.inputs ?? {} };

    if (!validation.ok) {
      return { code: 'INVALID_INPUT', errors: validation.errors };
    }

    const idempotencyKey = options.idempotencyKey ?? dto.idempotencyKey;

    if (idempotencyKey) {
      const existing = await this.prisma.skillRun.findFirst({
        where: {
          skillId: slug,
          skillVersion: skill.version,
          idempotencyKey,
          status: { in: ['succeeded', 'running', 'queued'] },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      if (existing) return this.serialize(existing);
    }

    const userSkillId = await this.resolveUserSkillId(slug);
    const triggeredBy = dto.triggeredBy ?? 'api';

    const createdRow = await this.prisma.skillRun.create({
      data: {
        skillId: slug,
        skillVersion: skill.version,
        skillKind: skill.source?.kind ?? 'builtin',
        userSkillId,
        status: 'queued',
        inputs: json(dto.inputs ?? {}),
        triggeredBy,
        idempotencyKey: idempotencyKey ?? null,
        correlationId: dto.correlationId ?? null,
      },
    });
    const runId = createdRow.id;

    const runTask = this.execute(runId, skill, dto, execution).catch((err) => {
      this.log.error(
        `[skill-runs ${runId}] execution crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    if (!options.wait) {
      return this.serialize(createdRow);
    }

    const timeoutMs =
      options.timeoutMs ??
      (execution.timeoutSeconds ? execution.timeoutSeconds * 1000 : 300_000);
    await Promise.race([
      runTask,
      new Promise((resolve) => setTimeout(resolve, Math.max(1_000, timeoutMs))),
    ]);
    const fresh = await this.prisma.skillRun.findUnique({ where: { id: runId } });
    if (!fresh) throw new NotFoundException('SKILL_RUN_NOT_FOUND');
    return this.serialize(fresh);
  }

  async get(runId: string): Promise<SkillRunRow> {
    const row = await this.prisma.skillRun.findUnique({ where: { id: runId } });
    if (!row) throw new NotFoundException('SKILL_RUN_NOT_FOUND');
    return this.serialize(row);
  }

  async list(options: { skillId?: string; limit?: number } = {}): Promise<SkillRunRow[]> {
    const rows = await this.prisma.skillRun.findMany({
      where: options.skillId ? { skillId: options.skillId } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Math.max(1, options.limit ?? 50), 500),
    });
    return rows.map((row) => this.serialize(row));
  }

  async cancel(runId: string): Promise<SkillRunRow> {
    const row = await this.prisma.skillRun.findUnique({ where: { id: runId } });
    if (!row) throw new NotFoundException('SKILL_RUN_NOT_FOUND');
    if (row.status !== 'queued' && row.status !== 'running') {
      throw new BadRequestException(`SKILL_RUN_NOT_CANCELLABLE:${row.status}`);
    }
    const finishedAt = new Date();
    const updated = await this.prisma.skillRun.update({
      where: { id: runId },
      data: {
        status: 'cancelled',
        finishedAt,
        durationMs: row.startedAt ? finishedAt.getTime() - row.startedAt.getTime() : null,
      },
    });
    this.emit({ type: 'cancelled', runId, skillId: row.skillId });
    return this.serialize(updated);
  }

  // ─── execution internals ────────────────────────────────────────────────

  private async execute(
    runId: string,
    skill: WorkflowSkill,
    dto: CreateSkillRunDto,
    execution: WorkflowSkillExecution,
  ): Promise<void> {
    const startedAt = new Date();
    await this.prisma.skillRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt },
    });
    this.emit({ type: 'started', runId, skillId: skill.id });

    try {
      let outputs: Record<string, unknown> = {};
      let sessionId: string | null = null;

      if (execution.mode === 'session' || !execution.mode) {
        const scaffoldBody: SessionFromSkillBodyDto = {
          name: `${skill.title} — run ${runId.slice(0, 8)}`,
          workspace: dto.workspace,
          copilot: execution.copilotFallback
            ? {
                message: this.buildCopilotMessage(skill, dto.inputs ?? {}),
                autoApply: true,
                autoRun: execution.autoRun ?? true,
                title: skill.title,
              }
            : undefined,
          autoRun: execution.autoRun ?? true,
        };
        const result = await this.fromSkill.scaffold(skill.id, scaffoldBody);
        sessionId = result.sessionId;
        outputs = {
          sessionId: result.sessionId,
          mode: result.mode,
          workspaceDir: result.workspaceDir,
          threadId: result.threadId ?? null,
          flowId: result.flowId ?? null,
          flowStatus: result.flowStatus ?? null,
        };
      } else if (execution.mode === 'direct') {
        // Direct mode is reserved for phase 3 (registered in-process
        // handlers). For now we reject rather than silently running nothing.
        throw new Error('SKILL_RUN_DIRECT_MODE_NOT_IMPLEMENTED');
      } else {
        throw new Error(`SKILL_RUN_UNSUPPORTED_MODE:${execution.mode}`);
      }

      const outputValidation = skill.outputsSchema
        ? this.schemaValidator.validate(skill.outputsSchema, outputs, `skill:${skill.id}:outputs`)
        : { ok: true as const, data: outputs };

      const finishedAt = new Date();
      if (!outputValidation.ok) {
        const error: SkillRunError = {
          code: 'OUTPUT_SCHEMA_MISMATCH',
          message: 'Workflow outputs did not match the skill outputsSchema',
          details: outputValidation.errors,
        };
        await this.prisma.skillRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            error: json(error as unknown as Record<string, unknown>),
            outputs: nullableJson(outputs),
            sessionId,
          },
        });
        this.emit({ type: 'failed', runId, skillId: skill.id, error });
        return;
      }

      await this.prisma.skillRun.update({
        where: { id: runId },
        data: {
          status: 'succeeded',
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          outputs: json(outputs),
          sessionId,
          error: Prisma.JsonNull,
        },
      });
      this.emit({ type: 'succeeded', runId, skillId: skill.id, outputs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error: SkillRunError = {
        code: 'RUN_FAILED',
        message,
      };
      const finishedAt = new Date();
      await this.prisma.skillRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          error: json(error as unknown as Record<string, unknown>),
        },
      });
      this.emit({ type: 'failed', runId, skillId: skill.id, error });
    }
  }

  private buildCopilotMessage(skill: WorkflowSkill, inputs: Record<string, unknown>): string {
    const keys = Object.keys(inputs ?? {}).sort();
    if (keys.length === 0) return `Run the skill "${skill.title}" with its default configuration.`;
    const secretKeys = this.collectSecretKeys(skill.inputsSchema);
    const lines = [
      `Run the skill "${skill.title}" with the following typed inputs:`,
      '',
      ...keys.map((k) =>
        secretKeys.has(k)
          ? `- ${k}: ${this.renderRedacted(inputs[k])}`
          : `- ${k}: ${this.renderScalar(inputs[k])}`,
      ),
    ];
    return lines.join('\n');
  }

  // Inputs marked with `writeOnly: true`, `format: "password"`, or the
  // `x-secret: true` extension are redacted from the prompt text that the
  // copilot agent sees in the session timeline. The actual run still
  // receives the raw value; only the human-readable message is masked.
  private collectSecretKeys(schema: WorkflowSkill['inputsSchema']): Set<string> {
    const out = new Set<string>();
    if (!schema || typeof schema !== 'object') return out;
    const props = (schema as { properties?: Record<string, unknown> }).properties;
    if (!props || typeof props !== 'object') return out;
    for (const [name, raw] of Object.entries(props)) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as {
        writeOnly?: unknown;
        format?: unknown;
        'x-secret'?: unknown;
      };
      if (entry.writeOnly === true) out.add(name);
      else if (entry.format === 'password') out.add(name);
      else if (entry['x-secret'] === true) out.add(name);
    }
    return out;
  }

  private renderRedacted(value: unknown): string {
    if (value == null || value === '') return '(none)';
    return '«redacted»';
  }

  private renderScalar(value: unknown): string {
    if (value == null) return '(none)';
    if (typeof value === 'string') {
      return value.length > 160 ? `${value.slice(0, 157)}...` : value;
    }
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 160 ? `${serialized.slice(0, 157)}...` : serialized;
    } catch {
      return String(value);
    }
  }

  private async resolveUserSkillId(slug: string): Promise<string | null> {
    if (!this.catalog.isUserSkill(slug)) return null;
    const row = await this.prisma.userSkill.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }

  private serialize(row: DbRow): SkillRunRow {
    return {
      id: row.id,
      skillId: row.skillId,
      skillVersion: row.skillVersion,
      skillKind: row.skillKind,
      userSkillId: row.userSkillId,
      status: (row.status as SkillRunStatus) ?? 'queued',
      inputs: (row.inputs as Record<string, unknown>) ?? {},
      outputs: (row.outputs as Record<string, unknown> | null) ?? null,
      error: (row.error as SkillRunRow['error']) ?? null,
      sessionId: row.sessionId,
      triggeredBy: row.triggeredBy,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private emit(event: SkillRunEvent): void {
    this.events.emit('event', event);
    this.events.emit(`run:${event.runId}`, event);
  }

  onModuleInit(): void {
    this.reaperInterval = setInterval(() => {
      void this.runReaper().catch((err) => {
        this.log.error(
          `[skill-runs-reaper] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, REAPER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }
  }

  private async runReaper(): Promise<void> {
    const cutoff = new Date(Date.now() - REAPER_STALE_MINUTES * 60 * 1000);
    const stale = await this.prisma.skillRun.findMany({
      where: {
        status: 'running',
        updatedAt: { lt: cutoff },
      },
    });

    if (stale.length === 0) return;

    this.log.log(`[skill-runs-reaper] marking ${stale.length} stale run(s) as failed`);

    for (const row of stale) {
      const finishedAt = new Date();
      const error: SkillRunError = {
        code: 'RUN_TIMEOUT',
        message: `Skill run timed out after ${REAPER_STALE_MINUTES} minutes of inactivity`,
      };
      await this.prisma.skillRun.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          finishedAt,
          durationMs: row.startedAt ? finishedAt.getTime() - row.startedAt.getTime() : null,
          error: json(error as unknown as Record<string, unknown>),
        },
      });
      this.emit({ type: 'failed', runId: row.id, skillId: row.skillId, error });
    }
  }
}

export type { JsonSchemaValidationError };
