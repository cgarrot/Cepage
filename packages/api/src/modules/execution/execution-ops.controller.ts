import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { SchedulerService } from './scheduler.service';
import { WatchSubscriptionService } from './watch-subscription.service';
import { WorkerRegistryService } from './worker-registry.service';

type DaemonStatusRuntime = {
  id: string;
  lastSeenAt: string;
  host: string | null;
  name?: string;
  version?: string;
  supportedAgents?: string[];
};

type DaemonStatusBody = {
  online: boolean;
  count: number;
  lastSeenAt: string | null;
  runtimes: DaemonStatusRuntime[];
};

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? filtered : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

@Controller()
export class ExecutionOpsController {
  constructor(
    private readonly workers: WorkerRegistryService,
    private readonly scheduler: SchedulerService,
    private readonly watches: WatchSubscriptionService,
  ) {}

  @Get('execution/workers')
  listWorkers() {
    return this.workers.listWorkers();
  }

  @Get('execution/daemon/status')
  async daemonStatus() {
    const summary = await this.workers.summarizeRunningWorkers('daemon');
    const body: DaemonStatusBody = {
      online: summary.online,
      count: summary.count,
      lastSeenAt: summary.lastSeenAt ? summary.lastSeenAt.toISOString() : null,
      runtimes: summary.runtimes.map((runtime) => ({
        id: runtime.id,
        lastSeenAt: runtime.lastSeenAt.toISOString(),
        host: runtime.host,
        name: pickString(runtime.metadata?.['name']),
        version: pickString(runtime.metadata?.['version']),
        supportedAgents: pickStringArray(runtime.metadata?.['supportedAgents']),
      })),
    };
    return ok(body);
  }

  @Post('sessions/:sessionId/triggers/scheduled')
  createScheduledTrigger(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    const ownerNodeId = typeof (body as { ownerNodeId?: unknown } | null)?.ownerNodeId === 'string'
      ? ((body as { ownerNodeId: string }).ownerNodeId)
      : null;
    const cron = typeof (body as { cron?: unknown } | null)?.cron === 'string'
      ? ((body as { cron: string }).cron)
      : null;
    const label = typeof (body as { label?: unknown } | null)?.label === 'string'
      ? ((body as { label: string }).label)
      : undefined;
    const payload =
      (body as { payload?: unknown } | null)?.payload && typeof (body as { payload?: unknown }).payload === 'object'
        ? ((body as { payload: Record<string, unknown> }).payload)
        : undefined;
    if (!ownerNodeId || !cron) {
      throw new BadRequestException('SCHEDULED_TRIGGER_INVALID');
    }
    return this.scheduler.register({
      sessionId,
      ownerNodeId,
      cron,
      label,
      payload,
    });
  }

  @Post('sessions/:sessionId/watch-subscriptions')
  createWatchSubscription(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    const kind = typeof (body as { kind?: unknown } | null)?.kind === 'string'
      ? ((body as { kind: string }).kind)
      : null;
    const target = typeof (body as { target?: unknown } | null)?.target === 'string'
      ? ((body as { target: string }).target)
      : null;
    const ownerNodeId = typeof (body as { ownerNodeId?: unknown } | null)?.ownerNodeId === 'string'
      ? ((body as { ownerNodeId: string }).ownerNodeId)
      : undefined;
    const payload =
      (body as { payload?: unknown } | null)?.payload && typeof (body as { payload?: unknown }).payload === 'object'
        ? ((body as { payload: Record<string, unknown> }).payload)
        : undefined;
    if (!kind || !target || !['graph_node', 'graph_branch', 'workspace_path', 'runtime_target'].includes(kind)) {
      throw new BadRequestException('WATCH_SUBSCRIPTION_INVALID');
    }
    return this.watches.create({
      sessionId,
      kind: kind as 'graph_node' | 'graph_branch' | 'workspace_path' | 'runtime_target',
      target,
      ownerNodeId,
      payload,
    });
  }
}
