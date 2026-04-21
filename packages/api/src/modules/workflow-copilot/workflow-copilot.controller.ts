import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { WorkflowCopilotService } from './workflow-copilot.service';

@Controller('sessions/:sessionId/workflow-copilot')
export class WorkflowCopilotController {
  constructor(private readonly copilot: WorkflowCopilotService) {}

  @Post('thread')
  async ensureThread(@Param('sessionId') sessionId: string, @Body() body: unknown) {
    return ok(await this.copilot.ensureThread(sessionId, body as never));
  }

  @Get('threads/:threadId')
  async getThread(@Param('sessionId') sessionId: string, @Param('threadId') threadId: string) {
    return ok(await this.copilot.getThread(sessionId, threadId));
  }

  @Patch('threads/:threadId')
  async patchThread(
    @Param('sessionId') sessionId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
  ) {
    return ok(await this.copilot.patchThread(sessionId, threadId, body));
  }

  @Post('threads/:threadId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
  ) {
    return ok(await this.copilot.sendMessage(sessionId, threadId, body));
  }

  @Post('threads/:threadId/stop')
  async stopThread(@Param('sessionId') sessionId: string, @Param('threadId') threadId: string) {
    return ok(await this.copilot.stopThread(sessionId, threadId));
  }

  @Post('threads/:threadId/messages/:messageId/apply')
  async applyMessage(
    @Param('sessionId') sessionId: string,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
  ) {
    return ok(await this.copilot.applyMessage(sessionId, threadId, messageId));
  }

  @Post('threads/:threadId/checkpoints/:checkpointId/restore')
  async restoreCheckpoint(
    @Param('sessionId') sessionId: string,
    @Param('threadId') threadId: string,
    @Param('checkpointId') checkpointId: string,
  ) {
    return ok(await this.copilot.restoreCheckpoint(sessionId, threadId, checkpointId));
  }
}
