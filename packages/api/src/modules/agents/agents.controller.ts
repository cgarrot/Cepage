import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  agentTypeSchema,
  type AgentRerunRequest,
  type AgentSpawnRequest,
} from '@cepage/shared-core';
import { AgentsService } from './agents.service';
const WAKE_REASONS = [
  'human_prompt',
  'graph_change',
  'agent_mention',
  'scheduled',
  'manual',
  'approval_resolution',
  'external_event',
] as const;

class RuntimeDto {
  @IsString()
  kind!: string;

  @IsOptional()
  @IsString()
  cwd?: string;
}

class ModelDto {
  @IsString()
  providerID!: string;

  @IsString()
  modelID!: string;
}

class SpawnAgentDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsIn(agentTypeSchema.options)
  type!: string;

  @IsString()
  role!: string;

  @ValidateNested()
  @Type(() => RuntimeDto)
  runtime!: RuntimeDto;

  @IsOptional()
  @IsString()
  workingDirectory?: string;

  @IsOptional()
  @IsString()
  triggerNodeId?: string;

  @IsIn(WAKE_REASONS)
  wakeReason!: (typeof WAKE_REASONS)[number];

  @IsArray()
  @IsString({ each: true })
  seedNodeIds!: string[];

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, boolean>;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: ModelDto;
}

class RerunAgentDto {
  @IsOptional()
  @IsIn(agentTypeSchema.options)
  type?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: ModelDto;
}

@Controller('sessions/:sessionId/agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('catalog')
  catalog(@Param('sessionId') sessionId: string) {
    return this.agents.catalog(sessionId);
  }

  @Post('spawn')
  spawn(@Param('sessionId') sessionId: string, @Body() body: SpawnAgentDto) {
    return this.agents.spawn(sessionId, body as AgentSpawnRequest);
  }

  @Post(':agentRunId/rerun')
  rerun(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
    @Body() body?: RerunAgentDto,
  ) {
    return this.agents.rerun(sessionId, agentRunId, (body ?? {}) as AgentRerunRequest);
  }

  @Post(':agentRunId/stop')
  stop(@Param('sessionId') sessionId: string, @Param('agentRunId') agentRunId: string) {
    return this.agents.stop(sessionId, agentRunId);
  }
}
