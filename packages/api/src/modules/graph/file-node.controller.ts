import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ok, agentTypeSchema, type AgentModelRef, type AgentType } from '@cepage/shared-core';
import type { Response } from 'express';
import { FileNodeService } from './file-node.service';

const MAX_FILE_BYTES = 12 * 1024 * 1024;

class ModelDto {
  @IsString()
  providerID!: string;

  @IsString()
  modelID!: string;
}

class SummarizeFileNodeDto {
  @IsOptional()
  @IsIn(agentTypeSchema.options)
  type?: AgentType;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: AgentModelRef;
}

@Controller('sessions/:sessionId/nodes/:nodeId/file')
export class FileNodeController {
  constructor(private readonly files: FileNodeService) {}

  @Post('upload')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async upload(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
      fieldname?: string;
    }> = [],
  ) {
    if (files.length === 0) {
      throw new BadRequestException('FILE_NODE_FILE_REQUIRED');
    }
    return ok(await this.files.upload(sessionId, nodeId, files));
  }

  @Post('summarize')
  async summarize(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: SummarizeFileNodeDto,
  ) {
    return ok(await this.files.summarize(sessionId, nodeId, body));
  }

  @Get()
  async asset(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const asset = await this.files.readAsset(sessionId, nodeId);
    response.setHeader('Content-Type', asset.file.mimeType || 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(asset.file.name)}`,
    );
    return new StreamableFile(asset.data);
  }

  @Get(':fileId')
  async assetById(
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const asset = await this.files.readAsset(sessionId, nodeId, fileId);
    response.setHeader('Content-Type', asset.file.mimeType || 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(asset.file.name)}`,
    );
    return new StreamableFile(asset.data);
  }
}
