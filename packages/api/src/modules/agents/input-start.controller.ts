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

@Controller('sessions/:sessionId/inputs')
export class InputStartController {
  constructor(private readonly agents: AgentsService) {}

  @Post(':nodeId/start')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async start(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
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
    return ok(await this.agents.startInputNode(sessionId, nodeId, body, files));
  }
}
