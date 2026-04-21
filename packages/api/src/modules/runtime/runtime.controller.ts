import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ok } from '@cepage/shared-core';
import { RuntimeService } from './runtime.service';

@Controller('sessions/:sessionId/runtime')
export class RuntimeController {
  constructor(private readonly runtime: RuntimeService) {}

  @Post('targets/:targetNodeId/run')
  async runTarget(
    @Param('sessionId') sessionId: string,
    @Param('targetNodeId') targetNodeId: string,
  ) {
    return ok(await this.runtime.runTarget(sessionId, targetNodeId));
  }

  @Post('runs/:runNodeId/stop')
  async stopRun(
    @Param('sessionId') sessionId: string,
    @Param('runNodeId') runNodeId: string,
  ) {
    return ok(await this.runtime.stopRun(sessionId, runNodeId));
  }

  @Post('runs/:runNodeId/restart')
  async restartRun(
    @Param('sessionId') sessionId: string,
    @Param('runNodeId') runNodeId: string,
  ) {
    return ok(await this.runtime.restartRun(sessionId, runNodeId));
  }

  @Get('runs/:runNodeId/preview')
  async rootPreview(
    @Param('sessionId') sessionId: string,
    @Param('runNodeId') runNodeId: string,
    @Res() res: Response,
  ) {
    const body = await this.runtime.getStaticPreviewFile(sessionId, runNodeId, '');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(body);
  }

  @Get('runs/:runNodeId/preview/*assetPath')
  async previewAsset(
    @Param('sessionId') sessionId: string,
    @Param('runNodeId') runNodeId: string,
    @Param('assetPath') assetPathParam: string | string[] | undefined,
    @Res() res: Response,
  ) {
    const assetPath = normalizeWildcardPath(assetPathParam);
    const body = await this.runtime.getStaticPreviewFile(sessionId, runNodeId, assetPath);
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
