import {
  Body,
  Controller,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ok } from '@cepage/shared-core';
import { AgentsService } from './agents.service';

const MAX_FILE_BYTES = 12 * 1024 * 1024;

@Controller('sessions/:sessionId/workflow')
export class WorkflowRunController {
  constructor(private readonly agents: AgentsService) {}

  @Post('run')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async run(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @UploadedFiles()
    files: Array<{
      fieldname?: string;
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }> = [],
  ) {
    return ok(await this.agents.runWorkflow(sessionId, body, files));
  }
}
