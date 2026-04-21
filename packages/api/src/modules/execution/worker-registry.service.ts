import { hostname } from 'node:os';
import { Injectable } from '@nestjs/common';
import type { WorkerNodeKind } from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { nullableJson } from '../../common/database/prisma-json';

const ACTIVE_WORKER_WINDOW_MS = 30_000;

@Injectable()
export class WorkerRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async registerWorker(input: {
    workerId: string;
    kind: WorkerNodeKind;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.workerNode.upsert({
      where: { id: input.workerId },
      update: {
        kind: input.kind,
        status: 'running',
        host: hostname(),
        pid: process.pid,
        metadata: nullableJson(input.metadata),
        lastSeenAt: new Date(),
      },
      create: {
        id: input.workerId,
        kind: input.kind,
        status: 'running',
        host: hostname(),
        pid: process.pid,
        metadata: nullableJson(input.metadata),
      },
    });
  }

  async heartbeat(input: {
    workerId: string;
    activeJobId?: string;
    load?: Record<string, unknown>;
    /**
     * Partial metadata merge applied to the existing `WorkerNode.metadata`
     * JSON. Used by the daemon protocol to refresh long-lived, non-heartbeat
     * data (e.g. agent catalog) without forcing the daemon to re-send every
     * field at every heartbeat.
     */
    metadataPatch?: Record<string, unknown>;
  }): Promise<void> {
    const data: Record<string, unknown> = {
      status: 'running',
      host: hostname(),
      pid: process.pid,
      lastSeenAt: new Date(),
    };
    if (input.metadataPatch) {
      const existing = await this.prisma.workerNode.findUnique({
        where: { id: input.workerId },
        select: { metadata: true },
      });
      const base =
        existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      data.metadata = nullableJson({ ...base, ...input.metadataPatch });
    }
    await this.prisma.workerNode.updateMany({
      where: { id: input.workerId },
      data,
    });
    await this.prisma.workerHeartbeat.create({
      data: {
        workerId: input.workerId,
        activeJobId: input.activeJobId,
        load: nullableJson(input.load),
      },
    });
  }

  async markStopped(workerId: string): Promise<void> {
    await this.prisma.workerNode.updateMany({
      where: { id: workerId },
      data: {
        status: 'stopped',
        lastSeenAt: new Date(),
      },
    });
  }

  async hasRunningWorkerKind(kind: WorkerNodeKind, excludeWorkerId?: string): Promise<boolean> {
    const count = await this.prisma.workerNode.count({
      where: {
        kind,
        status: 'running',
        lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WORKER_WINDOW_MS) },
        ...(excludeWorkerId ? { id: { not: excludeWorkerId } } : {}),
      },
    });
    return count > 0;
  }

  async summarizeRunningWorkers(kind: WorkerNodeKind): Promise<{
    online: boolean;
    count: number;
    lastSeenAt: Date | null;
    runtimes: Array<{
      id: string;
      lastSeenAt: Date;
      host: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  }> {
    const cutoff = new Date(Date.now() - ACTIVE_WORKER_WINDOW_MS);
    const rows = await this.prisma.workerNode.findMany({
      where: {
        kind,
        status: 'running',
        lastSeenAt: { gte: cutoff },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, lastSeenAt: true, host: true, metadata: true },
    });
    return {
      online: rows.length > 0,
      count: rows.length,
      lastSeenAt: rows[0]?.lastSeenAt ?? null,
      runtimes: rows.map((row) => ({
        id: row.id,
        lastSeenAt: row.lastSeenAt,
        host: row.host,
        metadata:
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : null,
      })),
    };
  }

  async markLostWorkers(): Promise<number> {
    const result = await this.prisma.workerNode.updateMany({
      where: {
        status: 'running',
        lastSeenAt: { lt: new Date(Date.now() - ACTIVE_WORKER_WINDOW_MS) },
      },
      data: { status: 'lost' },
    });
    return result.count;
  }

  async listWorkers() {
    return this.prisma.workerNode.findMany({
      orderBy: [{ lastSeenAt: 'desc' }, { startedAt: 'desc' }],
    });
  }
}
