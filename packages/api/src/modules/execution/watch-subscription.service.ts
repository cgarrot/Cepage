import { Injectable } from '@nestjs/common';
import type { GraphEventEnvelope } from '@cepage/shared-core';
import { GraphService } from '../graph/graph.service';
import { WorkflowControllerService } from '../agents/workflow-controller.service';
import { WorkflowManagedFlowService } from '../agents/workflow-managed-flow.service';
import { AgentsService } from '../agents/agents.service';
import { RunSupervisorService } from './run-supervisor.service';
import { PrismaService } from '../../common/database/prisma.service';
import { json } from '../../common/database/prisma-json';

function matchesSubscription(target: string, event: GraphEventEnvelope): boolean {
  const payload = event.payload;
  if (payload.type === 'node_added' || payload.type === 'node_updated' || payload.type === 'node_removed') {
    return payload.nodeId === target;
  }
  if (payload.type === 'branch_created') {
    return payload.branchId === target;
  }
  if (payload.type === 'branch_merged') {
    return payload.sourceBranchId === target || payload.targetBranchId === target;
  }
  if (payload.type === 'branch_abandoned') {
    return payload.branchId === target;
  }
  return false;
}

@Injectable()
export class WatchSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly flows: WorkflowManagedFlowService,
    private readonly controllers: WorkflowControllerService,
    private readonly agents: AgentsService,
    private readonly supervisor: RunSupervisorService,
  ) {}

  async create(input: {
    sessionId: string;
    kind: 'graph_node' | 'graph_branch' | 'workspace_path' | 'runtime_target';
    target: string;
    ownerNodeId?: string;
    payload?: Record<string, unknown>;
  }) {
    return this.prisma.watchSubscription.create({
      data: {
        sessionId: input.sessionId,
        ownerNodeId: input.ownerNodeId,
        kind: input.kind,
        target: input.target,
        status: 'active',
        payload: json(input.payload ?? {}),
      },
    });
  }

  async notifyGraphEvent(env: GraphEventEnvelope): Promise<void> {
    const rows = await this.prisma.watchSubscription.findMany({
      where: {
        sessionId: env.sessionId,
        status: 'active',
        kind: {
          in: ['graph_node', 'graph_branch'],
        },
      },
    });
    for (const row of rows) {
      if (!matchesSubscription(row.target, env)) {
        continue;
      }
      await this.prisma.watchSubscription.update({
        where: { id: row.id },
        data: {
          lastEventAt: new Date(env.timestamp),
          cursor: String(env.eventId),
        },
      });
      await this.supervisor.queueWatchTrigger({
        sessionId: row.sessionId,
        subscriptionId: row.id,
        eventId: env.eventId,
      });
    }
  }

  async executeWatchTrigger(subscriptionId: string): Promise<void> {
    const row = await this.prisma.watchSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!row || row.status !== 'active') {
      return;
    }
    const ownerNodeId =
      row.ownerNodeId
      ?? (typeof (row.payload as { ownerNodeId?: unknown } | null)?.ownerNodeId === 'string'
        ? ((row.payload as { ownerNodeId: string }).ownerNodeId)
        : null);
    if (!ownerNodeId) {
      return;
    }
    const snapshot = await this.graph.loadSnapshot(row.sessionId);
    const node = snapshot.nodes.find((entry) => entry.id === ownerNodeId);
    if (!node) {
      return;
    }
    if (node.type === 'managed_flow') {
      await this.flows.run(row.sessionId, node.id, {
        requestId: `watch:${row.id}`,
      });
      return;
    }
    if (node.type === 'loop') {
      await this.controllers.run(row.sessionId, node.id, {
        requestId: `watch:${row.id}`,
      });
      return;
    }
    await this.agents.runWorkflow(row.sessionId, {
      triggerNodeId: node.id,
      type: 'orchestrator',
      role: 'observer',
      wakeReason: 'graph_change',
      requestId: `watch:${row.id}`,
    });
  }
}
