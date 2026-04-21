import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  daemonClaimRequestSchema,
  daemonCompleteRequestSchema,
  daemonFailRequestSchema,
  daemonHeartbeatRequestSchema,
  daemonMessagesRequestSchema,
  daemonRegisterRequestSchema,
  daemonStartRequestSchema,
} from '@cepage/shared-core';
import type { ZodSchema } from 'zod';
import { DaemonDispatchService } from './daemon-dispatch.service';
import { DaemonLocalhostGuard } from './daemon-localhost.guard';
import { DaemonRegistryService } from './daemon-registry.service';

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'DAEMON_PROTOCOL_INVALID',
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        messages: [issue.message],
      })),
    });
  }
  return result.data;
}

@Controller('daemon')
@UseGuards(DaemonLocalhostGuard)
export class DaemonProtocolController {
  constructor(
    private readonly registry: DaemonRegistryService,
    private readonly dispatch: DaemonDispatchService,
  ) {}

  @Post('register')
  @HttpCode(200)
  async register(@Body() body: unknown) {
    const input = parse(daemonRegisterRequestSchema, body);
    await this.registry.register(input);
    return {
      runtimeId: input.runtimeId,
      pollIntervalMs: 500,
      heartbeatIntervalMs: 5_000,
    };
  }

  @Post(':runtimeId/heartbeat')
  @HttpCode(200)
  async heartbeat(@Param('runtimeId') runtimeId: string, @Body() body: unknown) {
    const input = parse(daemonHeartbeatRequestSchema, body ?? {});
    await this.registry.heartbeat({
      runtimeId,
      activeJobId: input.activeJobId,
      load: input.load,
      catalog: input.catalog,
    });
    return { cancelledJobIds: [] };
  }

  @Post(':runtimeId/deregister')
  @HttpCode(204)
  async deregister(@Param('runtimeId') runtimeId: string, @Res() res: Response) {
    await this.registry.deregister(runtimeId);
    res.status(204).send();
  }

  @Post(':runtimeId/claim')
  async claim(
    @Param('runtimeId') runtimeId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const input = parse(daemonClaimRequestSchema, body);
    const job = await this.dispatch.claimNextJobForDaemon(runtimeId, input.supportedAgents);
    if (!job) {
      res.status(204).send();
      return;
    }
    res.status(200).json(job);
  }

  @Post(':runtimeId/jobs/:jobId/start')
  @HttpCode(200)
  async start(
    @Param('runtimeId') runtimeId: string,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(daemonStartRequestSchema, body);
    return this.dispatch.markJobStarted(runtimeId, jobId, input.leaseToken);
  }

  @Post(':runtimeId/jobs/:jobId/messages')
  @HttpCode(204)
  async messages(
    @Param('runtimeId') runtimeId: string,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const input = parse(daemonMessagesRequestSchema, body);
    await this.dispatch.reportMessages(runtimeId, jobId, input.leaseToken, input.messages);
    res.status(204).send();
  }

  @Post(':runtimeId/jobs/:jobId/complete')
  @HttpCode(204)
  async complete(
    @Param('runtimeId') runtimeId: string,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const input = parse(daemonCompleteRequestSchema, body);
    await this.dispatch.completeJob(runtimeId, jobId, input.leaseToken, input.result);
    res.status(204).send();
  }

  @Post(':runtimeId/jobs/:jobId/fail')
  @HttpCode(204)
  async fail(
    @Param('runtimeId') runtimeId: string,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const input = parse(daemonFailRequestSchema, body);
    await this.dispatch.failJob(runtimeId, jobId, input.leaseToken, input.error);
    res.status(204).send();
  }
}
