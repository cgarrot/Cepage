import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../../common/database/prisma.service';

type AcquireLeaseInput = {
  sessionId?: string;
  resourceKind: string;
  resourceKey: string;
  scopeKey?: string;
  holderKind: string;
  holderId: string;
  workerId?: string;
  runId?: string;
  executionId?: string;
  requestId?: string;
  ttlMs?: number;
  sourceNodeId?: string;
};

@Injectable()
export class LeaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
  ) {}

  async acquire(input: AcquireLeaseInput): Promise<
    | { ok: true; leaseId: string; expiresAt: Date }
    | { ok: false; leaseId: string; holderId: string }
  > {
    const now = Date.now();
    const expiresAt = new Date(now + (input.ttlMs ?? 30_000));
    const active = await this.prisma.executionLease.findFirst({
      where: {
        resourceKind: input.resourceKind,
        resourceKey: input.resourceKey,
        status: 'active',
        expiresAt: { gt: new Date(now) },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    if (active && active.holderId !== input.holderId) {
      await this.emitConflict(input, active.holderId);
      return { ok: false, leaseId: active.id, holderId: active.holderId };
    }
    if (active) {
      const lease = await this.prisma.executionLease.update({
        where: { id: active.id },
        data: {
          scopeKey: input.scopeKey,
          workerId: input.workerId ?? null,
          runId: input.runId ?? null,
          executionId: input.executionId ?? null,
          requestId: input.requestId ?? null,
          leaseToken: randomUUID(),
          expiresAt,
        },
      });
      return { ok: true, leaseId: lease.id, expiresAt: lease.expiresAt };
    }
    const lease = await this.prisma.executionLease.create({
      data: {
        sessionId: input.sessionId,
        resourceKind: input.resourceKind,
        resourceKey: input.resourceKey,
        scopeKey: input.scopeKey,
        holderKind: input.holderKind,
        holderId: input.holderId,
        workerId: input.workerId,
        runId: input.runId,
        executionId: input.executionId,
        requestId: input.requestId,
        status: 'active',
        leaseToken: randomUUID(),
        expiresAt,
      },
    });
    return { ok: true, leaseId: lease.id, expiresAt: lease.expiresAt };
  }

  async releaseByHolder(holderId: string): Promise<void> {
    await this.prisma.executionLease.updateMany({
      where: {
        holderId,
        status: 'active',
      },
      data: {
        status: 'released',
        releasedAt: new Date(),
      },
    });
  }

  async expireLeases(): Promise<number> {
    const result = await this.prisma.executionLease.updateMany({
      where: {
        status: 'active',
        expiresAt: { lt: new Date() },
      },
      data: {
        status: 'expired',
      },
    });
    return result.count;
  }

  async listActive(sessionId: string) {
    return this.prisma.executionLease.findMany({
      where: {
        sessionId,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async emitConflict(input: AcquireLeaseInput, holderId: string): Promise<void> {
    if (input.sessionId) {
      await this.activity.log({
        sessionId: input.sessionId,
        eventId: 0,
        actorType: 'system',
        actorId: 'lease_service',
        runId: input.runId,
        requestId: input.requestId,
        workerId: input.workerId,
        summary: `Lease conflict on ${input.resourceKind}:${input.resourceKey}`,
        summaryKey: 'activity.lease_conflict',
        summaryParams: {
          resourceKind: input.resourceKind,
          resourceKey: input.resourceKey,
          holderId,
        },
        relatedNodeIds: input.sourceNodeId ? [input.sourceNodeId] : undefined,
      });
    }
    if (!input.sessionId || !input.sourceNodeId) {
      return;
    }
    const snapshot = await this.graph.loadSnapshot(input.sessionId);
    const source = snapshot.nodes.find((node) => node.id === input.sourceNodeId);
    const position = source?.position ?? { x: 0, y: 0 };
    const env = await this.graph.addNode(input.sessionId, {
      type: 'lease_conflict',
      content: {
        resourceKind: input.resourceKind,
        resourceKey: input.resourceKey,
        holderId,
        requestedBy: input.holderId,
        detail: `${input.resourceKind}:${input.resourceKey}`,
      },
      position: { x: position.x + 280, y: position.y + 40 },
      creator: { type: 'system', reason: 'lease_conflict' },
      metadata: {
        requestId: input.requestId,
        workerId: input.workerId,
      },
    });
    if (env.payload.type === 'node_added') {
      await this.graph.addEdge(input.sessionId, {
        source: input.sourceNodeId,
        target: env.payload.node.id,
        relation: 'invalidates',
        direction: 'source_to_target',
        creator: { type: 'system', reason: 'lease_conflict' },
      });
    }
  }
}
