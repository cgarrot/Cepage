import { Injectable, NotFoundException } from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../../common/database/prisma.service';
import { json } from '../../common/database/prisma-json';
import { RunSupervisorService } from './run-supervisor.service';
import { agentRunJobPayloadSchema } from './execution-job-payload';

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
    private readonly supervisor: RunSupervisorService,
  ) {}

  async request(input: {
    sessionId: string;
    kind: string;
    title: string;
    detail?: string;
    risk?: 'low' | 'medium' | 'high';
    payload?: Record<string, unknown>;
    requestedByType: string;
    requestedById: string;
    runId?: string;
    executionId?: string;
    requestId?: string;
    sourceNodeId?: string;
  }) {
    const row = await this.prisma.approvalRequest.create({
      data: {
        sessionId: input.sessionId,
        runId: input.runId,
        executionId: input.executionId,
        requestId: input.requestId,
        kind: input.kind,
        status: 'pending',
        title: input.title,
        detail: input.detail,
        risk: input.risk ?? 'medium',
        payload: json(input.payload ?? {}),
        requestedByType: input.requestedByType,
        requestedById: input.requestedById,
      },
    });
    await this.activity.log({
      sessionId: input.sessionId,
      eventId: 0,
      actorType: 'system',
      actorId: 'approval_service',
      runId: input.runId,
      requestId: input.requestId,
      summary: `Approval requested: ${input.title}`,
      summaryKey: 'activity.approval_requested',
      summaryParams: {
        approvalId: row.id,
        kind: input.kind,
        risk: row.risk,
      },
      relatedNodeIds: input.sourceNodeId ? [input.sourceNodeId] : undefined,
    });
    await this.emitRequestNode(row.id, input);
    return row;
  }

  async resolve(input: {
    sessionId: string;
    approvalId: string;
    status: 'approved' | 'rejected' | 'cancelled';
    summary: string;
    resolvedByType: string;
    resolvedById: string;
  }) {
    const row = await this.prisma.approvalRequest.findUnique({
      where: { id: input.approvalId },
    });
    if (!row || row.sessionId !== input.sessionId) {
      throw new NotFoundException('APPROVAL_NOT_FOUND');
    }
    const next = await this.prisma.approvalRequest.update({
      where: { id: row.id },
      data: {
        status: input.status,
        resolution: json({
          summary: input.summary,
        }),
        resolvedByType: input.resolvedByType,
        resolvedById: input.resolvedById,
        resolvedAt: new Date(),
      },
    });
    await this.activity.log({
      sessionId: input.sessionId,
      eventId: 0,
      actorType: 'system',
      actorId: 'approval_service',
      runId: row.runId ?? undefined,
      requestId: row.requestId ?? undefined,
      summary: `Approval ${input.status}: ${row.title}`,
      summaryKey: 'activity.approval_resolved',
      summaryParams: {
        approvalId: row.id,
        status: input.status,
      },
    });
    await this.emitResolutionNode(next.id, input.summary, input.status, input.resolvedById);
    if (input.status === 'approved') {
      await this.supervisor.queueApprovalResolution({
        sessionId: input.sessionId,
        approvalId: row.id,
        wakeReason: 'approval_resolution',
      });
    }
    return next;
  }

  async executeResolution(approvalId: string): Promise<void> {
    const row = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
    });
    if (!row || row.status !== 'approved') {
      return;
    }
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const action = typeof payload.action === 'string' ? payload.action : null;
    if (action === 'runtime_start') {
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : row.sessionId;
      const targetNodeId = typeof payload.targetNodeId === 'string' ? payload.targetNodeId : undefined;
      if (sessionId && targetNodeId) {
        await this.supervisor.queueRuntime({
          sessionId,
          operation: 'start',
          targetNodeId,
          approvalId: row.id,
        });
      }
      return;
    }
    if (action === 'agent_run') {
      const parsed = agentRunJobPayloadSchema.safeParse(payload.job ?? payload);
      if (parsed.success) {
        await this.supervisor.queueAgentRun(parsed.data);
      }
    }
  }

  async listPending(sessionId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { sessionId, status: 'pending' },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  private async emitRequestNode(approvalId: string, input: {
    sessionId: string;
    kind: string;
    title: string;
    detail?: string;
    risk?: 'low' | 'medium' | 'high';
    sourceNodeId?: string;
  }): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(input.sessionId);
    const source = input.sourceNodeId
      ? snapshot.nodes.find((node) => node.id === input.sourceNodeId)
      : undefined;
    const position = source?.position ?? { x: 0, y: 0 };
    const env = await this.graph.addNode(input.sessionId, {
      type: 'approval_request',
      content: {
        requestId: approvalId,
        kind: input.kind,
        status: 'pending',
        title: input.title,
        detail: input.detail,
        risk: input.risk ?? 'medium',
      },
      position: { x: position.x + 260, y: position.y + 40 },
      creator: { type: 'system', reason: 'approval_request' },
    });
    if (env.payload.type === 'node_added' && input.sourceNodeId) {
      await this.graph.addEdge(input.sessionId, {
        source: input.sourceNodeId,
        target: env.payload.node.id,
        relation: 'asks',
        direction: 'source_to_target',
        creator: { type: 'system', reason: 'approval_request' },
      });
    }
  }

  private async emitResolutionNode(
    approvalId: string,
    summary: string,
    status: 'approved' | 'rejected' | 'cancelled',
    resolvedBy: string,
  ): Promise<void> {
    const row = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
    });
    if (!row?.sessionId) {
      return;
    }
    const snapshot = await this.graph.loadSnapshot(row.sessionId);
    const requestNode = snapshot.nodes.find(
      (node) => node.type === 'approval_request'
        && typeof (node.content as { requestId?: unknown }).requestId === 'string'
        && (node.content as { requestId: string }).requestId === approvalId,
    );
    const position = requestNode?.position ?? { x: 0, y: 0 };
    const env = await this.graph.addNode(row.sessionId, {
      type: 'approval_resolution',
      content: {
        requestId: approvalId,
        status,
        summary,
        resolvedBy,
      },
      position: { x: position.x + 280, y: position.y + 20 },
      creator: { type: 'system', reason: 'approval_resolution' },
    });
    if (env.payload.type === 'node_added' && requestNode) {
      await this.graph.addEdge(row.sessionId, {
        source: requestNode.id,
        target: env.payload.node.id,
        relation: 'approves',
        direction: 'source_to_target',
        creator: { type: 'system', reason: 'approval_resolution' },
      });
    }
  }
}
