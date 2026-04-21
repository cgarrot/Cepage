import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { getEnv } from '@cepage/config';
import { PrismaService } from '../../common/database/prisma.service';
import { json, nullableJson } from '../../common/database/prisma-json';
import {
  isValidScheduleSpec,
  nextScheduledRun,
} from '../../common/utils/cron-schedule.util';
import { WorkflowSkillsService } from '../workflow-skills/workflow-skills.service';
import { SessionFromSkillService } from '../session-from-skill/session-from-skill.service';
import type { SessionFromSkillBodyDto } from '../session-from-skill/session-from-skill.dto';
import {
  type CreateScheduledSkillRunDto,
  type ScheduledSkillRunRow,
  type UpdateScheduledSkillRunDto,
} from './scheduled-skill-runs.dto';

// Generic recurring skill scheduler.
//
// CRUD over a small Prisma table (`ScheduledSkillRun`) where each row
// describes a (skillId, cron, request) tuple. A self-managed timer ticks
// at EXECUTION_SCHEDULER_MS and fires due rows by delegating to
// SessionFromSkillService — meaning every cron job ultimately produces a
// fresh session whose graph is bootstrapped from a catalog skill.
//
// Reusable across any workflow: the service is agnostic to specific
// skill domains (image generation, video publishing, messaging, etc.).

type DbRow = {
  id: string;
  label: string | null;
  skillId: string;
  cron: string;
  request: unknown;
  status: string;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastSessionId: string | null;
  lastError: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ScheduledSkillRunsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ScheduledSkillRunsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: WorkflowSkillsService,
    private readonly fromSkill: SessionFromSkillService,
  ) {}

  onModuleInit(): void {
    if (getEnv().EXECUTION_WORKER_MODE === 'off') {
      return;
    }
    const intervalMs = getEnv().EXECUTION_SCHEDULER_MS;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.log.warn(
          `[scheduled-skill-runs] tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ─── CRUD ────────────────────────────────────────────────────────────

  async create(input: CreateScheduledSkillRunDto): Promise<ScheduledSkillRunRow> {
    await this.assertSkillExists(input.skillId);
    if (!isValidScheduleSpec(input.cron)) {
      throw new BadRequestException(`SCHEDULED_SKILL_RUN_INVALID_CRON:${input.cron}`);
    }
    const now = new Date();
    const nextRunAt = nextScheduledRun(input.cron, now, null);
    const created = await this.prisma.scheduledSkillRun.create({
      data: {
        skillId: input.skillId,
        cron: input.cron,
        label: input.label ?? null,
        request: json((input.request ?? {}) as Record<string, unknown>),
        status: nextRunAt ? 'active' : 'paused',
        nextRunAt: nextRunAt ?? now,
        metadata: nullableJson(input.metadata),
      },
    });
    return this.serialize(created);
  }

  async list(): Promise<ScheduledSkillRunRow[]> {
    const rows = await this.prisma.scheduledSkillRun.findMany({
      orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(id: string): Promise<ScheduledSkillRunRow> {
    const row = await this.prisma.scheduledSkillRun.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('SCHEDULED_SKILL_RUN_NOT_FOUND');
    return this.serialize(row);
  }

  async update(id: string, patch: UpdateScheduledSkillRunDto): Promise<ScheduledSkillRunRow> {
    const current = await this.prisma.scheduledSkillRun.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('SCHEDULED_SKILL_RUN_NOT_FOUND');

    if (patch.cron !== undefined && !isValidScheduleSpec(patch.cron)) {
      throw new BadRequestException(`SCHEDULED_SKILL_RUN_INVALID_CRON:${patch.cron}`);
    }

    const cron = patch.cron ?? current.cron;
    const now = new Date();
    const baselineLast = patch.resetSchedule ? null : current.lastRunAt;
    const nextRunAt = patch.cron !== undefined || patch.resetSchedule || patch.status === 'active'
      ? nextScheduledRun(cron, now, baselineLast)
      : current.nextRunAt;
    const status = patch.status ?? (nextRunAt ? current.status : 'paused');

    const updated = await this.prisma.scheduledSkillRun.update({
      where: { id },
      data: {
        cron,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.request !== undefined
          ? { request: json(patch.request as unknown as Record<string, unknown>) }
          : {}),
        ...(patch.metadata !== undefined ? { metadata: nullableJson(patch.metadata) } : {}),
        status,
        nextRunAt: nextRunAt ?? now,
      },
    });
    return this.serialize(updated);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    try {
      await this.prisma.scheduledSkillRun.delete({ where: { id } });
    } catch {
      throw new NotFoundException('SCHEDULED_SKILL_RUN_NOT_FOUND');
    }
    return { deleted: true as const };
  }

  // ─── Tick + execute ─────────────────────────────────────────────────

  async tick(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.scheduledSkillRun.findMany({
      where: { status: 'active', nextRunAt: { lte: now } },
      orderBy: [{ nextRunAt: 'asc' }],
      take: 8,
    });
    for (const row of due) {
      const reservedNext = nextScheduledRun(row.cron, now, now);
      await this.prisma.scheduledSkillRun.update({
        where: { id: row.id },
        data: {
          lastRunAt: now,
          status: reservedNext ? 'active' : 'paused',
          nextRunAt: reservedNext ?? now,
        },
      });
      void this.executeOne(row.id).catch((err) => {
        this.log.warn(
          `[scheduled-skill-runs ${row.id}] execution crashed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  async runNow(id: string): Promise<ScheduledSkillRunRow> {
    await this.executeOne(id);
    return this.get(id);
  }

  async executeOne(id: string): Promise<void> {
    const row = await this.prisma.scheduledSkillRun.findUnique({ where: { id } });
    if (!row) return;
    const request = (row.request ?? {}) as SessionFromSkillBodyDto;
    const startedAt = new Date();
    try {
      const result = await this.fromSkill.scaffold(row.skillId, request);
      await this.prisma.scheduledSkillRun.update({
        where: { id: row.id },
        data: {
          lastRunAt: startedAt,
          lastSessionId: result.sessionId,
          lastError: null,
        },
      });
      this.log.log(
        `[scheduled-skill-runs ${row.id}] skill=${row.skillId} session=${result.sessionId} mode=${result.mode}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.scheduledSkillRun.update({
        where: { id: row.id },
        data: { lastRunAt: startedAt, lastError: message, status: 'paused' },
      });
      this.log.error(`[scheduled-skill-runs ${row.id}] failed: ${message}`);
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private async assertSkillExists(skillId: string): Promise<void> {
    await this.skills.getSkill(skillId);
  }

  private serialize(row: DbRow): ScheduledSkillRunRow {
    return {
      id: row.id,
      label: row.label ?? null,
      skillId: row.skillId,
      cron: row.cron,
      request: (row.request ?? {}) as SessionFromSkillBodyDto,
      status: (row.status as ScheduledSkillRunRow['status']) ?? 'active',
      nextRunAt: row.nextRunAt.toISOString(),
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      lastSessionId: row.lastSessionId,
      lastError: row.lastError,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
