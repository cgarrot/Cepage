import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, Optional } from '@nestjs/common';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  applyRuntimeTemplate,
  resolveRuntimeManifestCandidate,
  normalizeManifestValue,
} from './runtime-manifest.util';
import {
  RUNTIME_BIND_HOST,
  buildRunSummary,
  buildRuntimeTargetSeed,
  buildScriptPreviewInfo,
  buildStaticPreviewInfo,
  canReuseRuntimeRun,
  dockerSpawnInput,
  firstHttpPort,
  hasRuntimeEdge,
  isActiveRuntimeRun,
  isDuplicateEdgeError,
  isHttpReady,
  isStaticWebTarget,
  materializePorts,
  mergeRuntimeRun,
  readRuntimeRunFromNode,
  readRuntimeRunHits,
  readRuntimeTargetFromNode,
  readRuntimeTargetHits,
  readStaticEntrypoint,
  recoveredRuntimeRun,
  runtimeRunPosition,
  runtimeTargetPosition,
  sameRuntimeTarget,
  sortRunHits,
  sortTargetHits,
  trimLog,
  type RuntimeTargetSeed,
} from './runtime-run.util';
import {
  type GraphNode,
  type RuntimeExecutionStatus,
  type RuntimeProcessSpec,
  type RuntimeRunSummary,
  type RuntimeTargetSummary,
  type RunnableArtifactManifest,
} from '@cepage/shared-core';
import { GraphService } from '../graph/graph.service';
import type { RuntimeJobPayload } from '../execution/execution-job-payload';
import { ApprovalService } from '../execution/approval.service';
import { RunSupervisorService } from '../execution/run-supervisor.service';
import { resolveWorkspaceFilePath } from '../agents/run-artifacts.util';

type RuntimeProcessState = {
  sessionId: string;
  summary: RuntimeRunSummary;
  child?: ReturnType<typeof spawn>;
  manualStop: boolean;
  pending: Promise<void>;
};

export type DaemonRuntimeStartPlan =
  | { mode: 'reuse'; runNodeId: string; summary: RuntimeRunSummary }
  | { mode: 'static_web'; runNodeId: string; summary: RuntimeRunSummary }
  | { mode: 'planned'; runNodeId: string; reason: string; approvalId?: string }
  | { mode: 'failed'; runNodeId: string; reason: string }
  | { mode: 'spawn'; runNodeId: string; spec: RuntimeProcessSpec; summary: RuntimeRunSummary };

const RUNTIME_READY_TIMEOUT_MS = 60_000;
const RUNTIME_READY_POLL_MS = 1_000;

@Injectable()
export class RuntimeService implements OnModuleDestroy {
  private readonly log = new Logger(RuntimeService.name);
  private readonly runStateByNodeId = new Map<string, RuntimeProcessState>();
  // Tracks runs whose lifecycle is owned by a remote daemon process. We only
  // remember enough to keep `prepareRuntimeRunNode` reuse logic correct; the
  // actual child-process state lives on the daemon.
  private readonly daemonActiveRuns = new Map<string, { sessionId: string }>();

  constructor(
    private readonly graph: GraphService,
    @Optional()
    private readonly supervisor?: RunSupervisorService,
    @Optional()
    private readonly approvals?: ApprovalService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const state of this.runStateByNodeId.values()) {
      state.child?.kill('SIGTERM');
    }
    this.runStateByNodeId.clear();
  }

  async ingestAgentRuntimeOutput(input: {
    sessionId: string;
    sourceRunId: string;
    outputNodeId: string;
    workspaceRoot: string;
    outputText: string;
    manifest?: Parameters<typeof resolveRuntimeManifestCandidate>[0]['eventManifest'];
  }): Promise<{
    targets: RuntimeTargetSummary[];
    runs: RuntimeRunSummary[];
  }> {
    const snapshot = await this.graph.loadSnapshot(input.sessionId);
    const outputNode = snapshot.nodes.find((node) => node.id === input.outputNodeId);
    if (!outputNode) {
      throw new NotFoundException('NODE_NOT_FOUND');
    }

    const existingTargets = snapshot.nodes
      .filter((node) => node.type === 'runtime_target')
      .map(readRuntimeTargetFromNode)
      .filter(
        (summary): summary is RuntimeTargetSummary =>
          Boolean(
            summary &&
              summary.sourceRunId === input.sourceRunId &&
              summary.outputNodeId === input.outputNodeId,
          ),
      );
    if (existingTargets.length > 0) {
      return { targets: existingTargets, runs: [] };
    }

    const candidate = await resolveRuntimeManifestCandidate({
      root: input.workspaceRoot,
      textOutput: input.outputText,
      eventManifest: input.manifest ?? null,
    });
    if (!candidate) {
      return { targets: [], runs: [] };
    }

    const targets: RuntimeTargetSummary[] = [];
    const runs: RuntimeRunSummary[] = [];

    for (const [index, rawManifest] of candidate.envelope.targets.entries()) {
      const manifest = normalizeManifestValue(input.workspaceRoot, rawManifest);
      const targetSummary = await this.upsertRuntimeTargetNode({
        sessionId: input.sessionId,
        outputNode,
        sourceRunId: input.sourceRunId,
        outputNodeId: input.outputNodeId,
        manifest,
        index,
        source: candidate.source,
      });
      targets.push(targetSummary);
      if (targetSummary.autoRun) {
        runs.push(await this.runTarget(input.sessionId, targetSummary.targetNodeId));
      }
    }

    return { targets, runs };
  }

  async runTarget(sessionId: string, targetNodeId: string): Promise<RuntimeRunSummary> {
    if (this.supervisor) {
      return this.queueRuntimeStart(sessionId, targetNodeId);
    }
    return this.startTarget(sessionId, targetNodeId);
  }

  async stopRun(sessionId: string, runNodeId: string): Promise<RuntimeRunSummary> {
    if (this.supervisor && !this.runStateByNodeId.has(runNodeId)) {
      await this.supervisor.queueRuntime({
        sessionId,
        operation: 'stop',
        runNodeId,
      });
      return this.getRuntimeRunSummary(sessionId, runNodeId);
    }
    return this.stopRunNow(sessionId, runNodeId);
  }

  private async stopRunNow(sessionId: string, runNodeId: string): Promise<RuntimeRunSummary> {
    const state = this.runStateByNodeId.get(runNodeId);
    if (state) {
      if (state.sessionId !== sessionId) {
        throw new NotFoundException('RUN_NOT_FOUND');
      }
      state.manualStop = true;
      state.child?.kill('SIGTERM');
      const summary = {
        ...state.summary,
        status: 'stopped' as const,
        endedAt: new Date().toISOString(),
      };
      state.summary = summary;
      await this.patchRuntimeRunNode(sessionId, runNodeId, summary);
      this.runStateByNodeId.delete(runNodeId);
      return summary;
    }

    const summary = await this.getRuntimeRunSummary(sessionId, runNodeId);
    if (summary.status === 'stopped' || summary.status === 'completed' || summary.status === 'failed') {
      return summary;
    }
    const stopped = {
      ...summary,
      status: 'stopped' as const,
      endedAt: summary.endedAt ?? new Date().toISOString(),
    };
    await this.patchRuntimeRunNode(sessionId, runNodeId, stopped);
    return stopped;
  }

  async restartRun(sessionId: string, runNodeId: string): Promise<RuntimeRunSummary> {
    if (this.supervisor && !this.runStateByNodeId.has(runNodeId)) {
      await this.supervisor.queueRuntime({
        sessionId,
        operation: 'restart',
        runNodeId,
      });
      return this.getRuntimeRunSummary(sessionId, runNodeId);
    }
    return this.restartRunNow(sessionId, runNodeId);
  }

  private async restartRunNow(sessionId: string, runNodeId: string): Promise<RuntimeRunSummary> {
    const summary = await this.getRuntimeRunSummary(sessionId, runNodeId);
    if (summary.status === 'running' || summary.status === 'launching') {
      await this.stopRunNow(sessionId, runNodeId);
    }
    return this.startTarget(sessionId, summary.targetNodeId);
  }

  async executeQueuedRuntimeJob(payload: RuntimeJobPayload, _workerId?: string): Promise<Record<string, unknown>> {
    if (payload.operation === 'start' && payload.targetNodeId) {
      const summary = await this.startTarget(payload.sessionId, payload.targetNodeId, payload.approvalId);
      return { runNodeId: summary.runNodeId, status: summary.status };
    }
    if (payload.operation === 'stop' && payload.runNodeId) {
      const summary = await this.stopRunNow(payload.sessionId, payload.runNodeId);
      return { runNodeId: summary.runNodeId, status: summary.status };
    }
    if (payload.operation === 'restart' && payload.runNodeId) {
      const summary = await this.restartRunNow(payload.sessionId, payload.runNodeId);
      return { runNodeId: summary.runNodeId, status: summary.status };
    }
    return {};
  }

  // ---------------------------------------------------------------------------
  // Daemon-mode runtime helpers
  //
  // The legacy worker (`executeQueuedRuntimeJob` -> `startTarget`) materializes
  // the spec AND spawns the child process in this same Node process. The
  // daemon-mode helpers split those concerns: the API materializes the spec and
  // persists run-node state, while a separate daemon process actually spawns
  // and supervises the child. The daemon then reports back via the
  // `recordDaemonRuntime*` hooks below.
  // ---------------------------------------------------------------------------

  async prepareDaemonRuntimeStart(input: {
    sessionId: string;
    targetNodeId: string;
    approvalId?: string;
  }): Promise<DaemonRuntimeStartPlan> {
    const target = await this.getRuntimeTargetSummary(input.sessionId, input.targetNodeId);
    const targetNode = await this.getNode(input.sessionId, input.targetNodeId);
    const ready = await this.prepareRuntimeRunNode(input.sessionId, targetNode, target);
    if (ready.mode === 'reuse') {
      return { mode: 'reuse', runNodeId: ready.summary.runNodeId, summary: ready.summary };
    }
    const runNodeId = ready.runNodeId;

    if (isStaticWebTarget(target)) {
      const preview = buildStaticPreviewInfo(input.sessionId, runNodeId, target);
      const summary: RuntimeRunSummary = {
        ...buildRunSummary(target, runNodeId),
        status: 'running',
        startedAt: new Date().toISOString(),
        entrypoint: readStaticEntrypoint(target),
        preview,
      };
      await this.patchRuntimeRunNode(input.sessionId, runNodeId, summary);
      return { mode: 'static_web', runNodeId, summary };
    }

    const requestedPorts =
      target.ports && target.ports.length > 0
        ? target.ports
        : target.kind === 'web'
          ? [{ name: 'http', port: 0, protocol: 'http' as const }]
          : [];
    const resolvedPorts = await materializePorts(requestedPorts);
    const httpPort = firstHttpPort(resolvedPorts);
    const replacements = {
      HOST: RUNTIME_BIND_HOST,
      PORT: httpPort ? String(httpPort.port) : '',
    };
    const command = target.command ? applyRuntimeTemplate(target.command, replacements) : undefined;
    if (!command) {
      const failed: RuntimeRunSummary = {
        ...buildRunSummary(target, runNodeId),
        status: 'failed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        error: 'Runtime command is required for local_process targets.',
      };
      await this.patchRuntimeRunNode(input.sessionId, runNodeId, failed);
      return { mode: 'failed', runNodeId, reason: failed.error ?? 'COMMAND_REQUIRED' };
    }
    const args = (target.args ?? []).map((entry) => applyRuntimeTemplate(entry, replacements));
    const env = Object.fromEntries(
      Object.entries({
        ...(target.env ?? {}),
        ...(target.docker?.env ?? {}),
      }).map(([key, value]) => [key, applyRuntimeTemplate(value, replacements)]),
    );
    if (target.launchMode === 'docker' && !input.approvalId && this.approvals) {
      const approval = await this.approvals.request({
        sessionId: input.sessionId,
        kind: 'runtime_docker_start',
        title: `Approve Docker runtime ${target.serviceName}`,
        detail: `Launch Docker runtime for ${target.serviceName}`,
        payload: {
          action: 'runtime_start',
          sessionId: input.sessionId,
          targetNodeId: input.targetNodeId,
        },
        requestedByType: 'system',
        requestedById: 'runtime_service',
        sourceNodeId: input.targetNodeId,
      });
      const planned: RuntimeRunSummary = {
        ...buildRunSummary(target, runNodeId),
        status: 'planned',
        startedAt: new Date().toISOString(),
        error: `APPROVAL_REQUIRED:${approval.id}`,
        docker: target.docker,
      };
      await this.patchRuntimeRunNode(input.sessionId, runNodeId, planned);
      return { mode: 'planned', runNodeId, reason: 'APPROVAL_REQUIRED', approvalId: approval.id };
    }
    const preview =
      target.kind === 'web' && httpPort
        ? buildScriptPreviewInfo(httpPort.port)
        : undefined;

    const spawnInput =
      target.launchMode === 'docker'
        ? dockerSpawnInput(target, command, args, env, resolvedPorts)
        : {
            command,
            args,
            cwd: target.cwd,
            env,
          };

    const specEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(spawnInput.env)) {
      if (typeof value === 'string') {
        specEnv[key] = value;
      }
    }
    const spec: RuntimeProcessSpec = {
      command: spawnInput.command,
      args: spawnInput.args,
      cwd: spawnInput.cwd,
      env: specEnv,
      ports: resolvedPorts.map((port, index) => ({
        name: port.name ?? `port_${index}`,
        port: port.port,
        protocol: port.protocol ?? 'tcp',
      })),
      ...(preview?.url ? { readinessUrl: preview.url } : {}),
    };

    const summary: RuntimeRunSummary = {
      ...buildRunSummary(target, runNodeId),
      status: target.kind === 'web' ? 'launching' : 'running',
      startedAt: new Date().toISOString(),
      command: spawnInput.command,
      args: spawnInput.args,
      ports: resolvedPorts,
      preview,
    };
    await this.patchRuntimeRunNode(input.sessionId, runNodeId, summary);
    this.daemonActiveRuns.set(runNodeId, { sessionId: input.sessionId });
    return { mode: 'spawn', runNodeId, spec, summary };
  }

  async recordDaemonRuntimeStarted(
    sessionId: string,
    runNodeId: string,
    pid?: number,
  ): Promise<void> {
    this.daemonActiveRuns.set(runNodeId, { sessionId });
    const current = await this.readPersistedRunSummary(sessionId, runNodeId);
    if (!current) return;
    const next: RuntimeRunSummary = {
      ...current,
      status: current.status === 'launching' ? 'launching' : 'running',
      startedAt: current.startedAt ?? new Date().toISOString(),
      ...(pid !== undefined ? { pid } : {}),
    };
    await this.patchRuntimeRunNode(sessionId, runNodeId, next);
  }

  async recordDaemonRuntimeLog(
    sessionId: string,
    runNodeId: string,
    chunk: string,
    stream: 'stdout' | 'stderr' = 'stdout',
  ): Promise<void> {
    const current = await this.readPersistedRunSummary(sessionId, runNodeId);
    if (!current) return;
    const prefix = stream === 'stderr' ? '[stderr] ' : '';
    const nextLogs = trimLog(`${current.logs ?? ''}${prefix}${chunk}`);
    await this.patchRuntimeRunNode(sessionId, runNodeId, {
      ...current,
      logs: nextLogs,
    });
  }

  async recordDaemonRuntimeReadiness(
    sessionId: string,
    runNodeId: string,
    status: 'running' | 'error',
    error?: string,
  ): Promise<void> {
    const current = await this.readPersistedRunSummary(sessionId, runNodeId);
    if (!current?.preview) return;
    await this.patchRuntimeRunNode(sessionId, runNodeId, {
      ...current,
      status: status === 'running' ? 'running' : current.status,
      preview: {
        ...current.preview,
        status: status === 'running' ? 'running' : 'error',
        ...(error ? { error } : {}),
      },
    });
  }

  async recordDaemonRuntimeExit(
    sessionId: string,
    runNodeId: string,
    exitCode: number | null,
    signal?: string | null,
  ): Promise<void> {
    const current = await this.readPersistedRunSummary(sessionId, runNodeId);
    this.daemonActiveRuns.delete(runNodeId);
    if (!current) return;
    if (current.status === 'stopped') {
      // Daemon-side stop already persisted — keep the stopped status.
      return;
    }
    const cleanExit = (exitCode ?? 0) === 0;
    const reason = signal ?? exitCode ?? 'unknown';
    await this.patchRuntimeRunNode(sessionId, runNodeId, {
      ...current,
      status: cleanExit ? 'completed' : 'failed',
      endedAt: new Date().toISOString(),
      exitCode: exitCode ?? undefined,
      ...(cleanExit ? {} : { error: `Runtime exited with ${reason}.` }),
      preview:
        current.preview && current.preview.status !== 'running'
          ? {
              ...current.preview,
              status: cleanExit ? current.preview.status : 'error',
              ...(cleanExit
                ? {}
                : { error: `Runtime exited with ${reason}.` }),
            }
          : current.preview,
    });
  }

  async recordDaemonRuntimeError(
    sessionId: string,
    runNodeId: string,
    message: string,
  ): Promise<void> {
    const current = await this.readPersistedRunSummary(sessionId, runNodeId);
    this.daemonActiveRuns.delete(runNodeId);
    if (!current) return;
    await this.patchRuntimeRunNode(sessionId, runNodeId, {
      ...current,
      status: 'failed',
      endedAt: new Date().toISOString(),
      error: message,
    });
  }

  async requestDaemonRuntimeStop(
    sessionId: string,
    runNodeId: string,
  ): Promise<RuntimeRunSummary> {
    const current = await this.readPersistedRunSummary(sessionId, runNodeId);
    if (!current) {
      throw new NotFoundException('RUNTIME_RUN_NOT_FOUND');
    }
    this.daemonActiveRuns.delete(runNodeId);
    if (current.status === 'stopped' || current.status === 'completed' || current.status === 'failed') {
      return current;
    }
    const stopped: RuntimeRunSummary = {
      ...current,
      status: 'stopped',
      endedAt: current.endedAt ?? new Date().toISOString(),
    };
    await this.patchRuntimeRunNode(sessionId, runNodeId, stopped);
    return stopped;
  }

  private async readPersistedRunSummary(
    sessionId: string,
    runNodeId: string,
  ): Promise<RuntimeRunSummary | null> {
    const node = await this.getNode(sessionId, runNodeId).catch(() => null);
    if (!node) return null;
    return readRuntimeRunFromNode(node);
  }

  private liveRunIds(): Set<string> {
    return new Set([...this.runStateByNodeId.keys(), ...this.daemonActiveRuns.keys()]);
  }

  async recoverRuns(sessionId: string): Promise<number> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const targets = new Map(
      readRuntimeTargetHits(snapshot).map((entry) => [entry.summary.targetNodeId, entry.summary]),
    );
    let count = 0;
    for (const hit of readRuntimeRunHits(snapshot)) {
      if (!isActiveRuntimeRun(hit.summary.status)) {
        continue;
      }
      const target = targets.get(hit.summary.targetNodeId);
      if (target && canReuseRuntimeRun(hit.summary, target, new Set(this.runStateByNodeId.keys()))) {
        continue;
      }
      await this.patchRuntimeRunNode(sessionId, hit.node.id, recoveredRuntimeRun(hit.summary));
      count += 1;
    }
    return count;
  }

  async clearAgentRun(sessionId: string, sourceRunId: string): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const runNodes = snapshot.nodes.filter(
      (node) =>
        node.type === 'runtime_run' &&
        readRuntimeRunFromNode(node)?.sourceRunId === sourceRunId,
    );
    const targetNodes = snapshot.nodes.filter(
      (node) =>
        node.type === 'runtime_target' &&
        readRuntimeTargetFromNode(node)?.sourceRunId === sourceRunId,
    );

    for (const node of runNodes) {
      try {
        await this.stopRun(sessionId, node.id);
      } catch {
        // Best-effort cleanup should not block the next agent rerun.
      }
    }

    for (const node of [...runNodes, ...targetNodes]) {
      try {
        await this.graph.removeNode(sessionId, node.id, {
          type: 'system',
          reason: 'runtime-reset',
        });
      } catch {
        // Node may already be gone if another cleanup path removed it first.
      }
    }
  }

  async getStaticPreviewFile(sessionId: string, runNodeId: string, requestedPath: string): Promise<Buffer> {
    const summary = await this.getRuntimeRunSummary(sessionId, runNodeId);
    const preview = summary.preview;
    if (summary.targetKind !== 'web' || preview?.strategy !== 'static') {
      throw new NotFoundException('RUN_PREVIEW_UNAVAILABLE');
    }
    const entry = summary.entrypoint?.trim() || 'index.html';
    const baseDir = path.resolve(summary.cwd, path.dirname(entry));
    const defaultAsset = path.basename(entry);
    const relativePath = requestedPath.trim() || defaultAsset;
    const { absolutePath } = this.safeResolvePath(baseDir, relativePath);
    return fs.readFile(absolutePath);
  }

  private async queueRuntimeStart(sessionId: string, targetNodeId: string): Promise<RuntimeRunSummary> {
    const target = await this.getRuntimeTargetSummary(sessionId, targetNodeId);
    const targetNode = await this.getNode(sessionId, targetNodeId);
    const ready = await this.prepareRuntimeRunNode(sessionId, targetNode, target);
    if (ready.mode === 'reuse') {
      if (
        ready.summary.status === 'running'
        || ready.summary.status === 'launching'
        || (ready.summary.status === 'planned' && String(ready.summary.error ?? '').startsWith('APPROVAL_REQUIRED:'))
      ) {
        return ready.summary;
      }
      await this.supervisor?.queueRuntime({
        sessionId,
        operation: 'start',
        targetNodeId,
      });
      return ready.summary;
    }
    const planned = {
      ...buildRunSummary(target, ready.runNodeId),
      status: 'planned' as const,
      startedAt: new Date().toISOString(),
    };
    await this.patchRuntimeRunNode(sessionId, ready.runNodeId, planned);
    await this.supervisor?.queueRuntime({
      sessionId,
      operation: 'start',
      targetNodeId,
    });
    return planned;
  }

  private async startTarget(sessionId: string, targetNodeId: string, approvalId?: string): Promise<RuntimeRunSummary> {
    const target = await this.getRuntimeTargetSummary(sessionId, targetNodeId);
    const targetNode = await this.getNode(sessionId, targetNodeId);
    const ready = await this.prepareRuntimeRunNode(sessionId, targetNode, target);
    if (ready.mode === 'reuse') {
      return ready.summary;
    }
    const runNodeId = ready.runNodeId;

    if (isStaticWebTarget(target)) {
      const preview = buildStaticPreviewInfo(sessionId, runNodeId, target);
      const running = {
        ...buildRunSummary(target, runNodeId),
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        entrypoint: readStaticEntrypoint(target),
        preview,
      };
      await this.patchRuntimeRunNode(sessionId, runNodeId, running);
      return running;
    }

    const requestedPorts =
      target.ports && target.ports.length > 0
        ? target.ports
        : target.kind === 'web'
          ? [{ name: 'http', port: 0, protocol: 'http' as const }]
          : [];
    const resolvedPorts = await materializePorts(requestedPorts);
    const httpPort = firstHttpPort(resolvedPorts);
    const replacements = {
      HOST: RUNTIME_BIND_HOST,
      PORT: httpPort ? String(httpPort.port) : '',
    };
    const command = target.command ? applyRuntimeTemplate(target.command, replacements) : undefined;
    if (!command) {
      const failed = {
        ...buildRunSummary(target, runNodeId),
        status: 'failed' as const,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        error: 'Runtime command is required for local_process targets.',
      };
      await this.patchRuntimeRunNode(sessionId, runNodeId, failed);
      return failed;
    }
    const args = (target.args ?? []).map((entry) => applyRuntimeTemplate(entry, replacements));
    const env = Object.fromEntries(
      Object.entries({
        ...(target.env ?? {}),
        ...(target.docker?.env ?? {}),
      }).map(([key, value]) => [key, applyRuntimeTemplate(value, replacements)]),
    );
    if (target.launchMode === 'docker' && !approvalId && this.approvals) {
      const approval = await this.approvals.request({
        sessionId,
        kind: 'runtime_docker_start',
        title: `Approve Docker runtime ${target.serviceName}`,
        detail: `Launch Docker runtime for ${target.serviceName}`,
        payload: {
          action: 'runtime_start',
          sessionId,
          targetNodeId,
        },
        requestedByType: 'system',
        requestedById: 'runtime_service',
        sourceNodeId: targetNodeId,
      });
      const planned = {
        ...buildRunSummary(target, runNodeId),
        status: 'planned' as const,
        startedAt: new Date().toISOString(),
        error: `APPROVAL_REQUIRED:${approval.id}`,
        docker: target.docker,
      };
      await this.patchRuntimeRunNode(sessionId, runNodeId, planned);
      return planned;
    }
    const preview =
      target.kind === 'web' && httpPort
        ? buildScriptPreviewInfo(httpPort.port)
        : undefined;

    const spawnInput =
      target.launchMode === 'docker'
        ? dockerSpawnInput(target, command, args, env, resolvedPorts)
        : {
            command,
            args,
            cwd: target.cwd,
            env: {
              ...process.env,
              ...env,
            },
          };

    const summary: RuntimeRunSummary = {
      ...buildRunSummary(target, runNodeId),
      status: target.kind === 'web' ? 'launching' : 'running',
      startedAt: new Date().toISOString(),
      command: spawnInput.command,
      args: spawnInput.args,
      ports: resolvedPorts,
      preview,
    };

    const child = spawn(spawnInput.command, spawnInput.args, {
      cwd: spawnInput.cwd,
      env: spawnInput.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    summary.pid = child.pid ?? undefined;

    const state: RuntimeProcessState = {
      sessionId,
      summary,
      child,
      manualStop: false,
      pending: Promise.resolve(),
    };
    this.runStateByNodeId.set(runNodeId, state);

    // Attach listeners before any await: spawn may emit `error` (e.g. ENOENT) on the next tick.
    child.stdout.on('data', (chunk: Buffer | string) => {
      void this.appendRuntimeLog(runNodeId, String(chunk)).catch((errorValue) => {
        this.logPatchError(runNodeId, errorValue, 'stdout');
      });
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      void this.appendRuntimeLog(runNodeId, `[stderr] ${String(chunk)}`).catch((errorValue) => {
        this.logPatchError(runNodeId, errorValue, 'stderr');
      });
    });
    child.on('error', (errorValue) => {
      void this
        .finishRuntimeRun(runNodeId, {
          status: 'failed',
          endedAt: new Date().toISOString(),
          error: errorValue instanceof Error ? errorValue.message : String(errorValue),
        })
        .catch((patchError) => {
          this.logPatchError(runNodeId, patchError, 'child_error');
        });
    });
    child.on('exit', (code, signal) => {
      void this.handleRuntimeExit(runNodeId, code, signal).catch((errorValue) => {
        this.logPatchError(runNodeId, errorValue, 'exit');
      });
    });

    await this.patchRuntimeRunNode(sessionId, runNodeId, summary);

    if (target.kind === 'web' && preview?.url) {
      void this.waitUntilWebReady(runNodeId, preview.url).catch((errorValue) => {
        this.logPatchError(runNodeId, errorValue, 'readiness');
      });
    }

    return summary;
  }

  private async appendRuntimeLog(runNodeId: string, chunk: string): Promise<void> {
    const state = this.runStateByNodeId.get(runNodeId);
    if (!state) return;
    const nextLogs = trimLog(`${state.summary.logs ?? ''}${chunk}`);
    state.summary = {
      ...state.summary,
      logs: nextLogs,
    };
    await this.patchRuntimeRunNode(state.sessionId, runNodeId, state.summary);
  }

  private async waitUntilWebReady(runNodeId: string, url: string): Promise<void> {
    const deadline = Date.now() + RUNTIME_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = this.runStateByNodeId.get(runNodeId);
      if (!state || state.manualStop) return;
      if (state.summary.status !== 'launching') return;
      if (await isHttpReady(url)) {
        state.summary = {
          ...state.summary,
          status: 'running',
          preview: {
            ...state.summary.preview,
            status: 'running',
            error: undefined,
          },
        };
        await this.patchRuntimeRunNode(state.sessionId, runNodeId, state.summary);
        return;
      }
      await sleep(RUNTIME_READY_POLL_MS);
    }

    const state = this.runStateByNodeId.get(runNodeId);
    if (!state) return;
    state.manualStop = true;
    state.child?.kill('SIGTERM');
    await this.finishRuntimeRun(runNodeId, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      error: state.summary.logs || 'Web runtime timed out before becoming reachable.',
      preview: state.summary.preview
        ? {
            ...state.summary.preview,
            status: 'error',
            error: state.summary.logs || 'Web runtime timed out before becoming reachable.',
          }
        : undefined,
    });
  }

  private async handleRuntimeExit(
    runNodeId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const state = this.runStateByNodeId.get(runNodeId);
    if (!state) return;
    if (state.manualStop) {
      this.runStateByNodeId.delete(runNodeId);
      return;
    }
    const cleanExit = (code ?? 0) === 0;
    await this.finishRuntimeRun(runNodeId, {
      status: cleanExit ? 'completed' : 'failed',
      endedAt: new Date().toISOString(),
      exitCode: code ?? undefined,
      error: cleanExit ? undefined : `Runtime exited with ${signal ?? code ?? 'unknown'}.`,
      preview:
        state.summary.preview && state.summary.preview.status !== 'running'
          ? {
              ...state.summary.preview,
              status: cleanExit ? state.summary.preview.status : 'error',
              error: cleanExit ? state.summary.preview.error : `Runtime exited with ${signal ?? code ?? 'unknown'}.`,
            }
          : state.summary.preview,
    });
  }

  private async finishRuntimeRun(
    runNodeId: string,
    patch: Partial<RuntimeRunSummary> & {
      status: RuntimeExecutionStatus;
      endedAt: string;
    },
  ): Promise<void> {
    const state = this.runStateByNodeId.get(runNodeId);
    if (!state) return;
    state.summary = {
      ...state.summary,
      ...patch,
    };
    await this.patchRuntimeRunNode(state.sessionId, runNodeId, state.summary);
    this.runStateByNodeId.delete(runNodeId);
  }

  private async upsertRuntimeTargetNode(input: {
    sessionId: string;
    outputNode: GraphNode;
    sourceRunId: string;
    outputNodeId: string;
    manifest: RunnableArtifactManifest;
    index: number;
    source: RuntimeTargetSummary['source'];
  }): Promise<RuntimeTargetSummary> {
    const summarySeed = buildRuntimeTargetSeed(input);
    const snapshot = await this.graph.loadSnapshot(input.sessionId);
    const hits = readRuntimeTargetHits(snapshot).filter((entry) => sameRuntimeTarget(entry.summary, summarySeed));
    if (hits.length === 0) {
      return this.createRuntimeTargetNode({
        sessionId: input.sessionId,
        outputNode: input.outputNode,
        index: input.index,
        summarySeed,
      });
    }

    const [keep, ...rest] = sortTargetHits(hits, snapshot, this.liveRunIds());
    if (!keep) {
      throw new Error('runtime target node');
    }
    for (const hit of rest) {
      await this.removeRuntimeTargetNode(input.sessionId, hit.node.id);
    }

    const summary: RuntimeTargetSummary = {
      ...summarySeed,
      targetNodeId: keep.node.id,
    };
    await this.graph.patchNode(
      input.sessionId,
      keep.node.id,
      {
        content: summary as never,
        metadata: { runtimeTarget: summary },
      },
      { type: 'system', reason: 'runtime-target' },
    );
    await this.syncRuntimeRuns(input.sessionId, summary);
    if (!hasRuntimeEdge(snapshot, input.outputNode.id, keep.node.id)) {
      try {
        await this.graph.addEdge(input.sessionId, {
          source: input.outputNode.id,
          target: keep.node.id,
          relation: 'produces',
          direction: 'source_to_target',
          creator: { type: 'system', reason: 'runtime-target' },
        });
      } catch (errorValue) {
        if (!isDuplicateEdgeError(errorValue)) {
          throw errorValue;
        }
      }
    }
    return summary;
  }

  private async createRuntimeTargetNode(input: {
    sessionId: string;
    outputNode: GraphNode;
    index: number;
    summarySeed: RuntimeTargetSeed;
  }): Promise<RuntimeTargetSummary> {
    const position = runtimeTargetPosition(input.outputNode.position, input.index);
    const created = await this.graph.addNode(input.sessionId, {
      type: 'runtime_target',
      content: {
        ...input.summarySeed,
        targetNodeId: 'pending',
      } as never,
      position,
      dimensions: { width: 360, height: 220 },
      creator: { type: 'system', reason: 'runtime-target' },
      runId: input.summarySeed.sourceRunId,
    });
    if (created.payload.type !== 'node_added') {
      throw new Error('runtime target node');
    }
    const targetNodeId = created.payload.node.id;
    const summary: RuntimeTargetSummary = {
      ...input.summarySeed,
      targetNodeId,
    };
    await this.graph.patchNode(
      input.sessionId,
      targetNodeId,
      {
        content: summary as never,
        metadata: { runtimeTarget: summary },
      },
      { type: 'system', reason: 'runtime-target' },
    );
    await this.graph.addEdge(input.sessionId, {
      source: input.outputNode.id,
      target: targetNodeId,
      relation: 'produces',
      direction: 'source_to_target',
      creator: { type: 'system', reason: 'runtime-target' },
    });
    return summary;
  }

  private async prepareRuntimeRunNode(
    sessionId: string,
    targetNode: GraphNode,
    target: RuntimeTargetSummary,
  ): Promise<
    | {
        mode: 'reuse';
        summary: RuntimeRunSummary;
      }
    | {
        mode: 'start';
        runNodeId: string;
      }
  > {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const hits = readRuntimeRunHits(snapshot).filter(
      (entry) => entry.summary.targetNodeId === target.targetNodeId,
    );
    if (hits.length === 0) {
      return {
        mode: 'start',
        runNodeId: await this.createRuntimeRunNode(sessionId, targetNode, target),
      };
    }

    const [keep, ...rest] = sortRunHits(hits, target, this.liveRunIds());
    if (!keep) {
      throw new Error('runtime run node');
    }
    for (const hit of rest) {
      await this.removeRuntimeRunNode(sessionId, hit.node.id);
    }

    const summary = mergeRuntimeRun(keep.summary, target);
    if (canReuseRuntimeRun(summary, target, this.liveRunIds())) {
      await this.patchRuntimeRunNode(sessionId, keep.node.id, summary);
      return { mode: 'reuse', summary };
    }

    await this.patchRuntimeRunNode(sessionId, keep.node.id, buildRunSummary(target, keep.node.id));
    return { mode: 'start', runNodeId: keep.node.id };
  }

  private async syncRuntimeRuns(sessionId: string, target: RuntimeTargetSummary): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const hits = readRuntimeRunHits(snapshot).filter(
      (entry) => entry.summary.targetNodeId === target.targetNodeId,
    );
    for (const hit of hits) {
      await this.patchRuntimeRunNode(sessionId, hit.node.id, mergeRuntimeRun(hit.summary, target));
    }
  }

  private async removeRuntimeTargetNode(sessionId: string, targetNodeId: string): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const hits = readRuntimeRunHits(snapshot).filter(
      (entry) => entry.summary.targetNodeId === targetNodeId,
    );
    for (const hit of hits) {
      await this.removeRuntimeRunNode(sessionId, hit.node.id);
    }
    try {
      await this.graph.removeNode(sessionId, targetNodeId, {
        type: 'system',
        reason: 'runtime-target',
      });
    } catch {
      // Another cleanup path may already have removed the target node.
    }
  }

  private async removeRuntimeRunNode(sessionId: string, runNodeId: string): Promise<void> {
    try {
      await this.stopRun(sessionId, runNodeId);
    } catch {
      // Best-effort cleanup should not fail if the process or node is already gone.
    }
    try {
      await this.graph.removeNode(sessionId, runNodeId, {
        type: 'system',
        reason: 'runtime-run',
      });
    } catch {
      // Another cleanup path may already have removed the run node.
    }
  }

  private async createRuntimeRunNode(
    sessionId: string,
    targetNode: GraphNode,
    target: RuntimeTargetSummary,
  ): Promise<string> {
    const created = await this.graph.addNode(sessionId, {
      type: 'runtime_run',
      content: {
        ...buildRunSummary(target, 'pending'),
        runNodeId: 'pending',
        status: 'planned',
      } as never,
      position: runtimeRunPosition(targetNode.position),
      dimensions: { width: 420, height: 300 },
      creator: { type: 'system', reason: 'runtime-run' },
      runId: target.sourceRunId,
    });
    if (created.payload.type !== 'node_added') {
      throw new Error('runtime run node');
    }
    const runNodeId = created.payload.node.id;
    await this.graph.addEdge(sessionId, {
      source: targetNode.id,
      target: runNodeId,
      relation: 'spawns',
      direction: 'source_to_target',
      creator: { type: 'system', reason: 'runtime-run' },
    });
    return runNodeId;
  }

  private async patchRuntimeRunNode(
    sessionId: string,
    runNodeId: string,
    summary: RuntimeRunSummary,
  ): Promise<void> {
    const state = this.runStateByNodeId.get(runNodeId);
    if (!state || state.sessionId !== sessionId) {
      await this.graph.patchNode(
        sessionId,
        runNodeId,
        {
          content: summary as never,
          metadata: { runtimeRun: summary },
          status: summary.status === 'failed' ? 'error' : 'active',
        },
        { type: 'system', reason: 'runtime-run' },
      );
      return;
    }

    const task = state.pending.catch(() => undefined).then(async () => {
      await this.graph.patchNode(
        sessionId,
        runNodeId,
        {
          content: summary as never,
          metadata: { runtimeRun: summary },
          status: summary.status === 'failed' ? 'error' : 'active',
        },
        { type: 'system', reason: 'runtime-run' },
      );
    });
    state.pending = task;
    await task;
  }

  private logPatchError(runNodeId: string, errorValue: unknown, source: string): void {
    const error = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
    this.log.error(`Runtime ${source} patch failed for ${runNodeId}: ${error.message}`, error.stack);
  }

  private async getRuntimeTargetSummary(sessionId: string, targetNodeId: string): Promise<RuntimeTargetSummary> {
    const node = await this.getNode(sessionId, targetNodeId);
    const summary = readRuntimeTargetFromNode(node);
    if (!summary) {
      throw new NotFoundException('RUNTIME_TARGET_NOT_FOUND');
    }
    return summary;
  }

  private async getRuntimeRunSummary(sessionId: string, runNodeId: string): Promise<RuntimeRunSummary> {
    const state = this.runStateByNodeId.get(runNodeId);
    if (state && state.sessionId === sessionId) {
      return state.summary;
    }
    const node = await this.getNode(sessionId, runNodeId);
    const summary = readRuntimeRunFromNode(node);
    if (!summary) {
      throw new NotFoundException('RUNTIME_RUN_NOT_FOUND');
    }
    return summary;
  }

  private async getNode(sessionId: string, nodeId: string): Promise<GraphNode> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const node = snapshot.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      throw new NotFoundException('NODE_NOT_FOUND');
    }
    return node;
  }

  private safeResolvePath(root: string, requestedPath: string) {
    try {
      return resolveWorkspaceFilePath(root, requestedPath);
    } catch (errorValue) {
      throw new BadRequestException(
        errorValue instanceof Error ? errorValue.message : 'WORKSPACE_FILE_PATH_INVALID',
      );
    }
  }
}


