import { Injectable } from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { WorkflowControllerService } from '../agents/workflow-controller.service';
import { WorkflowManagedFlowService } from '../agents/workflow-managed-flow.service';
import { AgentsService } from '../agents/agents.service';
import { RunSupervisorService } from './run-supervisor.service';
import { PrismaService } from '../../common/database/prisma.service';
import { json } from '../../common/database/prisma-json';
import { nextScheduledRun } from '../../common/utils/cron-schedule.util';

@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly flows: WorkflowManagedFlowService,
    private readonly controllers: WorkflowControllerService,
    private readonly agents: AgentsService,
    private readonly supervisor: RunSupervisorService,
  ) {}

  async register(input: {
    sessionId: string;
    ownerNodeId: string;
    cron: string;
    label?: string;
    payload?: Record<string, unknown>;
  }) {
    const current = await this.prisma.scheduledTrigger.findFirst({
      where: {
        sessionId: input.sessionId,
        ownerNodeId: input.ownerNodeId,
      },
    });
    const now = new Date();
    const nextRunAt = nextScheduledRun(input.cron, now, current?.lastRunAt);
    if (current) {
      return this.prisma.scheduledTrigger.update({
        where: { id: current.id },
        data: {
          cron: input.cron,
          label: input.label,
          payload: json(input.payload ?? {}),
          status: nextRunAt ? 'active' : 'paused',
          nextRunAt: nextRunAt ?? now,
        },
      });
    }
    return this.prisma.scheduledTrigger.create({
      data: {
        sessionId: input.sessionId,
        ownerNodeId: input.ownerNodeId,
        label: input.label,
        cron: input.cron,
        payload: json(input.payload ?? {}),
        status: nextRunAt ? 'active' : 'paused',
        nextRunAt: nextRunAt ?? now,
      },
    });
  }

  async tick(): Promise<void> {
    const due = await this.prisma.scheduledTrigger.findMany({
      where: {
        status: 'active',
        nextRunAt: { lte: new Date() },
      },
      orderBy: [{ nextRunAt: 'asc' }],
      take: 16,
    });
    for (const row of due) {
      const now = new Date();
      await this.supervisor.queueScheduledTrigger({
        sessionId: row.sessionId,
        triggerId: row.id,
      });
      const nextRunAt = nextScheduledRun(row.cron, now, now);
      await this.prisma.scheduledTrigger.update({
        where: { id: row.id },
        data: {
          lastRunAt: now,
          status: nextRunAt ? 'active' : 'paused',
          nextRunAt: nextRunAt ?? now,
        },
      });
    }
  }

  async executeScheduledTrigger(triggerId: string): Promise<void> {
    const trigger = await this.prisma.scheduledTrigger.findUnique({
      where: { id: triggerId },
    });
    if (!trigger || trigger.status !== 'active') {
      return;
    }
    const snapshot = await this.graph.loadSnapshot(trigger.sessionId);
    const node = snapshot.nodes.find((entry) => entry.id === trigger.ownerNodeId);
    if (!node) {
      await this.prisma.scheduledTrigger.update({
        where: { id: trigger.id },
        data: { status: 'failed' },
      });
      return;
    }
    if (node.type === 'managed_flow') {
      await this.flows.run(trigger.sessionId, node.id, {
        requestId: `scheduled:${trigger.id}`,
      });
      return;
    }
    if (node.type === 'loop') {
      await this.controllers.run(trigger.sessionId, node.id, {
        requestId: `scheduled:${trigger.id}`,
      });
      return;
    }
    await this.agents.runWorkflow(trigger.sessionId, {
      triggerNodeId: node.id,
      type: 'orchestrator',
      role: 'planner',
      wakeReason: 'scheduled',
      requestId: `scheduled:${trigger.id}`,
    });
  }
}
