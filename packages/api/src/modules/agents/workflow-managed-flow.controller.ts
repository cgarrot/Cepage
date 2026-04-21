import { Body, Controller, Param, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { WorkflowManagedFlowService } from './workflow-managed-flow.service';

@Controller('sessions/:sessionId/flows')
export class WorkflowManagedFlowController {
  constructor(private readonly flows: WorkflowManagedFlowService) {}

  @Post(':nodeId/run')
  async run(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
  ) {
    return ok(await this.flows.run(sessionId, nodeId, body));
  }

  @Post(':flowId/cancel')
  async cancel(
    @Param('sessionId') sessionId: string,
    @Param('flowId') flowId: string,
    @Body() body: unknown,
  ) {
    return ok(await this.flows.cancel(sessionId, flowId, body));
  }
}
