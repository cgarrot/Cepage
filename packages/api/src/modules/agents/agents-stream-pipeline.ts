import {
  type AgentDelegationContext,
  type AgentKernelRecallEntry,
  formatAgentSelectionLabel,
  type AgentToolsetId,
  type AgentModelRef,
  type AgentPromptPart,
  type AgentRun,
  type AgentType,
  type GraphNode,
  type RuntimeManifestEnvelope,
  type WakeReason,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { GraphService } from '../graph/graph.service';
import { RuntimeService } from '../runtime/runtime.service';
import { importAgentCore } from './agent-core.runtime';
import { RunArtifactsService } from './run-artifacts.service';
import type { AgentAdapterRuntimeEvent } from './agents.types';

type StreamDeps = {
  prisma: PrismaService;
  graph: GraphService;
  activity: ActivityService;
  artifacts: RunArtifactsService;
  runtime: RuntimeService;
  emitAgentStatus: (sessionId: string, runId: string, eventId: number, payload: AgentRun) => void;
  emitOutputChunk: (
    sessionId: string,
    runId: string,
    executionId: string,
    output: string,
    isStreaming: boolean,
  ) => void;
};

type StreamState = {
  buffer: string;
  externalSessionId?: string;
  runtimeManifest: RuntimeManifestEnvelope | null;
};

async function consumeRunStream(input: {
  sessionId: string;
  type: AgentType;
  runtime: AgentRun['runtime'];
  role: string;
  model: AgentModelRef | undefined;
  cwd: string;
  promptText: string;
  parts: AgentPromptPart[];
  externalSessionId?: string;
  toolset?: AgentToolsetId;
  recall?: AgentKernelRecallEntry[];
  delegation?: AgentDelegationContext;
  wakeReason: WakeReason;
  seedNodeIds: string[];
  signal: AbortSignal;
  onSession: (externalSessionId: string) => Promise<void>;
  onOutput: (buffer: string, streaming: boolean, force?: boolean) => Promise<void>;
  onError: (message: string) => Promise<void>;
}): Promise<StreamState> {
  let buffer = '';
  let externalSessionId: string | undefined;
  let runtimeManifest: RuntimeManifestEnvelope | null = null;
  const { runAgentStream } = await importAgentCore();
  const stream = runAgentStream({
    sessionId: input.sessionId,
    type: input.type,
    runtime: input.runtime,
    role: input.role,
    model: input.model,
    workingDirectory: input.cwd,
    promptText: input.promptText,
    parts: input.parts,
    externalSessionId: input.externalSessionId,
    toolset: input.toolset,
    recall: input.recall,
    delegation: input.delegation,
    wakeReason: input.wakeReason,
    seedNodeIds: input.seedNodeIds,
    signal: input.signal,
  }) as AsyncGenerator<AgentAdapterRuntimeEvent>;

  for await (const ev of stream) {
    if (ev.type === 'session') {
      externalSessionId = ev.externalSessionId;
      await input.onSession(externalSessionId);
      continue;
    }
    if (ev.type === 'stdout') {
      buffer += ev.chunk;
      await input.onOutput(buffer, true);
      continue;
    }
    if (ev.type === 'snapshot') {
      if (!ev.output || ev.output === buffer) {
        continue;
      }
      buffer = ev.output;
      await input.onOutput(buffer, true, true);
      continue;
    }
    if (ev.type === 'artifact_manifest') {
      runtimeManifest = ev.manifest;
      continue;
    }
    if (ev.type === 'stderr') {
      buffer += `\n[stderr] ${ev.chunk}`;
      await input.onOutput(buffer, true, true);
      continue;
    }
    if (ev.type === 'error') {
      await input.onError(ev.message);
      throw new Error(ev.message);
    }
  }

  return { buffer, externalSessionId, runtimeManifest };
}

export async function runExecutionStream(
  deps: StreamDeps,
  input: {
    sessionId: string;
    executionId: string;
    runId: string;
    ownerNodeId: string;
    triggerNodeId: string | null;
    stepNodeId: string | null;
    type: AgentType;
    model: AgentModelRef | undefined;
    seedNodeIds: string[];
    role: string;
    wakeReason: WakeReason;
    startedAtIso: string;
    cwd: string;
    promptText: string;
    parts: AgentPromptPart[];
    externalSessionId?: string;
    toolset?: AgentToolsetId;
    recall?: AgentKernelRecallEntry[];
    delegation?: AgentDelegationContext;
    requestId?: string;
    signal: AbortSignal;
  },
): Promise<void> {
  const runtime = { kind: 'local_process', cwd: input.cwd } as AgentRun['runtime'];
  const baseRun: Omit<AgentRun, 'status'> = {
    id: input.runId,
    sessionId: input.sessionId,
    executionId: input.executionId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.delegation?.parentRunId ? { parentRunId: input.delegation.parentRunId } : {}),
    type: input.type,
    role: input.role,
    runtime,
    wakeReason: input.wakeReason,
    startedAt: input.startedAtIso,
    updatedAt: input.startedAtIso,
    seedNodeIds: input.seedNodeIds,
    rootNodeId: input.ownerNodeId,
    ...(input.triggerNodeId ? { triggerNodeId: input.triggerNodeId } : {}),
    ...(input.stepNodeId ? { stepNodeId: input.stepNodeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    outputText: '',
    isStreaming: true,
  };
  const selectionLabel = formatAgentSelectionLabel(input.type, input.model);
  let lastPersistedOutput = '';
  let lastPersistedStreaming = true;
  let lastPersistAt = 0;
  let state: StreamState = {
    buffer: '',
    runtimeManifest: null,
  };

  const persistOutput = async (buffer: string, streaming: boolean, force = false) => {
    if (!force && buffer === lastPersistedOutput && streaming === lastPersistedStreaming) {
      return;
    }
    if (!force && Date.now() - lastPersistAt < 120) {
      return;
    }
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: {
        outputText: buffer,
        isStreaming: streaming,
      },
    });
    deps.emitOutputChunk(input.sessionId, input.runId, input.executionId, buffer, streaming);
    lastPersistedOutput = buffer;
    lastPersistedStreaming = streaming;
    lastPersistAt = Date.now();
  };

  try {
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: { status: 'running' },
    });
    await deps.prisma.workflowExecution.update({
      where: { id: input.executionId },
      data: { status: 'running', currentRunId: input.runId, latestRunId: input.runId, endedAt: null },
    });
    deps.emitAgentStatus(input.sessionId, input.runId, 0, {
      ...baseRun,
      status: 'running',
    });

    state = await consumeRunStream({
      sessionId: input.sessionId,
      type: input.type,
      runtime,
      role: input.role,
      model: input.model,
      cwd: input.cwd,
      promptText: input.promptText,
      parts: input.parts,
      externalSessionId: input.externalSessionId,
      toolset: input.toolset,
      recall: input.recall,
      delegation: input.delegation,
      wakeReason: input.wakeReason,
      seedNodeIds: input.seedNodeIds,
      signal: input.signal,
      onSession: async (externalSessionId) => {
        await deps.prisma.agentRun.update({
          where: { id: input.runId },
          data: { externalSessionId },
        });
      },
      onOutput: (buffer, streaming, force) => persistOutput(buffer, streaming, force),
      onError: async () => undefined,
    });

    await persistOutput(state.buffer, false, true);
    const endedAt = new Date().toISOString();
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: {
        status: 'completed',
        endedAt: new Date(endedAt),
        outputText: state.buffer,
        isStreaming: false,
        externalSessionId: state.externalSessionId ?? null,
      },
    });
    await deps.prisma.workflowExecution.update({
      where: { id: input.executionId },
      data: {
        status: 'completed',
        currentRunId: input.runId,
        latestRunId: input.runId,
        endedAt: new Date(endedAt),
        modelProviderId: input.model?.providerID ?? null,
        modelId: input.model?.modelID ?? null,
      },
    });
    deps.emitAgentStatus(input.sessionId, input.runId, 0, {
      ...baseRun,
      status: 'completed',
      endedAt,
      updatedAt: endedAt,
      externalSessionId: state.externalSessionId,
      outputText: state.buffer,
      isStreaming: false,
    });
    await deps.activity.log({
      sessionId: input.sessionId,
      eventId: 0,
      actorType: 'agent',
      actorId: input.runId,
      runId: input.runId,
      summary: `${selectionLabel} run completed`,
      summaryKey: 'activity.agent_completed',
      summaryParams: { label: selectionLabel },
      relatedNodeIds: [input.ownerNodeId],
    });
    try {
      await deps.artifacts.finalizeRun(
        input.sessionId,
        input.executionId,
        input.runId,
        input.ownerNodeId,
        input.cwd,
      );
    } catch {
      // Artifact summary should not block a completed run from being reported.
    }
    try {
      await deps.runtime.ingestAgentRuntimeOutput({
        sessionId: input.sessionId,
        sourceRunId: input.runId,
        outputNodeId: input.ownerNodeId,
        workspaceRoot: input.cwd,
        outputText: state.buffer,
        manifest: state.runtimeManifest,
      });
    } catch {
      // Runtime nodes are additive and should not hide a successful agent run.
    }
  } catch (errorValue) {
    const cancelled = input.signal.aborted;
    const finalStatus = cancelled ? 'cancelled' : 'failed';
    const endedAt = new Date().toISOString();
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: {
        status: finalStatus,
        endedAt: new Date(endedAt),
        outputText: state.buffer,
        isStreaming: false,
        externalSessionId: state.externalSessionId ?? null,
      },
    });
    await deps.prisma.workflowExecution.update({
      where: { id: input.executionId },
      data: {
        status: finalStatus,
        currentRunId: input.runId,
        latestRunId: input.runId,
        endedAt: new Date(endedAt),
        modelProviderId: input.model?.providerID ?? null,
        modelId: input.model?.modelID ?? null,
      },
    });
    try {
      await persistOutput(state.buffer, false, true);
    } catch {
      // Preserve the original run failure if output persistence also fails.
    }
    const failMessage = errorValue instanceof Error ? errorValue.message : String(errorValue);
    deps.emitAgentStatus(input.sessionId, input.runId, 0, {
      ...baseRun,
      status: finalStatus,
      endedAt,
      updatedAt: endedAt,
      externalSessionId: state.externalSessionId,
      outputText: state.buffer,
      isStreaming: false,
    });
    await deps.activity.log({
      sessionId: input.sessionId,
      eventId: 0,
      actorType: 'agent',
      actorId: input.runId,
      runId: input.runId,
      summary: cancelled
        ? `${selectionLabel} run cancelled`
        : `${selectionLabel} run failed: ${failMessage}`,
      summaryKey: cancelled ? 'activity.agent_cancelled' : 'activity.agent_failed',
      summaryParams: cancelled ? { label: selectionLabel } : { label: selectionLabel, detail: failMessage },
      relatedNodeIds: [input.ownerNodeId],
    });
    try {
      await deps.artifacts.finalizeRun(
        input.sessionId,
        input.executionId,
        input.runId,
        input.ownerNodeId,
        input.cwd,
      );
    } catch {
      // Preserve the original run failure if artifact capture also fails.
    }
  }
}

export async function runGraphStream(
  deps: StreamDeps,
  input: {
    sessionId: string;
    runId: string;
    rootNodeId: string;
    outputNodeId: string;
    type: AgentType;
    model: AgentModelRef | undefined;
    seedNodeIds: string[];
    role: string;
    wakeReason: WakeReason;
    startedAtIso: string;
    initialEventId: number;
    cwd: string;
    promptText: string;
    parts: AgentPromptPart[];
    externalSessionId?: string;
    toolset?: AgentToolsetId;
    recall?: AgentKernelRecallEntry[];
    delegation?: AgentDelegationContext;
    errorPosition: GraphNode['position'];
    signal: AbortSignal;
  },
): Promise<void> {
  const creator = { type: 'agent', agentType: input.type, agentId: input.runId } as const;
  const runtime = { kind: 'local_process', cwd: input.cwd } as AgentRun['runtime'];
  const baseRun: Omit<AgentRun, 'status'> = {
    id: input.runId,
    sessionId: input.sessionId,
    ...(input.delegation?.parentRunId ? { parentRunId: input.delegation.parentRunId } : {}),
    type: input.type,
    role: input.role,
    runtime,
    wakeReason: input.wakeReason,
    startedAt: input.startedAtIso,
    seedNodeIds: input.seedNodeIds,
    rootNodeId: input.rootNodeId,
    model: input.model,
  };
  const selectionLabel = formatAgentSelectionLabel(input.type, input.model);
  let lastEventId = input.initialEventId;
  let lastOutput = '';
  let lastStreaming = true;
  let lastPatchAt = 0;
  let streamErrorAlreadyLogged = false;
  let state: StreamState = {
    buffer: '',
    runtimeManifest: null,
  };

  const patchOutput = async (buffer: string, streaming: boolean, force = false) => {
    if (!force) {
      const unchanged = buffer === lastOutput && streaming === lastStreaming;
      if (unchanged) {
        return;
      }
      // Smooth out token-heavy adapters like OpenCode so React Flow is not reset on every chunk.
      if (Date.now() - lastPatchAt < 48) {
        return;
      }
    }
    const envPatch = await deps.graph.patchNode(
      input.sessionId,
      input.outputNodeId,
      {
        content: {
          output: buffer,
          outputType: 'stdout',
          isStreaming: streaming,
        } as never,
      },
      creator,
    );
    lastEventId = envPatch.eventId;
    lastOutput = buffer;
    lastStreaming = streaming;
    lastPatchAt = Date.now();
  };

  try {
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: { status: 'running' },
    });
    deps.emitAgentStatus(input.sessionId, input.runId, lastEventId, {
      ...baseRun,
      status: 'running',
    });

    state = await consumeRunStream({
      sessionId: input.sessionId,
      type: input.type,
      runtime,
      role: input.role,
      model: input.model,
      cwd: input.cwd,
      promptText: input.promptText,
      parts: input.parts,
      externalSessionId: input.externalSessionId,
      toolset: input.toolset,
      recall: input.recall,
      delegation: input.delegation,
      wakeReason: input.wakeReason,
      seedNodeIds: input.seedNodeIds,
      signal: input.signal,
      onSession: async (externalSessionId) => {
        await deps.prisma.agentRun.update({
          where: { id: input.runId },
          data: { externalSessionId },
        });
      },
      onOutput: (buffer, streaming, force) => patchOutput(buffer, streaming, force),
      onError: async (message) => {
        const errEnv = await deps.graph.addNode(input.sessionId, {
          type: 'system_message',
          content: { text: message, level: 'error' } as never,
          position: input.errorPosition,
          creator: { type: 'system', reason: input.type },
          metadata: { agentRunId: input.runId },
          runId: input.runId,
        });
        lastEventId = errEnv.eventId;
        streamErrorAlreadyLogged = true;
      },
    });

    await patchOutput(state.buffer, false, true);
    const endedAt = new Date().toISOString();
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: { status: 'completed', endedAt: new Date(endedAt), isStreaming: false },
    });

    deps.emitAgentStatus(input.sessionId, input.runId, lastEventId, {
      ...baseRun,
      status: 'completed',
      endedAt,
      isStreaming: false,
      externalSessionId: state.externalSessionId,
    });

    await deps.activity.log({
      sessionId: input.sessionId,
      eventId: lastEventId,
      actorType: 'agent',
      actorId: input.runId,
      runId: input.runId,
      summary: `${selectionLabel} run completed`,
      summaryKey: 'activity.agent_completed',
      summaryParams: { label: selectionLabel },
      relatedNodeIds: [input.outputNodeId],
    });
    try {
      await deps.artifacts.finalizeRun(
        input.sessionId,
        undefined,
        input.runId,
        input.outputNodeId,
        input.cwd,
      );
    } catch {
      // Artifact summary should not block a completed run from being reported.
    }
    try {
      await deps.runtime.ingestAgentRuntimeOutput({
        sessionId: input.sessionId,
        sourceRunId: input.runId,
        outputNodeId: input.outputNodeId,
        workspaceRoot: input.cwd,
        outputText: state.buffer,
        manifest: state.runtimeManifest,
      });
    } catch {
      // Runtime nodes are additive and should not hide a successful agent run.
    }
  } catch (errorValue) {
    const cancelled = input.signal.aborted;
    const finalStatus = cancelled ? 'cancelled' : 'failed';
    const endedAt = new Date().toISOString();
    await deps.prisma.agentRun.update({
      where: { id: input.runId },
      data: { status: finalStatus, endedAt: new Date(endedAt), isStreaming: false },
    });

    try {
      await patchOutput(state.buffer, false, true);
    } catch {
      // Keep handling the failure path even if output patching fails.
    }

    const failMessage = errorValue instanceof Error ? errorValue.message : String(errorValue);
    if (!cancelled && !streamErrorAlreadyLogged) {
      const failEnv = await deps.graph.addNode(input.sessionId, {
        type: 'system_message',
        content: {
          text: failMessage,
          level: 'error',
        } as never,
        position: input.errorPosition,
        creator: { type: 'system', reason: `${input.type}-run` },
        metadata: { agentRunId: input.runId },
        runId: input.runId,
      });
      lastEventId = failEnv.eventId;
    }

    deps.emitAgentStatus(input.sessionId, input.runId, lastEventId || input.initialEventId, {
      ...baseRun,
      status: finalStatus,
      endedAt,
      isStreaming: false,
      externalSessionId: state.externalSessionId,
    });

    await deps.activity.log({
      sessionId: input.sessionId,
      eventId: lastEventId,
      actorType: 'agent',
      actorId: input.runId,
      runId: input.runId,
      summary: cancelled
        ? `${selectionLabel} run cancelled`
        : `${selectionLabel} run failed: ${failMessage}`,
      summaryKey: cancelled ? 'activity.agent_cancelled' : 'activity.agent_failed',
      summaryParams: cancelled ? { label: selectionLabel } : { label: selectionLabel, detail: failMessage },
      relatedNodeIds: [input.outputNodeId],
    });
    try {
      await deps.artifacts.finalizeRun(
        input.sessionId,
        undefined,
        input.runId,
        input.outputNodeId,
        input.cwd,
      );
    } catch {
      // Preserve the original run failure if artifact capture also fails.
    }
  }
}
