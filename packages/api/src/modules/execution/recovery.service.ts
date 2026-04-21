import { Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../../common/database/prisma.service';
import { ExecutionQueueService } from './execution-queue.service';
import { RunSupervisorService } from './run-supervisor.service';
import { LeaseService } from './lease.service';
import { WorkerRegistryService } from './worker-registry.service';
import { RuntimeService } from '../runtime/runtime.service';

const ACTIVE_RUN_STATUSES = ['pending', 'booting', 'running', 'waiting_input', 'paused'] as const;
const ACTIVE_CONTROLLER_STATUSES = ['pending', 'running', 'retrying'] as const;
const ACTIVE_FLOW_STATUSES = ['queued', 'running', 'waiting'] as const;

@Injectable()
export class RecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ExecutionQueueService,
    private readonly supervisor: RunSupervisorService,
    private readonly leases: LeaseService,
    private readonly workers: WorkerRegistryService,
    private readonly activity: ActivityService,
    private readonly runtime: RuntimeService,
  ) {}

  async recover(): Promise<void> {
    await this.queue.reclaimExpiredJobs();
    await this.leases.expireLeases();
    await this.workers.markLostWorkers();
    await this.reconcileOrphanRuns();
    await this.reconcileRuntimeRuns();
    await this.ensureControllerJobs();
    await this.ensureFlowJobs();
  }

  private async ensureFlowJobs(): Promise<void> {
    const rows = await this.prisma.workflowManagedFlow.findMany({
      where: {
        status: {
          in: [...ACTIVE_FLOW_STATUSES],
        },
      },
      select: {
        id: true,
        sessionId: true,
      },
    });
    for (const row of rows) {
      await this.supervisor.queueFlow(row.sessionId, {
        flowId: row.id,
      });
    }
  }

  private async ensureControllerJobs(): Promise<void> {
    const rows = await this.prisma.workflowControllerState.findMany({
      where: {
        status: {
          in: [...ACTIVE_CONTROLLER_STATUSES],
        },
      },
      select: {
        id: true,
        sessionId: true,
      },
    });
    for (const row of rows) {
      await this.supervisor.queueController(row.sessionId, {
        controllerId: row.id,
      });
    }
  }

  private async reconcileOrphanRuns(): Promise<void> {
    const rows = await this.prisma.agentRun.findMany({
      where: {
        status: {
          in: [...ACTIVE_RUN_STATUSES],
        },
      },
      select: {
        id: true,
        sessionId: true,
        executionId: true,
        requestId: true,
        startedAt: true,
      },
    });
    for (const row of rows) {
      const job = await this.queue.findByKey(this.supervisor.agentRunKey(row.id));
      if (job) {
        continue;
      }
      if (Date.now() - row.startedAt.getTime() < 5_000) {
        continue;
      }
      await this.prisma.agentRun.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          endedAt: new Date(),
          outputText: `Run recovery marked ${row.id} as orphaned because no execution job was found.`,
          isStreaming: false,
        },
      });
      if (row.executionId) {
        await this.prisma.workflowExecution.updateMany({
          where: {
            id: row.executionId,
          },
          data: {
            status: 'failed',
            endedAt: new Date(),
          },
        });
      }
      await this.activity.log({
        sessionId: row.sessionId,
        eventId: 0,
        actorType: 'system',
        actorId: 'recovery_service',
        runId: row.id,
        requestId: row.requestId ?? undefined,
        summary: `Recovered orphan run ${row.id} as failed`,
        summaryKey: 'activity.run_orphaned',
      });
    }
  }

  private async reconcileRuntimeRuns(): Promise<void> {
    const rows = await this.prisma.session.findMany({
      select: {
        id: true,
      },
    });
    for (const row of rows) {
      await this.runtime.recoverRuns(row.id);
    }
  }
}
