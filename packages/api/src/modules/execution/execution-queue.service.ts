import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ExecutionJobKind, ExecutionJobStatus, WakeReason } from '@cepage/shared-core';
import { getEnv } from '@cepage/config';
import { PrismaService } from '../../common/database/prisma.service';
import { json, nullableJson } from '../../common/database/prisma-json';

type EnsureJobInput = {
  key: string;
  kind: ExecutionJobKind;
  ownerKind: string;
  ownerId: string;
  payload: Record<string, unknown>;
  sessionId?: string;
  runId?: string;
  executionId?: string;
  requestId?: string;
  wakeReason?: WakeReason;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
};

type QueueJob = Awaited<ReturnType<ExecutionQueueService['ensureJob']>>;

function isActive(status: string): boolean {
  return status === 'queued' || status === 'running';
}

@Injectable()
export class ExecutionQueueService {
  constructor(private readonly prisma: PrismaService) {}

  private leaseMs(): number {
    return getEnv().EXECUTION_JOB_LEASE_MS;
  }

  private nextLease(): Date {
    return new Date(Date.now() + this.leaseMs());
  }

  private canReuse(row: {
    status: string;
    leaseExpiresAt: Date | null;
  }): boolean {
    if (!isActive(row.status)) return false;
    if (row.status === 'queued') return true;
    return Boolean(row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now());
  }

  async ensureJob(input: EnsureJobInput) {
    const existing = await this.prisma.executionJob.findUnique({
      where: { key: input.key },
    });
    if (existing && this.canReuse(existing)) {
      return existing;
    }
    if (existing) {
      return this.prisma.executionJob.update({
        where: { id: existing.id },
        data: {
          kind: input.kind,
          ownerKind: input.ownerKind,
          ownerId: input.ownerId,
          sessionId: input.sessionId ?? null,
          runId: input.runId ?? null,
          executionId: input.executionId ?? null,
          requestId: input.requestId ?? null,
          wakeReason: input.wakeReason ?? null,
          status: 'queued',
          payload: json(input.payload),
          error: null,
          result: undefined,
          workerId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          priority: input.priority ?? existing.priority,
          maxAttempts: input.maxAttempts ?? existing.maxAttempts,
          availableAt: input.availableAt ?? new Date(),
          startedAt: null,
          finishedAt: null,
        },
      });
    }
    return this.prisma.executionJob.create({
      data: {
        key: input.key,
        kind: input.kind,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        sessionId: input.sessionId,
        runId: input.runId,
        executionId: input.executionId,
        requestId: input.requestId,
        wakeReason: input.wakeReason,
        status: 'queued',
        payload: json(input.payload),
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 8,
        availableAt: input.availableAt ?? new Date(),
      },
    });
  }

  async findByKey(key: string) {
    return this.prisma.executionJob.findUnique({ where: { key } });
  }

  async findById(id: string) {
    return this.prisma.executionJob.findUnique({ where: { id } });
  }

  async claimNextJob(
    workerId: string,
    filter?: { includeKinds?: ExecutionJobKind[]; excludeKinds?: ExecutionJobKind[] },
  ): Promise<QueueJob | null> {
    await this.reclaimExpiredJobs();
    const now = new Date();
    const kindFilter: Record<string, unknown> = {};
    if (filter?.includeKinds && filter.includeKinds.length > 0) {
      kindFilter.in = filter.includeKinds;
    }
    if (filter?.excludeKinds && filter.excludeKinds.length > 0) {
      kindFilter.notIn = filter.excludeKinds;
    }
    const rows = await this.prisma.executionJob.findMany({
      where: {
        status: 'queued',
        availableAt: { lte: now },
        ...(Object.keys(kindFilter).length > 0 ? { kind: kindFilter } : {}),
      },
      orderBy: [
        { priority: 'desc' },
        { updatedAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 8,
    });
    for (const row of rows) {
      const leaseToken = randomUUID();
      const claimed = await this.prisma.executionJob.updateMany({
        where: {
          id: row.id,
          status: 'queued',
        },
        data: {
          status: 'running',
          workerId,
          leaseToken,
          leaseExpiresAt: this.nextLease(),
          startedAt: row.startedAt ?? now,
          finishedAt: null,
          attempts: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        continue;
      }
      const next = await this.prisma.executionJob.findUnique({ where: { id: row.id } });
      if (next) {
        return next;
      }
    }
    return null;
  }

  async heartbeatJob(jobId: string, leaseToken: string): Promise<boolean> {
    const updated = await this.prisma.executionJob.updateMany({
      where: {
        id: jobId,
        status: 'running',
        leaseToken,
      },
      data: {
        leaseExpiresAt: this.nextLease(),
      },
    });
    return updated.count > 0;
  }

  /**
   * Refresh a job lease using the worker identity instead of the leaseToken.
   * Used by the daemon heartbeat path: the daemon publishes its `activeJobId`
   * every few seconds and we want to extend the lease as long as the worker
   * still claims to own the job. Auth is by `workerId == runtimeId`, which is
   * already enforced upstream when the daemon authenticates against the API.
   */
  async heartbeatJobByWorker(jobId: string, workerId: string): Promise<boolean> {
    const updated = await this.prisma.executionJob.updateMany({
      where: {
        id: jobId,
        status: 'running',
        workerId,
      },
      data: {
        leaseExpiresAt: this.nextLease(),
      },
    });
    return updated.count > 0;
  }

  async completeJob(jobId: string, leaseToken: string, result?: Record<string, unknown>): Promise<void> {
    await this.prisma.executionJob.updateMany({
      where: {
        id: jobId,
        status: 'running',
        leaseToken,
      },
      data: {
        status: 'completed',
        result: nullableJson(result),
        error: null,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    });
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.prisma.executionJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    });
  }

  async failJob(job: { id: string; attempts: number; maxAttempts: number }, leaseToken: string, error: string): Promise<ExecutionJobStatus> {
    const retryable = job.attempts < job.maxAttempts;
    const status: ExecutionJobStatus = retryable ? 'queued' : 'failed';
    await this.prisma.executionJob.updateMany({
      where: {
        id: job.id,
        status: 'running',
        leaseToken,
      },
      data: {
        status,
        error,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: retryable ? new Date(Date.now() + Math.min(15_000, 500 * (job.attempts + 1))) : undefined,
        finishedAt: retryable ? null : new Date(),
      },
    });
    return status;
  }

  async reclaimExpiredJobs(): Promise<number> {
    const result = await this.prisma.executionJob.updateMany({
      where: {
        status: 'running',
        leaseExpiresAt: { lt: new Date() },
      },
      data: {
        status: 'queued',
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: new Date(),
      },
    });
    return result.count;
  }

  async listActiveJobs() {
    return this.prisma.executionJob.findMany({
      where: {
        status: {
          in: ['queued', 'running'],
        },
      },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    });
  }
}
