import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  formatAgentSelectionLabel,
  type AgentLifecycleStatus,
  type AgentRun as AgentRunDto,
  type AgentRuntime,
  type DaemonJobStartResponse,
  type DaemonMessage,
  type ExecutionJobKind,
  type RuntimeManifestEnvelope,
} from '@cepage/shared-core';
import { PrismaService } from '../../../common/database/prisma.service';
import { ActivityService } from '../../activity/activity.service';
import { RunArtifactsService } from '../../agents/run-artifacts.service';
import { WorkflowManagedFlowNotifierService } from '../../agents/workflow-managed-flow-notifier.service';
import { CollaborationBusService } from '../../collaboration/collaboration-bus.service';
import { RuntimeService } from '../../runtime/runtime.service';
import {
  agentRunJobPayloadSchema,
  runtimeJobPayloadSchema,
  workflowCopilotRunJobPayloadSchema,
  type AgentRunJobPayload,
  type WorkflowCopilotRunJobPayload,
} from '../execution-job-payload';
import { ExecutionQueueService } from '../execution-queue.service';
import { RunSupervisorService } from '../run-supervisor.service';

/**
 * Async event channel for a workflow_copilot_run job. The daemon pushes
 * DaemonMessage entries via /jobs/:id/messages, and WorkflowCopilotService
 * drains them through CopilotChannel.events(). The channel terminates with
 * either {kind: 'complete'} or {kind: 'fail', error}.
 */
export type CopilotChannelEvent =
  | { kind: 'message'; message: DaemonMessage }
  | { kind: 'complete' }
  | { kind: 'fail'; error: string };

export class CopilotChannel {
  private buffer: CopilotChannelEvent[] = [];
  // Pending consumer waiters. Resolved with `null` to signal end-of-stream.
  private waiters: ((event: CopilotChannelEvent | null) => void)[] = [];
  private finished = false;

  push(message: DaemonMessage): void {
    if (this.finished) return;
    this.deliver({ kind: 'message', message });
  }

  finishComplete(): void {
    if (this.finished) return;
    this.finished = true;
    this.deliver({ kind: 'complete' });
    this.flushEnd();
  }

  finishFail(error: string): void {
    if (this.finished) return;
    this.finished = true;
    this.deliver({ kind: 'fail', error });
    this.flushEnd();
  }

  isFinished(): boolean {
    return this.finished;
  }

  async *events(): AsyncGenerator<CopilotChannelEvent> {
    while (true) {
      if (this.buffer.length > 0) {
        const next = this.buffer.shift() as CopilotChannelEvent;
        yield next;
        if (next.kind === 'complete' || next.kind === 'fail') {
          return;
        }
        continue;
      }
      if (this.finished) {
        // Nothing buffered + finished → terminator already drained.
        return;
      }
      const next = await new Promise<CopilotChannelEvent | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return;
      yield next;
      if (next.kind === 'complete' || next.kind === 'fail') {
        return;
      }
    }
  }

  private deliver(event: CopilotChannelEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    this.buffer.push(event);
  }

  private flushEnd(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(null);
    }
  }
}

export type EnqueueCopilotRunInput = WorkflowCopilotRunJobPayload;
export type EnqueueCopilotRunResult = {
  jobId: string;
  channel: CopilotChannel;
};

export type DaemonClaimedJob = {
  id: string;
  kind: ExecutionJobKind;
  leaseToken: string;
  sessionId?: string;
  runId?: string;
  payload: Record<string, unknown>;
};

export const DAEMON_JOB_KINDS: ExecutionJobKind[] = [
  'agent_run',
  'workflow_copilot_run',
  'runtime_start',
  'runtime_stop',
  'runtime_restart',
];

const PERSIST_DEBOUNCE_MS = 120;

type RunContext = {
  payload: AgentRunJobPayload;
  baseRun: Omit<AgentRunDto, 'status'>;
  selectionLabel: string;
  buffer: string;
  externalSessionId?: string;
  runtimeManifest: RuntimeManifestEnvelope | null;
  fileWrites: { path: string; kind: 'added' | 'modified' | 'deleted' }[];
  streaming: boolean;
  lastPersistedOutput: string;
  lastPersistedStreaming: boolean;
  lastPersistAt: number;
};

type RuntimeJobContext = {
  kind: 'runtime_start' | 'runtime_stop' | 'runtime_restart';
  sessionId: string;
  runNodeId: string;
  // Captured for restart so we can re-enqueue a fresh runtime_start once the
  // daemon has confirmed the previous process is gone.
  targetNodeId?: string;
  approvalId?: string;
};

@Injectable()
export class DaemonDispatchService {
  private readonly log = new Logger(DaemonDispatchService.name);
  private readonly runs = new Map<string, RunContext>();
  private readonly runtimeJobs = new Map<string, RuntimeJobContext>();
  // Active workflow_copilot_run jobs, keyed by job id. Each entry owns a
  // CopilotChannel that WorkflowCopilotService is currently draining.
  private readonly copilotChannels = new Map<string, CopilotChannel>();

  constructor(
    private readonly queue: ExecutionQueueService,
    private readonly prisma: PrismaService,
    private readonly collaboration: CollaborationBusService,
    private readonly activity: ActivityService,
    private readonly runtime: RuntimeService,
    private readonly supervisor: RunSupervisorService,
    private readonly artifacts: RunArtifactsService,
    @Optional()
    private readonly flowNotifier?: WorkflowManagedFlowNotifierService,
  ) {}

  async claimNextJobForDaemon(
    runtimeId: string,
    supportedAgents: AgentRunJobPayload['type'][],
  ): Promise<DaemonClaimedJob | null> {
    // Use the bare runtimeId here: it is the same id the daemon registers as
    // a WorkerNode through DaemonRegistryService.register, and ExecutionJob.workerId
    // has a foreign key to WorkerNode.id. Adding a `daemon:` prefix breaks the FK.
    const job = await this.queue.claimNextJob(runtimeId, {
      includeKinds: DAEMON_JOB_KINDS,
    });
    if (!job || !job.leaseToken) {
      return null;
    }
    if (job.kind === 'agent_run') {
      const parsed = agentRunJobPayloadSchema.safeParse(job.payload);
      if (parsed.success && !supportedAgents.includes(parsed.data.type)) {
        await this.queue.failJob(job, job.leaseToken, `DAEMON_AGENT_UNSUPPORTED:${parsed.data.type}`);
        return null;
      }
    }
    if (job.kind === 'workflow_copilot_run') {
      const parsed = workflowCopilotRunJobPayloadSchema.safeParse(job.payload);
      if (parsed.success && !supportedAgents.includes(parsed.data.type)) {
        await this.queue.failJob(job, job.leaseToken, `DAEMON_AGENT_UNSUPPORTED:${parsed.data.type}`);
        return null;
      }
    }
    return {
      id: job.id,
      kind: job.kind as ExecutionJobKind,
      leaseToken: job.leaseToken,
      sessionId: job.sessionId ?? undefined,
      runId: job.runId ?? undefined,
      payload: (job.payload ?? {}) as Record<string, unknown>,
    };
  }

  /**
   * Enqueue a workflow_copilot_run job and return a CopilotChannel that the
   * caller drains until either {kind: 'complete'} or {kind: 'fail'} arrives.
   * The channel is fed by reportMessages/completeJob/failJob below as the
   * daemon streams events back over the standard job protocol.
   */
  async enqueueCopilotRun(input: EnqueueCopilotRunInput): Promise<EnqueueCopilotRunResult> {
    const key = `workflow_copilot:${input.threadId}:${Date.now()}`;
    const job = await this.queue.ensureJob({
      key,
      kind: 'workflow_copilot_run',
      ownerKind: 'workflow_copilot',
      ownerId: input.threadId,
      sessionId: input.sessionId,
      payload: input,
    });
    const channel = new CopilotChannel();
    this.copilotChannels.set(job.id, channel);
    return { jobId: job.id, channel };
  }

  /**
   * Cancel a running workflow_copilot_run job (e.g. user aborted from the
   * copilot UI). The channel is closed with a synthetic fail so the caller
   * loop terminates promptly even if the daemon has not yet reacted.
   */
  async cancelCopilotRun(jobId: string, reason = 'cancelled'): Promise<void> {
    const channel = this.copilotChannels.get(jobId);
    if (channel) {
      channel.finishFail(reason);
      this.copilotChannels.delete(jobId);
    }
    await this.queue.cancelJob(jobId).catch((error) => {
      this.log.warn(
        `daemon copilot cancelJob failed for ${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async markJobStarted(
    runtimeId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<DaemonJobStartResponse> {
    const job = await this.ensureJob(jobId, leaseToken);
    if (job.kind === 'runtime_start') {
      return this.startRuntimeStartJob(runtimeId, jobId, leaseToken, job.payload);
    }
    if (job.kind === 'runtime_stop') {
      return this.startRuntimeStopJob(jobId, leaseToken, job.payload);
    }
    if (job.kind === 'workflow_copilot_run') {
      // Nothing to materialize server-side; the daemon already has the full
      // payload it needs to drive runAgentStream locally. We simply ack so
      // the daemon proceeds to message streaming.
      void runtimeId;
      return { kind: 'workflow_copilot_run' };
    }
    if (job.kind === 'runtime_restart') {
      return this.startRuntimeRestartJob(jobId, leaseToken, job.payload);
    }
    if (job.kind !== 'agent_run' || !job.runId || !job.sessionId) {
      return { kind: 'agent_run' };
    }
    const parsed = agentRunJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      this.log.warn(`daemon markJobStarted invalid payload for job ${jobId}: ${parsed.error.message}`);
      return { kind: 'agent_run' };
    }
    const payload = parsed.data;
    const runtime: AgentRuntime = { kind: 'local_process', cwd: payload.cwd };
    const baseRun: Omit<AgentRunDto, 'status'> = {
      id: payload.runId,
      sessionId: payload.sessionId,
      ...(payload.executionId ? { executionId: payload.executionId } : {}),
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
      ...(payload.delegation?.parentRunId ? { parentRunId: payload.delegation.parentRunId } : {}),
      type: payload.type,
      role: payload.role,
      runtime,
      wakeReason: payload.wakeReason,
      startedAt: payload.startedAtIso,
      updatedAt: payload.startedAtIso,
      seedNodeIds: payload.seedNodeIds,
      rootNodeId: payload.rootNodeId,
      ...(payload.triggerNodeId ? { triggerNodeId: payload.triggerNodeId } : {}),
      ...(payload.stepNodeId ? { stepNodeId: payload.stepNodeId } : {}),
      ...(payload.model ? { model: payload.model } : {}),
      outputText: '',
      isStreaming: true,
    };
    const ctx: RunContext = {
      payload,
      baseRun,
      selectionLabel: formatAgentSelectionLabel(payload.type, payload.model),
      buffer: '',
      runtimeManifest: null,
      fileWrites: [],
      streaming: true,
      lastPersistedOutput: '',
      lastPersistedStreaming: true,
      lastPersistAt: 0,
    };
    this.runs.set(jobId, ctx);
    await this.prisma.agentRun.update({
      where: { id: payload.runId },
      data: { status: 'running', isStreaming: true },
    });
    if (payload.executionId) {
      await this.prisma.workflowExecution.update({
        where: { id: payload.executionId },
        data: {
          status: 'running',
          currentRunId: payload.runId,
          latestRunId: payload.runId,
          endedAt: null,
        },
      });
    }
    this.emitAgentStatus(ctx, 'running');
    void runtimeId;
    return { kind: 'agent_run' };
  }

  private async startRuntimeStartJob(
    runtimeId: string,
    jobId: string,
    leaseToken: string,
    payload: unknown,
  ): Promise<DaemonJobStartResponse> {
    void runtimeId;
    const parsed = runtimeJobPayloadSchema.safeParse(payload);
    const targetNodeId = parsed.success ? parsed.data.targetNodeId : undefined;
    if (!parsed.success || parsed.data.operation !== 'start' || !targetNodeId) {
      this.log.warn(`daemon runtime_start invalid payload for job ${jobId}: ${parsed.success ? 'missing targetNodeId' : parsed.error.message}`);
      await this.queue.failJob(await this.ensureJob(jobId, leaseToken), leaseToken, 'INVALID_RUNTIME_PAYLOAD');
      return { kind: 'runtime_start', runNodeId: '', plannedReason: 'INVALID_RUNTIME_PAYLOAD' };
    }
    const runtimePayload = parsed.data;
    try {
      const plan = await this.runtime.prepareDaemonRuntimeStart({
        sessionId: runtimePayload.sessionId,
        targetNodeId,
        ...(runtimePayload.approvalId ? { approvalId: runtimePayload.approvalId } : {}),
      });
      if (plan.mode === 'spawn') {
        this.runtimeJobs.set(jobId, {
          kind: 'runtime_start',
          sessionId: runtimePayload.sessionId,
          runNodeId: plan.runNodeId,
          targetNodeId,
        });
        return { kind: 'runtime_start', runNodeId: plan.runNodeId, spec: plan.spec };
      }
      // No spawn needed (reuse, static_web, planned, failed) — finalize the job
      // server-side so the daemon can simply move on.
      const reason =
        plan.mode === 'planned'
          ? plan.reason
          : plan.mode === 'failed'
            ? plan.reason
            : plan.mode;
      if (plan.mode === 'failed') {
        await this.queue.failJob(await this.ensureJob(jobId, leaseToken), leaseToken, reason);
      } else {
        await this.queue.completeJob(jobId, leaseToken, { mode: plan.mode, runNodeId: plan.runNodeId });
      }
      return { kind: 'runtime_start', runNodeId: plan.runNodeId, plannedReason: reason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`daemon runtime_start prepare failed for job ${jobId}: ${message}`);
      await this.queue.failJob(await this.ensureJob(jobId, leaseToken), leaseToken, message);
      return { kind: 'runtime_start', runNodeId: '', plannedReason: message };
    }
  }

  private async startRuntimeStopJob(
    jobId: string,
    leaseToken: string,
    payload: unknown,
  ): Promise<DaemonJobStartResponse> {
    const parsed = runtimeJobPayloadSchema.safeParse(payload);
    const runNodeId = parsed.success ? parsed.data.runNodeId : undefined;
    if (!parsed.success || parsed.data.operation !== 'stop' || !runNodeId) {
      this.log.warn(`daemon runtime_stop invalid payload for job ${jobId}: ${parsed.success ? 'missing runNodeId' : parsed.error.message}`);
      await this.queue.failJob(await this.ensureJob(jobId, leaseToken), leaseToken, 'INVALID_RUNTIME_PAYLOAD');
      return { kind: 'runtime_stop', runNodeId: '' };
    }
    const runtimePayload = parsed.data;
    await this.runtime
      .requestDaemonRuntimeStop(runtimePayload.sessionId, runNodeId)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`daemon runtime_stop persist failed for ${runNodeId}: ${message}`);
      });
    this.runtimeJobs.set(jobId, {
      kind: 'runtime_stop',
      sessionId: runtimePayload.sessionId,
      runNodeId,
    });
    return { kind: 'runtime_stop', runNodeId };
  }

  private async startRuntimeRestartJob(
    jobId: string,
    leaseToken: string,
    payload: unknown,
  ): Promise<DaemonJobStartResponse> {
    const parsed = runtimeJobPayloadSchema.safeParse(payload);
    const runNodeId = parsed.success ? parsed.data.runNodeId : undefined;
    if (!parsed.success || parsed.data.operation !== 'restart' || !runNodeId) {
      this.log.warn(`daemon runtime_restart invalid payload for job ${jobId}: ${parsed.success ? 'missing runNodeId' : parsed.error.message}`);
      await this.queue.failJob(await this.ensureJob(jobId, leaseToken), leaseToken, 'INVALID_RUNTIME_PAYLOAD');
      return { kind: 'runtime_restart', runNodeId: '' };
    }
    const runtimePayload = parsed.data;
    // Capture targetNodeId before stopping so completeJob can re-enqueue a fresh start.
    let targetNodeId: string | undefined;
    try {
      const summary = await this.runtime.requestDaemonRuntimeStop(runtimePayload.sessionId, runNodeId);
      targetNodeId = summary.targetNodeId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`daemon runtime_restart stop failed for ${runNodeId}: ${message}`);
    }
    this.runtimeJobs.set(jobId, {
      kind: 'runtime_restart',
      sessionId: runtimePayload.sessionId,
      runNodeId,
      ...(targetNodeId ? { targetNodeId } : {}),
    });
    return { kind: 'runtime_restart', runNodeId };
  }

  async reportMessages(
    runtimeId: string,
    jobId: string,
    leaseToken: string,
    messages: DaemonMessage[],
  ): Promise<void> {
    await this.ensureJob(jobId, leaseToken);
    const runtimeCtx = this.runtimeJobs.get(jobId);
    if (runtimeCtx) {
      for (const message of messages) {
        await this.applyRuntimeEvent(runtimeCtx, message);
      }
      void runtimeId;
      return;
    }
    const copilotChannel = this.copilotChannels.get(jobId);
    if (copilotChannel) {
      for (const message of messages) {
        copilotChannel.push(message);
      }
      void runtimeId;
      return;
    }
    const ctx = this.runs.get(jobId);
    if (!ctx) {
      return;
    }
    for (const message of messages) {
      await this.applyEvent(ctx, message);
    }
    await this.persistOutput(ctx, ctx.streaming);
    void runtimeId;
  }

  async completeJob(
    runtimeId: string,
    jobId: string,
    leaseToken: string,
    result?: Record<string, unknown>,
  ): Promise<void> {
    const job = await this.ensureJob(jobId, leaseToken);
    const runtimeCtx = this.runtimeJobs.get(jobId);
    if (runtimeCtx) {
      await this.handleRuntimeJobComplete(runtimeCtx, result);
      this.runtimeJobs.delete(jobId);
      await this.queue.completeJob(jobId, leaseToken, result);
      void runtimeId;
      return;
    }
    const copilotChannel = this.copilotChannels.get(jobId);
    if (copilotChannel) {
      copilotChannel.finishComplete();
      this.copilotChannels.delete(jobId);
      await this.queue.completeJob(jobId, leaseToken, result);
      void runtimeId;
      return;
    }
    const ctx = this.runs.get(jobId);
    if (ctx && job.runId && job.sessionId) {
      ctx.streaming = false;
      await this.persistOutput(ctx, false, true);
      const endedAtDate = new Date();
      const endedAtIso = endedAtDate.toISOString();
      await this.prisma.agentRun.update({
        where: { id: ctx.payload.runId },
        data: {
          status: 'completed',
          endedAt: endedAtDate,
          isStreaming: false,
          outputText: ctx.buffer,
          ...(ctx.externalSessionId ? { externalSessionId: ctx.externalSessionId } : {}),
        },
      });
      if (ctx.payload.executionId) {
        await this.prisma.workflowExecution.update({
          where: { id: ctx.payload.executionId },
          data: {
            status: 'completed',
            currentRunId: ctx.payload.runId,
            latestRunId: ctx.payload.runId,
            endedAt: endedAtDate,
            modelProviderId: ctx.payload.model?.providerID ?? null,
            modelId: ctx.payload.model?.modelID ?? null,
          },
        });
      }
      this.emitAgentStatus(ctx, 'completed', endedAtIso);
      await this.activity
        .log({
          sessionId: ctx.payload.sessionId,
          eventId: 0,
          actorType: 'agent',
          actorId: ctx.payload.runId,
          runId: ctx.payload.runId,
          summary: `${ctx.selectionLabel} run completed`,
          summaryKey: 'activity.agent_completed',
          summaryParams: { label: ctx.selectionLabel },
          relatedNodeIds: ctx.payload.ownerNodeId
            ? [ctx.payload.ownerNodeId]
            : ctx.payload.rootNodeId
              ? [ctx.payload.rootNodeId]
              : [],
        })
        .catch((error) => {
          this.log.warn(
            `daemon completeJob activity log failed for run ${ctx.payload.runId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      const outputNodeId = ctx.payload.outputNodeId ?? ctx.payload.rootNodeId;
      if (outputNodeId) {
        await this.runtime
          .ingestAgentRuntimeOutput({
            sessionId: ctx.payload.sessionId,
            sourceRunId: ctx.payload.runId,
            outputNodeId,
            workspaceRoot: ctx.payload.cwd,
            outputText: ctx.buffer,
            manifest: ctx.runtimeManifest,
          })
          .catch((error) => {
            this.log.warn(
              `daemon runtime ingestion failed for run ${ctx.payload.runId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }
      // Snapshot workspace artifacts after a daemon-driven agent run so the
      // right-rail "Workspace files" panel (driven by workspace_file graph
      // nodes) reflects files the agent actually wrote. Without this, nodes
      // stay in status="declared" forever because no API-side pipeline owned
      // the run. Swallow errors — artifacts are best-effort and should never
      // keep a completed run from being reported.
      const ownerNodeIdForArtifacts = ctx.payload.ownerNodeId ?? ctx.payload.rootNodeId;
      if (ownerNodeIdForArtifacts) {
        try {
          await this.artifacts.finalizeRun(
            ctx.payload.sessionId,
            ctx.payload.executionId,
            ctx.payload.runId,
            ownerNodeIdForArtifacts,
            ctx.payload.cwd,
          );
        } catch (error) {
          this.log.warn(
            `daemon artifacts finalize failed for run ${ctx.payload.runId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    this.runs.delete(jobId);
    await this.queue.completeJob(jobId, leaseToken, result);
    void runtimeId;
  }

  async failJob(
    runtimeId: string,
    jobId: string,
    leaseToken: string,
    error: string,
  ): Promise<void> {
    const job = await this.ensureJob(jobId, leaseToken);
    const runtimeCtx = this.runtimeJobs.get(jobId);
    if (runtimeCtx) {
      await this.runtime
        .recordDaemonRuntimeError(runtimeCtx.sessionId, runtimeCtx.runNodeId, error)
        .catch((logError) => {
          this.log.warn(
            `daemon runtime fail persist failed for ${runtimeCtx.runNodeId}: ${
              logError instanceof Error ? logError.message : String(logError)
            }`,
          );
        });
      this.runtimeJobs.delete(jobId);
      const status = await this.queue.failJob(job, leaseToken, error);
      this.log.warn(`daemon reported runtime failure for job ${jobId} (${status}): ${error}`);
      void runtimeId;
      return;
    }
    const copilotChannel = this.copilotChannels.get(jobId);
    if (copilotChannel) {
      copilotChannel.finishFail(error);
      this.copilotChannels.delete(jobId);
      const status = await this.queue.failJob(job, leaseToken, error);
      this.log.warn(`daemon reported copilot failure for job ${jobId} (${status}): ${error}`);
      void runtimeId;
      return;
    }
    const ctx = this.runs.get(jobId);
    // Reactive model fallback. When the failing run has a fallback chain with
    // a next entry and the error class is retryable, we requeue a sibling run
    // instead of surfacing the failure to the user. The current (failed) run
    // is still finalized below so the UI shows a clear audit trail of what
    // was tried; the new run is linked via `retryOfRunId` for lineage.
    const retryable = !!ctx && shouldRetryWithNextModel(ctx.payload, error);
    if (ctx && job.runId && job.sessionId) {
      ctx.streaming = false;
      await this.persistOutput(ctx, false, true);
      const cancelled = isCancelledError(error);
      const finalStatus: AgentLifecycleStatus = cancelled ? 'cancelled' : 'failed';
      const endedAtDate = new Date();
      const endedAtIso = endedAtDate.toISOString();
      await this.prisma.agentRun.update({
        where: { id: ctx.payload.runId },
        data: {
          status: finalStatus,
          endedAt: endedAtDate,
          isStreaming: false,
          outputText: ctx.buffer,
          ...(ctx.externalSessionId ? { externalSessionId: ctx.externalSessionId } : {}),
        },
      });
      if (ctx.payload.executionId) {
        await this.prisma.workflowExecution.update({
          where: { id: ctx.payload.executionId },
          data: {
            status: finalStatus,
            currentRunId: ctx.payload.runId,
            latestRunId: ctx.payload.runId,
            endedAt: endedAtDate,
            modelProviderId: ctx.payload.model?.providerID ?? null,
            modelId: ctx.payload.model?.modelID ?? null,
          },
        });
      }
      this.emitAgentStatus(ctx, finalStatus, endedAtIso);
      await this.activity
        .log({
          sessionId: ctx.payload.sessionId,
          eventId: 0,
          actorType: 'agent',
          actorId: ctx.payload.runId,
          runId: ctx.payload.runId,
          summary: cancelled
            ? `${ctx.selectionLabel} run cancelled`
            : `${ctx.selectionLabel} run failed: ${error}`,
          summaryKey: cancelled ? 'activity.agent_cancelled' : 'activity.agent_failed',
          summaryParams: cancelled
            ? { label: ctx.selectionLabel }
            : { label: ctx.selectionLabel, detail: error },
          relatedNodeIds: ctx.payload.ownerNodeId
            ? [ctx.payload.ownerNodeId]
            : ctx.payload.rootNodeId
              ? [ctx.payload.rootNodeId]
              : [],
        })
        .catch((logError) => {
          this.log.warn(
            `daemon failJob activity log failed for run ${ctx.payload.runId}: ${
              logError instanceof Error ? logError.message : String(logError)
            }`,
          );
        });
      // Even on failure or cancellation, snapshot any partial artifacts the
      // agent may have written so the right-rail "Workspace files" panel is
      // not stuck on stale "declared" placeholders. Mirrors the success path
      // in completeJob above.
      const ownerNodeIdForArtifacts = ctx.payload.ownerNodeId ?? ctx.payload.rootNodeId;
      if (ownerNodeIdForArtifacts) {
        try {
          await this.artifacts.finalizeRun(
            ctx.payload.sessionId,
            ctx.payload.executionId,
            ctx.payload.runId,
            ownerNodeIdForArtifacts,
            ctx.payload.cwd,
          );
        } catch (finalizeError) {
          this.log.warn(
            `daemon artifacts finalize (fail path) failed for run ${ctx.payload.runId}: ${
              finalizeError instanceof Error ? finalizeError.message : String(finalizeError)
            }`,
          );
        }
      }
    }
    this.runs.delete(jobId);
    if (retryable && ctx) {
      // We're about to spawn a sibling AgentRun with the next model of the
      // fallback chain. The sibling lives as its own queue job and carries its
      // own attempts counter, so leaving the original job retryable would make
      // the queue re-lease it, respawn the broken primary, and create another
      // sibling at every attempt. Short-circuit the queue retry by marking the
      // original job terminally failed (no backoff, no finishedAt reset), then
      // enqueue the sibling via the supervisor.
      await this.queue.failJobTerminal(job.id, leaseToken, error).catch((failError) => {
        this.log.warn(
          `daemon failJobTerminal failed for ${jobId}: ${
            failError instanceof Error ? failError.message : String(failError)
          }`,
        );
      });
      this.log.warn(`daemon reported failure for job ${jobId} (failed, sibling spawned): ${error}`);
      await this.requeueWithNextModel(ctx.payload, error).catch((requeueError) => {
        this.log.error(
          `[agent-fallback] requeue after run ${ctx.payload.runId} failed: ${
            requeueError instanceof Error ? requeueError.message : String(requeueError)
          }`,
        );
      });
    } else {
      const status = await this.queue.failJob(job, leaseToken, error);
      this.log.warn(`daemon reported failure for job ${jobId} (${status}): ${error}`);
    }
    void runtimeId;
  }

  /**
   * Spawn a sibling AgentRun pointing at the next entry of the fallback chain
   * and queue it. The caller has already finalized the failed run; we create a
   * new row with a fresh runId, the next model, and link to the failed one via
   * `retryOfRunId`. We reuse the original payload for prompt/parts/cwd/etc —
   * only the runId and model change.
   */
  private async requeueWithNextModel(
    failedPayload: AgentRunJobPayload,
    error: string,
  ): Promise<void> {
    const chain = failedPayload.fallbackChain ?? [];
    const nextIndex = (failedPayload.fallbackIndex ?? 0) + 1;
    const nextEntry = chain[nextIndex];
    if (!nextEntry) return;
    const newRunId = randomUUID();
    const startedAt = new Date();
    await this.prisma.agentRun.create({
      data: {
        id: newRunId,
        sessionId: failedPayload.sessionId,
        executionId: failedPayload.executionId ?? null,
        requestId: failedPayload.requestId ?? null,
        agentType: nextEntry.agentType,
        role: failedPayload.role,
        status: 'booting',
        wakeReason: failedPayload.wakeReason,
        runtime: { kind: 'local_process', cwd: failedPayload.cwd } as object,
        startedAt,
        seedNodeIds: failedPayload.seedNodeIds,
        rootNodeId: failedPayload.rootNodeId,
        triggerNodeId: failedPayload.triggerNodeId ?? null,
        stepNodeId: failedPayload.stepNodeId ?? null,
        retryOfRunId: failedPayload.runId,
        modelProviderId: nextEntry.providerID,
        modelId: nextEntry.modelID,
        outputText: '',
        isStreaming: true,
      },
    });
    if (failedPayload.executionId) {
      await this.prisma.workflowExecution.update({
        where: { id: failedPayload.executionId },
        data: {
          status: 'booting',
          currentRunId: newRunId,
          latestRunId: newRunId,
          endedAt: null,
          modelProviderId: nextEntry.providerID,
          modelId: nextEntry.modelID,
        },
      });
    }
    const nextPayload: AgentRunJobPayload = {
      ...failedPayload,
      runId: newRunId,
      type: nextEntry.agentType,
      model: {
        providerID: nextEntry.providerID,
        modelID: nextEntry.modelID,
      },
      fallbackIndex: nextIndex,
      startedAtIso: startedAt.toISOString(),
    };
    await this.supervisor.queueAgentRun(nextPayload);
    this.log.log(
      `[agent-fallback] run ${failedPayload.runId} failed with "${error}"; retrying as ${newRunId} ` +
        `with ${nextEntry.providerID}/${nextEntry.modelID} (chain ${nextIndex + 1}/${chain.length})`,
    );
    // Surface the switch on the user-facing activity feed so the UI can
    // render "Fell back from X → Y (reason)" inline with the execution
    // block. We attach the event to the FAILED run (failedPayload.runId) so
    // the execution selector can group it with the right siblings chain; the
    // metadata carries the new runId for forward-navigation.
    const activityEvent = buildFallbackActivityEvent({
      failedPayload,
      error,
      nextEntry,
      nextIndex,
      chainLength: chain.length,
      newRunId,
    });
    await this.activity.log(activityEvent).catch((activityError) => {
      this.log.warn(
        `[agent-fallback] activity.log failed for run ${failedPayload.runId}: ${
          activityError instanceof Error ? activityError.message : String(activityError)
        }`,
      );
    });
  }

  private async ensureJob(jobId: string, leaseToken: string) {
    const job = await this.queue.findById(jobId);
    if (!job) throw new NotFoundException('DAEMON_JOB_NOT_FOUND');
    if (job.leaseToken !== leaseToken) {
      throw new NotFoundException('DAEMON_LEASE_INVALID');
    }
    return job;
  }

  private async applyRuntimeEvent(ctx: RuntimeJobContext, message: DaemonMessage): Promise<void> {
    if (message.type === 'stdout') {
      const chunk = typeof message.payload.chunk === 'string' ? message.payload.chunk : '';
      if (chunk) {
        await this.runtime.recordDaemonRuntimeLog(ctx.sessionId, ctx.runNodeId, chunk, 'stdout');
      }
      return;
    }
    if (message.type === 'stderr') {
      const chunk = typeof message.payload.chunk === 'string' ? message.payload.chunk : '';
      if (chunk) {
        await this.runtime.recordDaemonRuntimeLog(ctx.sessionId, ctx.runNodeId, chunk, 'stderr');
      }
      return;
    }
    if (message.type === 'status') {
      const status = typeof message.payload.status === 'string' ? message.payload.status : undefined;
      const pidValue = message.payload.pid;
      const pid = typeof pidValue === 'number' && Number.isFinite(pidValue) ? pidValue : undefined;
      if (status === 'started') {
        await this.runtime.recordDaemonRuntimeStarted(ctx.sessionId, ctx.runNodeId, pid);
      } else if (status === 'ready') {
        await this.runtime.recordDaemonRuntimeReadiness(ctx.sessionId, ctx.runNodeId, 'running');
      } else if (status === 'unready') {
        const errorMessage = typeof message.payload.message === 'string' ? message.payload.message : undefined;
        await this.runtime.recordDaemonRuntimeReadiness(ctx.sessionId, ctx.runNodeId, 'error', errorMessage);
      }
      return;
    }
    if (message.type === 'error') {
      const detail = typeof message.payload.message === 'string' ? message.payload.message : 'DAEMON_RUNTIME_ERROR';
      this.log.warn(`daemon runtime ${ctx.runNodeId} reported error: ${detail}`);
      return;
    }
    // snapshot/session/file_write/runtime_hint/spawn_request/artifact_manifest/done
    // are agent-only or not meaningful for runtime jobs.
  }

  private async handleRuntimeJobComplete(
    ctx: RuntimeJobContext,
    result?: Record<string, unknown>,
  ): Promise<void> {
    const exitCodeRaw = result?.exitCode;
    const exitCode = typeof exitCodeRaw === 'number' && Number.isFinite(exitCodeRaw) ? exitCodeRaw : null;
    const signalRaw = result?.signal;
    const signal = typeof signalRaw === 'string' ? signalRaw : null;
    if (ctx.kind === 'runtime_start') {
      await this.runtime.recordDaemonRuntimeExit(ctx.sessionId, ctx.runNodeId, exitCode, signal);
      return;
    }
    if (ctx.kind === 'runtime_stop') {
      await this.runtime
        .requestDaemonRuntimeStop(ctx.sessionId, ctx.runNodeId)
        .catch((error) => {
          this.log.warn(
            `daemon runtime_stop final persist failed for ${ctx.runNodeId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return;
    }
    if (ctx.kind === 'runtime_restart') {
      // The previous process is gone; queue a fresh start so the run resumes.
      if (ctx.targetNodeId) {
        await this.supervisor
          .queueRuntime({
            sessionId: ctx.sessionId,
            operation: 'start',
            targetNodeId: ctx.targetNodeId,
          })
          .catch((error) => {
            this.log.warn(
              `daemon runtime_restart re-enqueue failed for ${ctx.runNodeId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      } else {
        this.log.warn(`daemon runtime_restart missing targetNodeId for run ${ctx.runNodeId}; cannot re-enqueue`);
      }
      return;
    }
  }

  private async applyEvent(ctx: RunContext, message: DaemonMessage): Promise<void> {
    if (message.type === 'stdout') {
      const chunk = typeof message.payload.chunk === 'string' ? message.payload.chunk : '';
      ctx.buffer += chunk;
      await this.persistOutput(ctx, true);
      return;
    }
    if (message.type === 'stderr') {
      const chunk = typeof message.payload.chunk === 'string' ? message.payload.chunk : '';
      ctx.buffer += `\n[stderr] ${chunk}`;
      await this.persistOutput(ctx, true, true);
      return;
    }
    if (message.type === 'snapshot') {
      const output = typeof message.payload.output === 'string' ? message.payload.output : '';
      if (output && output !== ctx.buffer) {
        ctx.buffer = output;
        await this.persistOutput(ctx, true, true);
      }
      return;
    }
    if (message.type === 'session') {
      const externalSessionId = typeof message.payload.externalSessionId === 'string'
        ? message.payload.externalSessionId
        : undefined;
      if (externalSessionId) {
        ctx.externalSessionId = externalSessionId;
        await this.prisma.agentRun.update({
          where: { id: ctx.payload.runId },
          data: { externalSessionId },
        });
      }
      return;
    }
    if (message.type === 'status') {
      // Lifecycle status hints come through markStarted/complete/fail; nothing to persist mid-stream.
      return;
    }
    if (message.type === 'error') {
      const detail = typeof message.payload.message === 'string' ? message.payload.message : 'DAEMON_AGENT_ERROR';
      this.log.warn(`daemon reported error for run ${ctx.payload.runId}: ${detail}`);
      return;
    }
    if (message.type === 'artifact_manifest') {
      const raw = message.payload.manifest;
      if (raw && typeof raw === 'object') {
        ctx.runtimeManifest = raw as RuntimeManifestEnvelope;
      }
      return;
    }
    if (message.type === 'file_write') {
      const file = message.payload.file;
      if (file && typeof file === 'object') {
        const entry = file as { path?: unknown; kind?: unknown };
        if (typeof entry.path === 'string'
          && (entry.kind === 'added' || entry.kind === 'modified' || entry.kind === 'deleted')) {
          ctx.fileWrites.push({ path: entry.path, kind: entry.kind });
        }
      }
      return;
    }
    if (message.type === 'runtime_hint') {
      // Runtime hints are advisory; daemon does not need to persist them yet.
      return;
    }
    if (message.type === 'spawn_request') {
      // Spawn requests will be implemented alongside runtime jobs in Phase 2d.
      return;
    }
    if (message.type === 'done') {
      // Exit code is informational; lifecycle close is driven by completeJob/failJob.
      return;
    }
  }

  private async persistOutput(
    ctx: RunContext,
    streaming: boolean,
    force = false,
  ): Promise<void> {
    if (!force) {
      if (ctx.buffer === ctx.lastPersistedOutput && streaming === ctx.lastPersistedStreaming) {
        return;
      }
      if (Date.now() - ctx.lastPersistAt < PERSIST_DEBOUNCE_MS) {
        return;
      }
    }
    ctx.lastPersistedOutput = ctx.buffer;
    ctx.lastPersistedStreaming = streaming;
    ctx.lastPersistAt = Date.now();
    await this.prisma.agentRun.update({
      where: { id: ctx.payload.runId },
      data: { outputText: ctx.buffer, isStreaming: streaming },
    });
    this.collaboration.emitSession(ctx.payload.sessionId, {
      type: 'agent.output_chunk',
      eventId: 0,
      sessionId: ctx.payload.sessionId,
      runId: ctx.payload.runId,
      actor: { type: 'agent', id: ctx.payload.runId },
      timestamp: new Date().toISOString(),
      payload: {
        agentRunId: ctx.payload.runId,
        ...(ctx.payload.executionId ? { executionId: ctx.payload.executionId } : {}),
        output: ctx.buffer,
        isStreaming: streaming,
      },
    });
  }

  private emitAgentStatus(
    ctx: RunContext,
    status: AgentLifecycleStatus,
    endedAtIso?: string,
  ): void {
    const payload: AgentRunDto = {
      ...ctx.baseRun,
      status,
      ...(endedAtIso ? { endedAt: endedAtIso } : {}),
      outputText: ctx.buffer,
      isStreaming: status === 'running',
      ...(ctx.externalSessionId ? { externalSessionId: ctx.externalSessionId } : {}),
    };
    this.collaboration.emitSession(ctx.payload.sessionId, {
      type: 'agent.status',
      eventId: 0,
      sessionId: ctx.payload.sessionId,
      runId: ctx.payload.runId,
      actor: { type: 'agent', id: ctx.payload.runId },
      timestamp: new Date().toISOString(),
      payload,
    });
    this.flowNotifier?.notifyAgentStatus(ctx.payload.sessionId, payload);
  }
}

function isCancelledError(error: string): boolean {
  if (!error) return false;
  return /^cancel/i.test(error)
    || /aborted/i.test(error)
    || error === 'AbortError';
}

/**
 * Deny-list of error classes where falling back to another model is pointless
 * (permanent / user-driven failures). Everything else is assumed retryable so
 * transient upstream failures (5xx, rate limits, timeouts, daemon-side
 * provider hiccups, missing adapters on this daemon, etc.) trigger the
 * sibling model.
 */
const NON_RETRYABLE_ERROR_PATTERNS: RegExp[] = [
  /^cancel/i,
  /aborted/i,
  /^AbortError$/,
  /RUN_CANCELLED/,
  // Authentication / authorization problems are the user's config to fix —
  // trying the next provider would just fail with the same creds missing.
  /\b401\b/,
  /\b403\b/,
  /unauthorized/i,
  /forbidden/i,
  /invalid[_\s-]?api[_\s-]?key/i,
  /authentication/i,
  // Schema / validation failures are deterministic.
  /ZodError/,
  /schema validation/i,
];

function isRetryableModelFailure(error: string): boolean {
  if (!error) return false;
  for (const pattern of NON_RETRYABLE_ERROR_PATTERNS) {
    if (pattern.test(error)) return false;
  }
  return true;
}

/**
 * Returns true when the current payload has a next fallback entry AND the
 * error is classified retryable. Kept as a free function so it can be unit
 * tested without spinning up the full dispatch service.
 */
export function shouldRetryWithNextModel(
  payload: AgentRunJobPayload,
  error: string,
): boolean {
  const chain = payload.fallbackChain ?? [];
  const nextIndex = (payload.fallbackIndex ?? 0) + 1;
  if (chain.length <= nextIndex) return false;
  return isRetryableModelFailure(error);
}

export type FallbackActivityEventInput = {
  failedPayload: AgentRunJobPayload;
  error: string;
  nextEntry: { agentType: string; providerID: string; modelID: string };
  nextIndex: number;
  chainLength: number;
  newRunId: string;
};

/**
 * Pure builder for the `activity.agent_fallback_switch` event logged when a
 * sibling fallback job is spawned. Extracted so tests can lock down the
 * canonical shape (`summaryKey`, `summaryParams`, `metadata.kind`, related
 * nodes, etc.) without having to boot the whole NestJS dispatch service or
 * a Prisma instance.
 */
export function buildFallbackActivityEvent(input: FallbackActivityEventInput): {
  sessionId: string;
  eventId: number;
  actorType: 'agent';
  actorId: string;
  runId: string;
  summary: string;
  summaryKey: 'activity.agent_fallback_switch';
  summaryParams: {
    fromProvider: string;
    fromModel: string;
    toProvider: string;
    toModel: string;
    reason: string;
  };
  relatedNodeIds: string[];
  metadata: {
    kind: 'agent_fallback_switch';
    nextRunId: string;
    fallbackIndex: number;
    fallbackChainLength: number;
  };
} {
  const { failedPayload, error, nextEntry, nextIndex, chainLength, newRunId } = input;
  const fromProvider = failedPayload.model?.providerID ?? '?';
  const fromModel = failedPayload.model?.modelID ?? '?';
  const toProvider = nextEntry.providerID;
  const toModel = nextEntry.modelID;
  return {
    sessionId: failedPayload.sessionId,
    eventId: 0,
    actorType: 'agent',
    actorId: failedPayload.runId,
    runId: failedPayload.runId,
    summary: `Fallback: ${fromProvider}/${fromModel} → ${toProvider}/${toModel}${
      error ? ` (${error})` : ''
    }`,
    summaryKey: 'activity.agent_fallback_switch',
    summaryParams: {
      fromProvider,
      fromModel,
      toProvider,
      toModel,
      reason: error,
    },
    relatedNodeIds: failedPayload.ownerNodeId ? [failedPayload.ownerNodeId] : [],
    metadata: {
      kind: 'agent_fallback_switch',
      nextRunId: newRunId,
      fallbackIndex: nextIndex,
      fallbackChainLength: chainLength,
    },
  };
}
