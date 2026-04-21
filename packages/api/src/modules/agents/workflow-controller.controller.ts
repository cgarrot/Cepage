import { Body, Controller, Param, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { WorkflowControllerService } from './workflow-controller.service';

@Controller('sessions/:sessionId/controllers')
export class WorkflowControllerController {
  constructor(private readonly controllers: WorkflowControllerService) {}

  @Post(':nodeId/run')
  async run(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
  ) {
    return ok(await this.controllers.run(sessionId, nodeId, body));
  }
}
