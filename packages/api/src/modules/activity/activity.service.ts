import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CollaborationBusService } from '../collaboration/collaboration-bus.service';

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collaboration: CollaborationBusService,
  ) {}

  async log(params: {
    sessionId: string;
    eventId: number;
    actorType: 'human' | 'agent' | 'system';
    actorId: string;
    runId?: string;
    wakeReason?: string;
    requestId?: string;
    workerId?: string;
    worktreeId?: string;
    summary: string;
    summaryKey?: string;
    summaryParams?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    relatedNodeIds?: string[];
  }): Promise<void> {
    const row = await this.prisma.activityEntry.create({
      data: {
        sessionId: params.sessionId,
        actorType: params.actorType,
        actorId: params.actorId,
        runId: params.runId,
        wakeReason: params.wakeReason,
        requestId: params.requestId,
        workerId: params.workerId,
        worktreeId: params.worktreeId,
        summary: params.summary,
        summaryKey: params.summaryKey,
        summaryParams: params.summaryParams ? (params.summaryParams as object) : undefined,
        metadata: params.metadata ? (params.metadata as object) : undefined,
        relatedNodeIds: params.relatedNodeIds ? (params.relatedNodeIds as object) : undefined,
      },
    });
    this.collaboration.emitSession(params.sessionId, {
      type: 'activity.logged',
      eventId: params.eventId,
      sessionId: params.sessionId,
      runId: params.runId,
      wakeReason: params.wakeReason,
      requestId: params.requestId,
      workerId: params.workerId,
      worktreeId: params.worktreeId,
      actor: { type: params.actorType, id: params.actorId },
      timestamp: row.timestamp.toISOString(),
      payload: {
        id: row.id,
        summary: params.summary,
        summaryKey: params.summaryKey,
        summaryParams: params.summaryParams,
        metadata: params.metadata,
        relatedNodeIds: params.relatedNodeIds,
      },
    });
  }
}
