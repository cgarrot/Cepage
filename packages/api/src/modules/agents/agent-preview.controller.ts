import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ok } from '@cepage/shared-core';
import { PreviewRuntimeService } from './preview-runtime.service';
import { RunArtifactsService } from './run-artifacts.service';

@Controller('sessions/:sessionId/agents/:agentRunId/preview')
export class AgentPreviewController {
  constructor(
    private readonly preview: PreviewRuntimeService,
    private readonly artifacts: RunArtifactsService,
  ) {}

  @Get('status')
  async getStatus(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
  ) {
    return ok(await this.preview.getPreview(sessionId, agentRunId));
  }

  @Post('start')
  async start(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
  ) {
    return ok(await this.preview.ensurePreview(sessionId, agentRunId));
  }

  @Get('frame')
  async frame(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
    @Res() res: Response,
  ) {
    res.type('html').send(await this.preview.renderPreviewFrame(sessionId, agentRunId));
  }

  @Get()
  async root(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
    @Res() res: Response,
  ) {
    const body = await this.artifacts.getStaticPreviewFile(sessionId, agentRunId, 'index.html');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(body);
  }

  @Get('*assetPath')
  async asset(
    @Param('sessionId') sessionId: string,
    @Param('agentRunId') agentRunId: string,
    @Param('assetPath') assetPathParam: string | string[] | undefined,
    @Res() res: Response,
  ) {
    const assetPath = normalizeWildcardPath(assetPathParam);
    const body = await this.artifacts.getStaticPreviewFile(sessionId, agentRunId, assetPath);
    res.setHeader('content-type', guessContentType(assetPath));
    res.send(body);
  }
}

function normalizeWildcardPath(value: string | string[] | undefined): string {
  // path-to-regexp v8 returns named wildcards as path segment arrays.
  return Array.isArray(value) ? value.join('/') : String(value ?? '').replace(/^\/+/, '');
}

function guessContentType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'css') return 'text/css; charset=utf-8';
  if (extension === 'js') return 'text/javascript; charset=utf-8';
  if (extension === 'json') return 'application/json; charset=utf-8';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'ico') return 'image/x-icon';
  if (extension === 'html') return 'text/html; charset=utf-8';
  return 'text/plain; charset=utf-8';
}
