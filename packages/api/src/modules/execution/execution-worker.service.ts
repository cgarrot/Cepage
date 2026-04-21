import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getEnv } from '@cepage/config';
import { ActivityService } from '../activity/activity.service';
import { WorkflowControllerService } from '../agents/workflow-controller.service';
import { WorkflowManagedFlowService } from '../agents/workflow-managed-flow.service';
import { ConnectorService } from '../connectors/connector.service';
import { ApprovalService } from './approval.service';
import { DAEMON_JOB_KINDS } from './daemon/daemon-dispatch.service';
import {
  approvalResolutionJobPayloadSchema,
  connectorJobPayloadSchema,
  controllerJobPayloadSchema,
  flowJobPayloadSchema,
  scheduledTriggerJobPayloadSchema,
  watchTriggerJobPayloadSchema,
} from './execution-job-payload';
import { ExecutionQueueService } from './execution-queue.service';
import { RecoveryService } from './recovery.service';
import { SchedulerService } from './scheduler.service';
import { WatchSubscriptionService } from './watch-subscription.service';
import { WorkerRegistryService } from './worker-registry.service';

/**
 * In-process worker that drains the API-owned job kinds.  Daemon-owned kinds
 * (`agent_run`, `runtime_*`) are explicitly excluded from the claim filter so
 * they remain queued until a native daemon picks them up.
 */
@Injectable()
export class ExecutionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ExecutionWorkerService.name);
  private running = false;
  private loop: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private activeJobId: string | undefined;
  private readonly workerId =
    process.env.EXECUTION_WORKER_ID?.trim()
    || `${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly queue: ExecutionQueueService,
    private readonly workers: WorkerRegistryService,
    private readonly recovery: RecoveryService,
    private readonly scheduler: SchedulerService,
    private readonly watches: WatchSubscriptionService,
    private readonly approvals: ApprovalService,
    private readonly controllers: WorkflowControllerService,
    private readonly flows: WorkflowManagedFlowService,
    private readonly connectors: ConnectorService,
    private readonly activity: ActivityService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (getEnv().EXECUTION_WORKER_MODE === 'off') {
      return;
    }
    this.running = true;
    await this.workers.registerWorker({
      workerId: this.workerId,
      kind: 'api',
      metadata: { mode: getEnv().EXECUTION_WORKER_MODE },
    });
    await this.recovery.recover();
    this.heartbeatTimer = setInterval(() => {
      void this.workers.heartbeat({
        workerId: this.workerId,
        activeJobId: this.activeJobId,
        load: { mode: getEnv().EXECUTION_WORKER_MODE },
      });
    }, getEnv().EXECUTION_HEARTBEAT_MS);
    this.schedulerTimer = setInterval(() => {
      void this.scheduler.tick();
    }, getEnv().EXECUTION_SCHEDULER_MS);
    this.loop = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
    }
    await this.workers.markStopped(this.workerId);
    await this.loop;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      const job = await this.queue.claimNextJob(this.workerId, {
        excludeKinds: DAEMON_JOB_KINDS,
      });
      if (!job) {
        await sleep(getEnv().EXECUTION_WORKER_POLL_MS);
        continue;
      }
      this.activeJobId = job.id;
      const leaseToken = job.leaseToken;
      if (!leaseToken) {
        this.activeJobId = undefined;
        continue;
      }
      const beat = setInterval(() => {
        void this.queue.heartbeatJob(job.id, leaseToken);
      }, Math.max(1_000, Math.floor(getEnv().EXECUTION_HEARTBEAT_MS / 2)));
      try {
        await this.logJobEvent(job.sessionId ?? undefined, job.runId ?? undefined, job.requestId ?? undefined, `Worker claimed ${job.kind}`, {
          jobId: job.id,
          workerId: this.workerId,
          ownerId: job.ownerId,
        });
        const result = await this.dispatch(job.kind, job.payload as Record<string, unknown>);
        await this.queue.completeJob(job.id, leaseToken, result);
        await this.logJobEvent(job.sessionId ?? undefined, job.runId ?? undefined, job.requestId ?? undefined, `Worker completed ${job.kind}`, {
          jobId: job.id,
          workerId: this.workerId,
        });
      } catch (errorValue) {
        const detail = errorValue instanceof Error ? errorValue.message : String(errorValue);
        const status = await this.queue.failJob(job, leaseToken, detail);
        await this.logJobEvent(job.sessionId ?? undefined, job.runId ?? undefined, job.requestId ?? undefined, `Worker ${status} ${job.kind}: ${detail}`, {
          jobId: job.id,
          workerId: this.workerId,
        });
        this.log.warn(`${job.kind} ${job.id} ${detail}`);
      } finally {
        clearInterval(beat);
        this.activeJobId = undefined;
      }
    }
  }

  private async dispatch(kind: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    if (DAEMON_JOB_KINDS.includes(kind as (typeof DAEMON_JOB_KINDS)[number])) {
      // Daemon-owned kinds are excluded by the claim filter; reaching this branch
      // means a daemon-owned job leaked into the API loop (race or migration),
      // so fail fast with an actionable message rather than silently no-op.
      throw new Error(`DAEMON_JOB_KIND_REJECTED:${kind}`);
    }
    if (kind === 'workflow_controller') {
      const parsed = controllerJobPayloadSchema.parse(payload);
      return this.controllers.executeQueuedController(parsed.controllerId, this.workerId);
    }
    if (kind === 'workflow_managed_flow') {
      const parsed = flowJobPayloadSchema.parse(payload);
      return this.flows.executeQueuedFlow(parsed.flowId, this.workerId);
    }
    if (kind === 'connector_run') {
      const parsed = connectorJobPayloadSchema.parse(payload);
      return this.connectors.executeQueuedConnectorJob(parsed, this.workerId);
    }
    if (kind === 'scheduled_trigger') {
      const parsed = scheduledTriggerJobPayloadSchema.parse(payload);
      await this.scheduler.executeScheduledTrigger(parsed.triggerId);
      return { triggerId: parsed.triggerId };
    }
    if (kind === 'watch_trigger') {
      const parsed = watchTriggerJobPayloadSchema.parse(payload);
      await this.watches.executeWatchTrigger(parsed.subscriptionId);
      return { subscriptionId: parsed.subscriptionId };
    }
    if (kind === 'approval_resolution') {
      const parsed = approvalResolutionJobPayloadSchema.parse(payload);
      await this.approvals.executeResolution(parsed.approvalId);
      return { approvalId: parsed.approvalId };
    }
    return undefined;
  }

  private async logJobEvent(
    sessionId: string | undefined,
    runId: string | undefined,
    requestId: string | undefined,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!sessionId) {
      return;
    }
    await this.activity.log({
      sessionId,
      eventId: 0,
      actorType: 'system',
      actorId: 'execution_worker',
      runId,
      requestId,
      workerId: this.workerId,
      summary,
      summaryKey: 'activity.worker_event',
      summaryParams: metadata,
      metadata,
    });
  }
}
