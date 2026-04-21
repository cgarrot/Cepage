import { Injectable } from '@nestjs/common';
import { getEnv } from '@cepage/config';
import { GraphService } from '../graph/graph.service';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class BudgetPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
  ) {}

  async reserve(input: {
    sessionId: string;
    scopeKind: string;
    scopeId: string;
    units?: number;
    sourceNodeId?: string;
    runId?: string;
    requestId?: string;
    workerId?: string;
  }): Promise<{ ok: true; accountId: string } | { ok: false; accountId: string }> {
    const units = Math.max(1, input.units ?? 1);
    const existing = await this.prisma.budgetAccount.findFirst({
      where: {
        sessionId: input.sessionId,
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const account =
      existing
      ?? (await this.prisma.budgetAccount.create({
        data: {
          sessionId: input.sessionId,
          scopeKind: input.scopeKind,
          scopeId: input.scopeId,
          status: 'active',
          unit: 'points',
          limit: getEnv().AUTONOMY_DEFAULT_BUDGET,
          used: 0,
        },
      }));
    const limit = account.limit ?? getEnv().AUTONOMY_DEFAULT_BUDGET;
    const used = account.used + units;
    const status = used >= limit ? 'exhausted' : used >= Math.ceil(limit * 0.75) ? 'paused' : 'active';
    const next = await this.prisma.budgetAccount.update({
      where: { id: account.id },
      data: {
        used,
        status,
      },
    });
    if (status === 'active') {
      return { ok: true, accountId: next.id };
    }
    await this.emitAlert({
      sessionId: input.sessionId,
      accountId: next.id,
      scope: `${input.scopeKind}:${input.scopeId}`,
      used: next.used,
      limit,
      sourceNodeId: input.sourceNodeId,
      runId: input.runId,
      requestId: input.requestId,
      workerId: input.workerId,
      level: status === 'exhausted' ? 'critical' : 'warning',
    });
    return status === 'exhausted'
      ? { ok: false, accountId: next.id }
      : { ok: true, accountId: next.id };
  }

  private async emitAlert(input: {
    sessionId: string;
    accountId: string;
    scope: string;
    used: number;
    limit: number;
    sourceNodeId?: string;
    runId?: string;
    requestId?: string;
    workerId?: string;
    level: 'warning' | 'critical';
  }): Promise<void> {
    await this.activity.log({
      sessionId: input.sessionId,
      eventId: 0,
      actorType: 'system',
      actorId: 'budget_policy',
      runId: input.runId,
      requestId: input.requestId,
      workerId: input.workerId,
      summary: `Budget ${input.level} for ${input.scope}: ${input.used}/${input.limit}`,
      summaryKey: 'activity.budget_alert',
      summaryParams: {
        scope: input.scope,
        used: input.used,
        limit: input.limit,
        level: input.level,
      },
      relatedNodeIds: input.sourceNodeId ? [input.sourceNodeId] : undefined,
    });
    if (!input.sourceNodeId) {
      return;
    }
    const snapshot = await this.graph.loadSnapshot(input.sessionId);
    const source = snapshot.nodes.find((node) => node.id === input.sourceNodeId);
    const position = source?.position ?? { x: 0, y: 0 };
    const env = await this.graph.addNode(input.sessionId, {
      type: 'budget_alert',
      content: {
        accountId: input.accountId,
        scope: input.scope,
        used: input.used,
        limit: input.limit,
        level: input.level,
      },
      position: { x: position.x + 260, y: position.y + 80 },
      creator: { type: 'system', reason: 'budget_alert' },
      metadata: {
        requestId: input.requestId,
        workerId: input.workerId,
      },
    });
    if (env.payload.type === 'node_added') {
      await this.graph.addEdge(input.sessionId, {
        source: input.sourceNodeId,
        target: env.payload.node.id,
        relation: 'observes',
        direction: 'source_to_target',
        creator: { type: 'system', reason: 'budget_alert' },
      });
    }
  }
}
