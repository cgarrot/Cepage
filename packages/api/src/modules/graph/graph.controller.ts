import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { GraphService } from './graph.service';
import type { GraphEdge, GraphNode } from '@cepage/shared-core';
import { ok } from '@cepage/shared-core';
import { ActivityService } from '../activity/activity.service';

const HUMAN = { type: 'human' as const, userId: 'local-user' };

class PositionDto {
  @IsNumber()
  x!: number;
  @IsNumber()
  y!: number;
}

class CreateNodeDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsString()
  type!: string;

  @IsOptional()
  content?: Record<string, unknown>;

  @ValidateNested()
  @Type(() => PositionDto)
  position!: PositionDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  branches?: string[];
}

class PatchNodeDto {
  @IsOptional()
  content?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PositionDto)
  position?: PositionDto;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

class CreateEdgeDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsString()
  source!: string;

  @IsString()
  target!: string;

  @IsString()
  relation!: string;

  @IsOptional()
  @IsString()
  direction?: string;
}

@Controller('sessions/:sessionId')
export class GraphController {
  constructor(
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
  ) {}

  @Post('nodes')
  async createNode(@Param('sessionId') sessionId: string, @Body() body: CreateNodeDto) {
    const env = await this.graph.addNode(sessionId, {
      type: body.type as GraphNode['type'],
      content: (body.content ?? { text: '', format: 'plaintext' }) as GraphNode['content'],
      position: body.position,
      creator: HUMAN,
      requestId: body.requestId,
    });
    if (env.payload.type !== 'node_added') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: 'Created a node.',
      summaryKey: 'activity.node_created',
      relatedNodeIds: [env.payload.node.id],
    });
    return ok({ node: env.payload.node, eventId: env.eventId });
  }

  @Patch('nodes/:nodeId')
  async patchNode(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: PatchNodeDto,
  ) {
    const patch: Partial<GraphNode> = {};
    if (body.content !== undefined) patch.content = body.content as GraphNode['content'];
    if (body.position !== undefined) patch.position = body.position;
    if (body.status !== undefined) patch.status = body.status as GraphNode['status'];
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    const env = await this.graph.patchNode(sessionId, nodeId, patch, HUMAN);
    if (env.payload.type !== 'node_updated') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: 'Updated a node.',
      summaryKey: 'activity.node_updated',
      relatedNodeIds: [nodeId],
    });
    return ok({ nodeId, patch: env.payload.patch, eventId: env.eventId });
  }

  @Delete('nodes/:nodeId')
  async removeNode(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
  ) {
    const env = await this.graph.removeNode(sessionId, nodeId, HUMAN);
    if (env.payload.type !== 'node_removed') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: 'Removed a node.',
      summaryKey: 'activity.node_removed',
      relatedNodeIds: [nodeId],
    });
    return ok({ nodeId: env.payload.nodeId, eventId: env.eventId });
  }

  @Post('edges')
  async createEdge(@Param('sessionId') sessionId: string, @Body() body: CreateEdgeDto) {
    const env = await this.graph.addEdge(sessionId, {
      source: body.source,
      target: body.target,
      relation: body.relation as GraphEdge['relation'],
      direction: (body.direction as GraphEdge['direction']) ?? 'bidirectional',
      creator: HUMAN,
      requestId: body.requestId,
    });
    if (env.payload.type !== 'edge_added') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: 'Created a link.',
      summaryKey: 'activity.edge_created',
      relatedNodeIds: [body.source, body.target],
    });
    return ok({ edge: env.payload.edge, eventId: env.eventId });
  }

  @Delete('edges/:edgeId')
  async removeEdge(@Param('sessionId') sessionId: string, @Param('edgeId') edgeId: string) {
    const snap = await this.graph.loadSnapshot(sessionId);
    const edge = snap.edges.find((entry) => entry.id === edgeId);
    const env = await this.graph.removeEdge(sessionId, edgeId, HUMAN);
    if (env.payload.type !== 'edge_removed') throw new Error('unexpected');
    await this.activity.log({
      sessionId,
      eventId: env.eventId,
      actorType: 'human',
      actorId: HUMAN.userId,
      summary: 'Removed a link.',
      summaryKey: 'activity.edge_removed',
      relatedNodeIds: edge ? [edge.source, edge.target] : undefined,
    });
    return ok({ edgeId: env.payload.edgeId, eventId: env.eventId });
  }

  @Post('workflow/import')
  async importWorkflow(@Param('sessionId') sessionId: string, @Body() body: unknown) {
    return ok(await this.graph.replaceWorkflow(sessionId, body));
  }

  @Get('events')
  async listEvents(
    @Param('sessionId') sessionId: string,
    @Query('afterEventId') after?: string,
    @Query('limit') limitStr?: string,
  ) {
    const afterEventId = after != null ? Number(after) : undefined;
    const limit = Math.min(Number(limitStr ?? '500') || 500, 2000);
    const rows = await this.graph.listEvents(sessionId, afterEventId, limit);
    return ok({
      events: rows.map((r) => ({
        eventId: r.eventId,
        sessionId: r.sessionId,
        kind: r.kind,
        payload: r.payload,
        actor: r.actor,
        runId: r.runId,
        wakeReason: r.wakeReason,
        requestId: r.requestId,
        timestamp: r.timestamp.toISOString(),
      })),
    });
  }
}
