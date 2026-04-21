import { runAgentStream } from '@cepage/agent-core';
import type { AgentAdapterEvent } from '@cepage/agent-core';
import type {
  AgentRuntime,
  AgentType,
  AgentModelRef,
  AgentPromptPart,
  AgentToolsetId,
  AgentKernelRecallEntry,
  AgentDelegationContext,
  WakeReason,
  DaemonClaimJob,
  DaemonJobStartResponse,
  DaemonMessage,
  DaemonMessageType,
  RuntimeProcessSpec,
} from '@cepage/shared-core';
import { type DaemonApiClient } from './client.js';
import { EventBatcher } from './event-batcher.js';
import type { Logger } from './logger.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { WorkspaceManager } from './workspace.js';

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_SIZE = 64;

export type JobRunnerOptions = {
  client: DaemonApiClient;
  workspace: WorkspaceManager;
  logger: Logger;
  runtimeRegistry: RuntimeRegistry;
  flushIntervalMs?: number;
  maxBatchSize?: number;
};

type AgentRunPayload = {
  mode: 'graph' | 'execution';
  sessionId: string;
  runId: string;
  executionId?: string;
  rootNodeId: string;
  outputNodeId?: string;
  type: AgentType;
  model?: AgentModelRef;
  seedNodeIds: string[];
  role: string;
  wakeReason: WakeReason;
  startedAtIso: string;
  cwd: string;
  promptText: string;
  parts?: AgentPromptPart[];
  externalSessionId?: string;
  toolset?: AgentToolsetId;
  recall?: AgentKernelRecallEntry[];
  delegation?: AgentDelegationContext;
};

type WorkflowCopilotRunPayload = {
  sessionId: string;
  threadId: string;
  type: AgentType;
  model?: AgentModelRef;
  cwd: string;
  promptText: string;
  parts?: AgentPromptPart[];
  externalSessionId?: string;
  toolset?: AgentToolsetId;
  recall?: AgentKernelRecallEntry[];
  role: string;
  wakeReason: WakeReason;
  startedAtIso: string;
  connection?: { port?: number; hostname?: string };
};

export class JobRunner {
  constructor(private readonly options: JobRunnerOptions) {}

  async run(job: DaemonClaimJob, signal: AbortSignal): Promise<void> {
    if (job.kind === 'agent_run') {
      await this.runAgentJob(job, signal);
      return;
    }
    if (job.kind === 'workflow_copilot_run') {
      await this.runWorkflowCopilotJob(job, signal);
      return;
    }
    if (
      job.kind === 'runtime_start'
      || job.kind === 'runtime_stop'
      || job.kind === 'runtime_restart'
    ) {
      await this.runRuntimeJob(job, signal);
      return;
    }
    await this.options.client.fail(
      job.id,
      job.leaseToken,
      `DAEMON_JOB_KIND_UNSUPPORTED:${job.kind}`,
    );
  }

  private async runAgentJob(job: DaemonClaimJob, signal: AbortSignal): Promise<void> {
    const payload = job.payload as AgentRunPayload;
    if (!payload || typeof payload !== 'object') {
      await this.options.client.fail(job.id, job.leaseToken, 'DAEMON_AGENT_PAYLOAD_INVALID');
      return;
    }
    const cwd = this.options.workspace.resolveCwd(payload.sessionId, payload.cwd);
    const runtime: AgentRuntime = { kind: 'local_process', cwd };
    const batcher = new EventBatcher({
      flushIntervalMs: this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      maxBatchSize: this.options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      flush: async (messages) => {
        try {
          await this.options.client.reportMessages(job.id, job.leaseToken, messages);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.options.logger.warn('daemon failed to report messages', {
            jobId: job.id,
            detail,
          });
          throw error;
        }
      },
    });

    const startResponse = await this.options.client.markStarted(job.id, job.leaseToken);
    if (startResponse.kind !== 'agent_run') {
      this.options.logger.warn('daemon agent job got non-agent start response', {
        jobId: job.id,
        responseKind: startResponse.kind,
      });
    }

    let runError: Error | null = null;
    try {
      const stream = runAgentStream({
        sessionId: payload.sessionId,
        type: payload.type,
        runtime,
        role: payload.role,
        model: payload.model,
        workingDirectory: cwd,
        promptText: payload.promptText,
        parts: payload.parts,
        externalSessionId: payload.externalSessionId,
        toolset: payload.toolset,
        recall: payload.recall,
        delegation: payload.delegation,
        wakeReason: payload.wakeReason,
        seedNodeIds: payload.seedNodeIds,
        signal,
      }) as AsyncGenerator<AgentAdapterEvent>;

      for await (const event of stream) {
        const message = adapterEventToMessage(event);
        if (!message) continue;
        batcher.push(message);
        if (event.type === 'error') {
          runError = new Error(event.message);
          break;
        }
      }
    } catch (error) {
      runError = error instanceof Error ? error : new Error(String(error));
    } finally {
      await batcher.close();
    }

    if (runError) {
      const detail = runError.message;
      this.options.logger.warn('daemon agent run failed', {
        jobId: job.id,
        runId: payload.runId,
        detail,
      });
      try {
        await this.options.client.fail(job.id, job.leaseToken, detail);
      } catch (failError) {
        this.options.logger.warn('daemon failed to report job failure', {
          jobId: job.id,
          detail: failError instanceof Error ? failError.message : String(failError),
        });
      }
      return;
    }

    try {
      await this.options.client.complete(job.id, job.leaseToken, { runId: payload.runId });
    } catch (error) {
      this.options.logger.warn('daemon failed to mark job complete', {
        jobId: job.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runWorkflowCopilotJob(job: DaemonClaimJob, signal: AbortSignal): Promise<void> {
    const payload = job.payload as WorkflowCopilotRunPayload;
    if (!payload || typeof payload !== 'object') {
      await this.options.client.fail(job.id, job.leaseToken, 'DAEMON_COPILOT_PAYLOAD_INVALID');
      return;
    }
    // Resolve the cwd through the workspace manager so daemons running with a
    // workspace mapping (e.g. host -> container path) still target the right
    // directory on disk.
    const cwd = this.options.workspace.resolveCwd(payload.sessionId, payload.cwd);
    const runtime: AgentRuntime = { kind: 'local_process', cwd };
    const batcher = new EventBatcher({
      flushIntervalMs: this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      maxBatchSize: this.options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      flush: async (messages) => {
        try {
          await this.options.client.reportMessages(job.id, job.leaseToken, messages);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.options.logger.warn('daemon failed to report copilot messages', {
            jobId: job.id,
            detail,
          });
          throw error;
        }
      },
    });

    const startResponse = await this.options.client.markStarted(job.id, job.leaseToken);
    if (startResponse.kind !== 'workflow_copilot_run') {
      this.options.logger.warn('daemon copilot job got non-copilot start response', {
        jobId: job.id,
        responseKind: startResponse.kind,
      });
    }

    let runError: Error | null = null;
    try {
      const stream = runAgentStream({
        sessionId: payload.sessionId,
        type: payload.type,
        runtime,
        role: payload.role,
        model: payload.model,
        workingDirectory: cwd,
        promptText: payload.promptText,
        parts: payload.parts,
        externalSessionId: payload.externalSessionId,
        toolset: payload.toolset,
        recall: payload.recall,
        wakeReason: payload.wakeReason,
        seedNodeIds: [],
        signal,
      }) as AsyncGenerator<AgentAdapterEvent>;

      for await (const event of stream) {
        const message = adapterEventToMessage(event);
        if (!message) continue;
        batcher.push(message);
        if (event.type === 'error') {
          runError = new Error(event.message);
          break;
        }
      }
    } catch (error) {
      runError = error instanceof Error ? error : new Error(String(error));
    } finally {
      await batcher.close();
    }

    if (runError) {
      const detail = runError.message;
      this.options.logger.warn('daemon copilot run failed', {
        jobId: job.id,
        threadId: payload.threadId,
        detail,
      });
      try {
        await this.options.client.fail(job.id, job.leaseToken, detail);
      } catch (failError) {
        this.options.logger.warn('daemon failed to report copilot job failure', {
          jobId: job.id,
          detail: failError instanceof Error ? failError.message : String(failError),
        });
      }
      return;
    }

    try {
      await this.options.client.complete(job.id, job.leaseToken, { threadId: payload.threadId });
    } catch (error) {
      this.options.logger.warn('daemon failed to mark copilot job complete', {
        jobId: job.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runRuntimeJob(job: DaemonClaimJob, signal: AbortSignal): Promise<void> {
    let startResponse: DaemonJobStartResponse;
    try {
      startResponse = await this.options.client.markStarted(job.id, job.leaseToken);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.logger.warn('daemon runtime markStarted failed', {
        jobId: job.id,
        kind: job.kind,
        detail,
      });
      return;
    }
    if (startResponse.kind === 'agent_run') {
      await this.options.client.fail(
        job.id,
        job.leaseToken,
        `DAEMON_RUNTIME_RESPONSE_MISMATCH:${job.kind}`,
      );
      return;
    }
    if (job.kind === 'runtime_start' && startResponse.kind === 'runtime_start') {
      await this.handleRuntimeStart(job, startResponse, signal);
      return;
    }
    if (job.kind === 'runtime_stop' && startResponse.kind === 'runtime_stop') {
      await this.handleRuntimeStop(job, startResponse.runNodeId);
      return;
    }
    if (job.kind === 'runtime_restart' && startResponse.kind === 'runtime_restart') {
      // Restart is handled as a stop on the daemon side; the API will queue
      // a fresh runtime_start once we report completion.
      await this.handleRuntimeStop(job, startResponse.runNodeId);
      return;
    }
    await this.options.client.fail(
      job.id,
      job.leaseToken,
      `DAEMON_RUNTIME_RESPONSE_MISMATCH:${job.kind}/${startResponse.kind}`,
    );
  }

  private async handleRuntimeStart(
    job: DaemonClaimJob,
    response: Extract<DaemonJobStartResponse, { kind: 'runtime_start' }>,
    signal: AbortSignal,
  ): Promise<void> {
    if (!response.spec) {
      // API resolved this start without spawn (reuse, static_web, planned, ...)
      // and already finalized the job server-side. Nothing to do.
      return;
    }
    if (!response.runNodeId) {
      await this.options.client.fail(job.id, job.leaseToken, 'DAEMON_RUNTIME_RUNNODE_MISSING');
      return;
    }
    await this.spawnRuntimeProcess({
      job,
      runNodeId: response.runNodeId,
      spec: response.spec,
      signal,
    });
  }

  /**
   * Spawn the runtime process in fire-and-forget mode.  The daemon's poll
   * loop must stay free to claim subsequent runtime_stop / runtime_restart
   * jobs, so we attach a finalizer on registry.onExit that reports complete
   * (or fail) back to the API once the process actually terminates.
   */
  private async spawnRuntimeProcess(args: {
    job: DaemonClaimJob;
    runNodeId: string;
    spec: RuntimeProcessSpec;
    signal: AbortSignal;
  }): Promise<void> {
    const { job, runNodeId, spec, signal } = args;
    const batcher = new EventBatcher({
      flushIntervalMs: this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      maxBatchSize: this.options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      flush: async (messages) => {
        try {
          await this.options.client.reportMessages(job.id, job.leaseToken, messages);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.options.logger.warn('daemon failed to report runtime messages', {
            jobId: job.id,
            runNodeId,
            detail,
          });
          throw error;
        }
      },
    });
    let lastError: string | null = null;
    const onAbort = (): void => {
      void this.options.runtimeRegistry.stop(runNodeId).catch(() => undefined);
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    this.options.runtimeRegistry.start({
      runNodeId,
      spec,
      handlers: {
        onStdout: (chunk) => batcher.push(makeMessage('stdout', { chunk })),
        onStderr: (chunk) => batcher.push(makeMessage('stderr', { chunk })),
        onStatus: (status, detail) => {
          const payload: Record<string, unknown> = { status };
          if (detail?.pid !== undefined) payload.pid = detail.pid;
          if (detail?.message !== undefined) payload.message = detail.message;
          batcher.push(makeMessage('status', payload));
        },
        onError: (message) => {
          lastError = message;
          batcher.push(makeMessage('error', { message }));
        },
        onExit: (info) => {
          // Fire the finalization async so we don't block the registry's
          // exit dispatcher.  Errors here are logged but not surfaced.
          void this.finalizeRuntimeStart({
            job,
            runNodeId,
            batcher,
            signal,
            onAbort,
            lastError: () => lastError,
            info,
          });
        },
      },
    });
  }

  private async finalizeRuntimeStart(args: {
    job: DaemonClaimJob;
    runNodeId: string;
    batcher: EventBatcher;
    signal: AbortSignal;
    onAbort: () => void;
    lastError: () => string | null;
    info: { exitCode: number | null; signal: NodeJS.Signals | null };
  }): Promise<void> {
    const { job, runNodeId, batcher, signal, onAbort, lastError, info } = args;
    if (!signal.aborted) {
      signal.removeEventListener('abort', onAbort);
    }
    try {
      await batcher.close();
    } catch (error) {
      this.options.logger.warn('daemon runtime batcher close failed', {
        jobId: job.id,
        runNodeId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    const errMessage = lastError();
    if (errMessage && info.exitCode === null && !info.signal) {
      try {
        await this.options.client.fail(job.id, job.leaseToken, errMessage);
      } catch (failError) {
        this.options.logger.warn('daemon failed to fail runtime job', {
          jobId: job.id,
          runNodeId,
          detail: failError instanceof Error ? failError.message : String(failError),
        });
      }
      return;
    }
    try {
      await this.options.client.complete(job.id, job.leaseToken, {
        runNodeId,
        exitCode: info.exitCode,
        signal: info.signal,
      });
    } catch (error) {
      this.options.logger.warn('daemon failed to complete runtime job', {
        jobId: job.id,
        runNodeId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleRuntimeStop(job: DaemonClaimJob, runNodeId: string): Promise<void> {
    if (!runNodeId) {
      await this.options.client.fail(job.id, job.leaseToken, 'DAEMON_RUNTIME_RUNNODE_MISSING');
      return;
    }
    const result = await this.options.runtimeRegistry.stop(runNodeId);
    try {
      await this.options.client.complete(job.id, job.leaseToken, {
        runNodeId,
        stopped: result.stopped,
        exitCode: result.exitCode,
        signal: result.signal,
      });
    } catch (error) {
      this.options.logger.warn('daemon failed to complete runtime stop job', {
        jobId: job.id,
        runNodeId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function makeMessage(type: DaemonMessageType, payload: Record<string, unknown>): DaemonMessage {
  return { eventAt: new Date().toISOString(), type, payload };
}

export function adapterEventToMessage(event: AgentAdapterEvent): DaemonMessage | null {
  const eventAt = new Date().toISOString();
  switch (event.type) {
    case 'session':
      return {
        eventAt,
        type: 'session' as DaemonMessageType,
        payload: { externalSessionId: event.externalSessionId },
      };
    case 'stdout':
      return { eventAt, type: 'stdout', payload: { chunk: event.chunk } };
    case 'stderr':
      return { eventAt, type: 'stderr', payload: { chunk: event.chunk } };
    case 'thinking':
      return { eventAt, type: 'thinking', payload: { chunk: event.chunk } };
    case 'status':
      return {
        eventAt,
        type: 'status',
        payload: { status: event.status, message: event.message ?? null },
      };
    case 'snapshot':
      return { eventAt, type: 'snapshot', payload: { output: event.output } };
    case 'artifact_manifest':
      return {
        eventAt,
        type: 'artifact_manifest',
        payload: { manifest: event.manifest as unknown as Record<string, unknown> },
      };
    case 'runtime_hint':
      return {
        eventAt,
        type: 'runtime_hint',
        payload: { hint: event.hint as unknown as Record<string, unknown> },
      };
    case 'file_write':
      return {
        eventAt,
        type: 'file_write',
        payload: { file: event.file as unknown as Record<string, unknown> },
      };
    case 'spawn_request':
      return {
        eventAt,
        type: 'spawn_request',
        payload: { request: event.request as unknown as Record<string, unknown> },
      };
    case 'done':
      return { eventAt, type: 'done', payload: { exitCode: event.exitCode } };
    case 'error':
      return { eventAt, type: 'error', payload: { message: event.message } };
    default:
      return null;
  }
}
