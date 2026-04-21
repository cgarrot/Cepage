import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ok } from '@cepage/shared-core';
import { ActivityService } from '../activity/activity.service';
import { GraphService } from './graph.service';

const HUMAN = { type: 'human' as const, userId: 'local-user' };

class CreateBranchDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  color!: string;

  @IsString()
  @MinLength(1)
  fromNodeId!: string;
}

class MergeBranchDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsString()
  @MinLength(1)
  targetBranchId!: string;
}

class AbandonBranchDto {
  @IsOptional()
  @IsString()
  requestId?: string;
}

@Controller('sessions/:sessionId/branches')
export class BranchesController {
  constructor(
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
  ) {}

  @Post()
  async create(@Param('sessionId') sessionId: string, @Body() body: CreateBranchDto) {
    const env = await this.graph.createBranch(sessionId, {
      name: body.name,
      color: body.color,
      fromNodeId: body.fromNodeId,
      actor: HUMAN,
      requestId: body.requestId,
    });
    if (env.payload.type !== 'branch_created') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: `Created branch ${body.name}.`,
      summaryKey: 'activity.branch_created',
      summaryParams: { name: body.name },
      relatedNodeIds: [body.fromNodeId],
    });
    return ok({ branch: env.payload.branch, eventId: env.eventId });
  }

  @Post(':branchId/merge')
  async merge(
    @Param('sessionId') sessionId: string,
    @Param('branchId') branchId: string,
    @Body() body: MergeBranchDto,
  ) {
    const snap = await this.graph.loadSnapshot(sessionId);
    const src = snap.branches.find((entry) => entry.id === branchId);
    const dst = snap.branches.find((entry) => entry.id === body.targetBranchId);
    const env = await this.graph.mergeBranch(sessionId, {
      sourceBranchId: branchId,
      targetBranchId: body.targetBranchId,
      actor: HUMAN,
      requestId: body.requestId,
    });
    if (env.payload.type !== 'branch_merged') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: `Merged ${src?.name ?? branchId} into ${dst?.name ?? body.targetBranchId}.`,
      summaryKey: 'activity.branch_merged',
      summaryParams: {
        source: src?.name ?? branchId,
        target: dst?.name ?? body.targetBranchId,
      },
      relatedNodeIds: src?.headNodeId ? [src.headNodeId] : undefined,
    });
    return ok({
      sourceBranchId: env.payload.sourceBranchId,
      targetBranchId: env.payload.targetBranchId,
      eventId: env.eventId,
    });
  }

  @Post(':branchId/abandon')
  async abandon(
    @Param('sessionId') sessionId: string,
    @Param('branchId') branchId: string,
    @Body() body: AbandonBranchDto,
  ) {
    const snap = await this.graph.loadSnapshot(sessionId);
    const branch = snap.branches.find((entry) => entry.id === branchId);
    const env = await this.graph.abandonBranch(sessionId, {
      branchId,
      actor: HUMAN,
      requestId: body.requestId,
    });
    if (env.payload.type !== 'branch_abandoned') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: `Abandoned branch ${branch?.name ?? branchId}.`,
      summaryKey: 'activity.branch_abandoned',
      summaryParams: { name: branch?.name ?? branchId },
      relatedNodeIds: branch?.headNodeId ? [branch.headNodeId] : undefined,
    });
    return ok({ branchId: env.payload.branchId, eventId: env.eventId });
  }
}
