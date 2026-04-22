import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ok } from '@cepage/shared-core';
import { SkillRunsService, type SkillRunEvent } from './skill-runs.service';
import { SkillRunsRateLimitGuard } from './skill-runs-rate-limit.guard';
import { CreateSkillRunDto } from './skill-runs.dto';

// REST surface for typed skill execution.
//
// Routes:
//   POST   /api/v1/skills/:slug/runs?wait=true|false
//   GET    /api/v1/skills/:slug/runs
//   GET    /api/v1/skill-runs/:runId
//   GET    /api/v1/skill-runs/:runId/stream     (SSE)
//   POST   /api/v1/skill-runs/:runId/cancel
//
// Mounted via two controllers to keep route roots small and unambiguous.

@Controller('skills')
export class SkillRunsBySkillController {
  constructor(private readonly runs: SkillRunsService) {}

  @Post(':slug/runs')
  @UseGuards(SkillRunsRateLimitGuard)
  async create(
    @Param('slug') slug: string,
    @Body() body: CreateSkillRunDto,
    @Res({ passthrough: true }) res: Response,
    @Query('wait') waitQ?: string,
    @Query('timeoutMs') timeoutQ?: string,
    @Headers('idempotency-key') idempotencyHeader?: string,
  ) {
    const wait = waitQ === undefined ? true : waitQ !== 'false';
    const timeoutMs = timeoutQ ? Number(timeoutQ) : undefined;
    const result = await this.runs.create(slug, body, { wait, timeoutMs, idempotencyKey: idempotencyHeader });
    if ('code' in result && result.code === 'INVALID_INPUT') {
      throw new HttpException(
        { code: 'INVALID_INPUT', errors: result.errors },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!wait) {
      res.status(HttpStatus.ACCEPTED);
      res.setHeader('Location', `/api/v1/skill-runs/${(result as { id: string }).id}`);
    }
    return ok(result);
  }

  @Get(':slug/runs')
  async list(
    @Param('slug') slug: string,
    @Query('limit') limitQ?: string,
  ) {
    const limit = limitQ ? Number(limitQ) : undefined;
    return ok(await this.runs.list({ skillId: slug, limit }));
  }
}

@Controller('skill-runs')
export class SkillRunsController {
  constructor(private readonly runs: SkillRunsService) {}

  @Get()
  async listAll(
    @Query('skillId') skillId?: string,
    @Query('limit') limitQ?: string,
  ) {
    const limit = limitQ ? Number(limitQ) : undefined;
    return ok(await this.runs.list({ skillId, limit }));
  }

  @Get(':runId')
  async get(@Param('runId') runId: string) {
    return ok(await this.runs.get(runId));
  }

  @Post(':runId/cancel')
  async cancel(@Param('runId') runId: string) {
    return ok(await this.runs.cancel(runId));
  }

  @Get(':runId/stream')
  async stream(@Param('runId') runId: string, @Res() res: Response): Promise<void> {
    const snapshot = await this.runs.get(runId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (type: string, data: unknown): void => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send('snapshot', snapshot);

    const onEvent = (event: SkillRunEvent): void => {
      send(event.type, event);
      if (event.type === 'succeeded' || event.type === 'failed' || event.type === 'cancelled') {
        this.runs.events.off(`run:${runId}`, onEvent);
        res.end();
      }
    };

    this.runs.events.on(`run:${runId}`, onEvent);

    // If the run already reached a terminal state before the client
    // subscribed, close immediately so the consumer doesn't hang.
    if (
      snapshot.status === 'succeeded' ||
      snapshot.status === 'failed' ||
      snapshot.status === 'cancelled'
    ) {
      this.runs.events.off(`run:${runId}`, onEvent);
      res.end();
      return;
    }

    const keepalive = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);

    res.on('close', () => {
      clearInterval(keepalive);
      this.runs.events.off(`run:${runId}`, onEvent);
    });
  }
}
