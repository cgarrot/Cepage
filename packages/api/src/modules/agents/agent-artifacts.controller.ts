import { Controller, Get, Param, Query } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { RunArtifactsService } from './run-artifacts.service';

@Controller('sessions/:sessionId/agents/:agentRunId/artifacts')
export class AgentArtifactsController {
  constructor(private readonly artifacts: RunArtifactsService) {}

  @Get()
  async getArtifacts(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
  ) {
    return ok(await this.artifacts.getRunArtifacts(sessionId, agentRunId));
  }

  @Get('file')
  async getFile(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
    @Query('path') filePath: string,
  ) {
    return ok(await this.artifacts.readArtifactFile(sessionId, agentRunId, filePath));
  }
}
