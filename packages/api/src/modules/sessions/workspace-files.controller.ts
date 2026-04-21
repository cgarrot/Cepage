import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import type { Response } from 'express';
import { WorkspaceFilesService } from './workspace-files.service';

@Controller('sessions/:sessionId/workspace/file')
export class WorkspaceFilesController {
  constructor(private readonly files: WorkspaceFilesService) {}

  @Get('meta')
  async meta(
    @Param('sessionId') sessionId: string,
    @Query('path') filePath: string | undefined,
  ) {
    const requested = (filePath ?? '').trim();
    if (!requested) {
      throw new BadRequestException('WORKSPACE_FILE_PATH_REQUIRED');
    }
    return ok(await this.files.getMeta(sessionId, requested));
  }

  @Get()
  async stream(
    @Param('sessionId') sessionId: string,
    @Query('path') filePath: string | undefined,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requested = (filePath ?? '').trim();
    if (!requested) {
      throw new BadRequestException('WORKSPACE_FILE_PATH_REQUIRED');
    }
    const opened = await this.files.openStream(sessionId, requested);
    const disposition = download === '1' || download === 'true' ? 'attachment' : 'inline';
    response.setHeader('Content-Type', opened.mime);
    response.setHeader('Content-Length', String(opened.size));
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(opened.filename)}`,
    );
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(opened.stream);
  }
}
