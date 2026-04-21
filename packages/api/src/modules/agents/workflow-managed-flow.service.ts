import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AgentLifecycleStatus,
  AgentModelRef,
  AgentRun,
  AgentType,
  ConnectorRunSummary,
  GraphNode,
  GraphSnapshot,
  WorkflowControllerState,
  WorkflowManagedFlowContent,
  WorkflowManagedFlowPhase,
  WorkflowManagedFlowPhaseRecord,
  WorkflowManagedFlowRunRequest,
  WorkflowManagedFlowRunResult,
  WorkflowManagedFlowState,
} from '@cepage/shared-core';
import {
  collectManagedFlowReferencedNodeIds,
  parseWorkflowTransfer,
  readRuntimeTargetSummary,
  readGraphNodeLockedSelection,
  readWorkflowArtifactContent,
  readWorkflowDecisionValidatorContent,
  readWorkflowLoopContent,
  readWorkflowManagedFlowContent,
  readWorkflowSubgraphContent,
  resolveWorkflowArtifactRelativePath,
  workflowManagedFlowCancelRequestSchema,
  workflowManagedFlowRunRequestSchema,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import { GraphService } from '../graph/graph.service';
import { CollaborationBusService } from '../collaboration/collaboration-bus.service';
import { ConnectorService } from '../connectors/connector.service';
import { EvalService } from '../execution/eval.service';
import { RunSupervisorService } from '../execution/run-supervisor.service';
import { AgentsService } from './agents.service';
import {
  hasWorkflowJsonPath,
  hasWorkflowJsonPathArrayNonempty,
  hasWorkflowJsonPathNonempty,
  parseWorkflowJsonText,
  readWorkflowJsonPath,
} from './workflow-json.util';
import { WorkflowControllerService } from './workflow-controller.service';
import {
  ACTIVE_AGENT_STATUSES,
  ACTIVE_CONTROLLER_STATUSES,
  TERMINAL_FLOW_STATUSES,
  assertPhaseIds,
  blockedState,
  buildInitialFlowState,
  completedState as completeFlowState,
  currentPhase,
  currentPhaseNodeId,
  failedState,
  flowJson,
  flowMetadata,
  phaseForceRestartIds,
  phaseIndex,
  phaseRecord,
  phaseRequestId,
  serializeFlowState as serializeManagedFlowState,
  toManagedFlowRunResult,
  waitingState,
  withPhaseRestart,
  type FlowAdvance,
  type PhaseEvaluation,
} from './workflow-managed-flow.state';

type SessionRow = {
  id: string;
  workspaceParentDirectory: string | null;
  workspaceDirectoryName: string | null;
};

@Injectable()
export class WorkflowManagedFlowService {
  private readonly tasks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly collaboration: CollaborationBusService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agents: AgentsService,
    @Inject(forwardRef(() => WorkflowControllerService))
    private readonly controllers: WorkflowControllerService,
    @Optional()
    private readonly supervisor?: RunSupervisorService,
    @Optional()
    private readonly evals?: EvalService,
    @Optional()
    private readonly connectors?: ConnectorService,
  ) {}

  private serializeFlowState(row: Parameters<typeof serializeManagedFlowState>[0]): WorkflowManagedFlowState {
    return serializeManagedFlowState(row);
  }

  private completedState(...args: Parameters<typeof completeFlowState>): WorkflowManagedFlowState {
    return completeFlowState(...args);
  }

  async run(sessionId: string, nodeId: string, body: unknown): Promise<WorkflowManagedFlowRunResult> {
    const req = this.parseRunRequest(body);
    const session = await this.loadSession(sessionId);
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const content = this.compileFlowContent(snapshot, nodeId);
    const existing = await this.prisma.workflowManagedFlow.findFirst({
      where: { sessionId, entryNodeId: nodeId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const current = existing ? this.serializeFlowState(existing) : null;
    if (current) {
      if (req.forceRestart) {
        const restarted = await this.writeFlowState(
          buildInitialFlowState({
            flowId: current.id,
            sessionId,
            entryNodeId: nodeId,
            content,
            revision: current.revision,
            now: new Date().toISOString(),
            forceRestart: true,
          }),
        );
        this.ensureTask(restarted.id);
        return toManagedFlowRunResult(restarted, 'restart');
      }
      if (current.status === 'queued' || current.status === 'running') {
        this.ensureTask(current.id);
        return toManagedFlowRunResult(current, 'resume');
      }
      if (current.status === 'waiting' || current.status === 'blocked') {
        const resumed = await this.writeFlowState({
          ...current,
          status: 'running',
          updatedAt: new Date().toISOString(),
        });
        this.ensureTask(resumed.id);
        return toManagedFlowRunResult(resumed, 'resume');
      }
      return toManagedFlowRunResult(current, 'noop');
    }

    const created = await this.createFlowState(
      buildInitialFlowState({
        flowId: randomUUID(),
        sessionId,
        entryNodeId: nodeId,
        content,
        revision: 0,
        now: new Date().toISOString(),
      }),
    );
    await fs.mkdir(this.resolveWorkingDirectory(session, req.workingDirectory), { recursive: true });
    this.ensureTask(created.id);
    return toManagedFlowRunResult(created, 'run');
  }

  async cancel(sessionId: string, flowId: string, body: unknown): Promise<WorkflowManagedFlowState> {
    workflowManagedFlowCancelRequestSchema.parse(body ?? {});
    const state = await this.loadFlowState(flowId);
    if (state.sessionId !== sessionId) {
      throw new NotFoundException('WORKFLOW_MANAGED_FLOW_NOT_FOUND');
    }
    if (TERMINAL_FLOW_STATUSES.has(state.status)) {
      return state;
    }
    const cancelled = await this.writeFlowState({
      ...state,
      cancelRequested: true,
      status: state.status === 'waiting' || state.status === 'blocked' ? 'running' : state.status,
      updatedAt: new Date().toISOString(),
    });
    this.ensureTask(cancelled.id);
    return cancelled;
  }

  async notifyAgentStatus(sessionId: string, run: AgentRun): Promise<void> {
    if (
      !run.executionId
      || !run.status
      || ACTIVE_AGENT_STATUSES.has(run.status)
    ) {
      return;
    }
    const flows = await this.listActiveSessionFlows(sessionId);
    for (const flow of flows) {
      if (flow.wait?.kind !== 'execution') {
        continue;
      }
      if (flow.wait.executionId !== run.executionId && flow.wait.runId !== run.id) {
        continue;
      }
      const resumed = await this.writeFlowState({
        ...flow,
        status: 'running',
        updatedAt: new Date().toISOString(),
      });
      this.ensureTask(resumed.id);
    }
  }

  async notifyControllerState(state: WorkflowControllerState): Promise<void> {
    if (ACTIVE_CONTROLLER_STATUSES.has(state.status)) {
      return;
    }
    const flows = await this.listActiveSessionFlows(state.sessionId);
    for (const flow of flows) {
      if (flow.wait?.kind !== 'controller') {
        continue;
      }
      if (flow.wait.controllerId !== state.id) {
        continue;
      }
      const resumed = await this.writeFlowState({
        ...flow,
        status: 'running',
        updatedAt: new Date().toISOString(),
      });
      this.ensureTask(resumed.id);
    }
  }

  private parseRunRequest(body: unknown): WorkflowManagedFlowRunRequest {
    const parsed = workflowManagedFlowRunRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((issue: { path: Array<string | number>; message: string }) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
      );
    }
    return parsed.data;
  }

  private compileFlowContent(snapshot: GraphSnapshot, nodeId: string): WorkflowManagedFlowContent {
    const node = snapshot.nodes.find((entry) => entry.id === nodeId) ?? null;
    if (!node) {
      throw new NotFoundException('WORKFLOW_MANAGED_FLOW_NOT_FOUND');
    }
    if (node.type === 'managed_flow') {
      const parsed = readWorkflowManagedFlowContent(node.content);
      if (!parsed) {
        throw new BadRequestException('WORKFLOW_MANAGED_FLOW_INVALID');
      }
      assertPhaseIds(parsed);
      return {
        ...parsed,
        entryPhaseId: parsed.entryPhaseId ?? parsed.phases[0]?.id,
        phases: parsed.phases.map((phase) => this.normalizePhase(snapshot, phase)),
      };
    }
    if (node.type === 'loop') {
      return {
        title: 'Managed loop',
        syncMode: 'managed',
        entryPhaseId: `loop-${node.id}`,
        phases: [
          {
            id: `loop-${node.id}`,
            kind: 'loop_phase',
            nodeId: node.id,
            title: 'Loop',
          },
        ],
      };
    }
    if (node.type === 'agent_step' || node.type === 'agent_spawn') {
      return {
        title: 'Managed phase',
        syncMode: 'managed',
        entryPhaseId: `agent-${node.id}`,
        phases: [
          {
            id: `agent-${node.id}`,
            kind: 'agent_phase',
            nodeId: node.id,
            expectedOutputs: this.connectedOutputPaths(snapshot, node.id),
            title: 'Agent phase',
          },
        ],
      };
    }
    if (node.type === 'connector_target') {
      return {
        title: 'Managed connector',
        syncMode: 'managed',
        entryPhaseId: `connector-${node.id}`,
        phases: [
          {
            id: `connector-${node.id}`,
            kind: 'connector_phase',
            nodeId: node.id,
            expectedOutputs: this.connectedOutputPaths(snapshot, node.id),
            title: 'Connector phase',
          },
        ],
      };
    }
    if (node.type === 'runtime_target') {
      return {
        title: 'Managed runtime verify',
        syncMode: 'managed',
        entryPhaseId: `verify-${node.id}`,
        phases: [
          {
            id: `verify-${node.id}`,
            kind: 'runtime_verify_phase',
            nodeId: node.id,
            expectedOutputs: this.connectedOutputPaths(snapshot, node.id),
            title: 'Runtime verify',
          },
        ],
      };
    }
    throw new BadRequestException('WORKFLOW_MANAGED_FLOW_ENTRY_UNSUPPORTED');
  }

  private normalizePhase(snapshot: GraphSnapshot, phase: WorkflowManagedFlowPhase): WorkflowManagedFlowPhase {
    if (
      (phase.kind === 'agent_phase' || phase.kind === 'connector_phase' || phase.kind === 'runtime_verify_phase')
      && phase.expectedOutputs.length === 0
    ) {
      return {
        ...phase,
        expectedOutputs: this.connectedOutputPaths(snapshot, phase.nodeId),
      };
    }
    if (phase.kind === 'validation_phase' && phase.expectedOutputs.length === 0 && phase.sourceNodeId) {
      const node = snapshot.nodes.find((entry) => entry.id === phase.sourceNodeId) ?? null;
      const artifact = node?.type === 'workspace_file' ? readWorkflowArtifactContent(node.content) : null;
      if (!artifact?.relativePath) {
        return phase;
      }
      return {
        ...phase,
        expectedOutputs: [artifact.relativePath],
      };
    }
    return phase;
  }

  private async createFlowState(state: WorkflowManagedFlowState): Promise<WorkflowManagedFlowState> {
    await this.prisma.workflowManagedFlow.create({
      data: {
        id: state.id,
        sessionId: state.sessionId,
        entryNodeId: state.entryNodeId,
        status: state.status,
        syncMode: state.syncMode,
        revision: state.revision,
        currentPhaseId: state.currentPhaseId ?? null,
        currentPhaseIndex: state.currentPhaseIndex ?? null,
        cancelRequested: state.cancelRequested,
        wait: state.wait ? (state.wait as Prisma.InputJsonValue) : Prisma.JsonNull,
        state: flowJson(state),
        startedAt: new Date(state.startedAt),
      },
    });
    const saved = await this.loadFlowState(state.id);
    await this.syncFlowNode(saved);
    this.emitFlowState(saved);
    return saved;
  }

  private async writeFlowState(state: WorkflowManagedFlowState): Promise<WorkflowManagedFlowState> {
    const updated = await this.prisma.workflowManagedFlow.updateMany({
      where: { id: state.id, revision: state.revision },
      data: {
        status: state.status,
        syncMode: state.syncMode,
        revision: { increment: 1 },
        currentPhaseId: state.currentPhaseId ?? null,
        currentPhaseIndex: state.currentPhaseIndex ?? null,
        cancelRequested: state.cancelRequested,
        wait: state.wait ? (state.wait as Prisma.InputJsonValue) : Prisma.JsonNull,
        state: flowJson(state),
        startedAt: new Date(state.startedAt),
        endedAt: state.endedAt ? new Date(state.endedAt) : null,
      },
    });
    if (updated.count === 0) {
      return this.loadFlowState(state.id);
    }
    const saved = await this.loadFlowState(state.id);
    await this.syncFlowNode(saved);
    this.emitFlowState(saved);
    return saved;
  }

  private async loadFlowState(flowId: string): Promise<WorkflowManagedFlowState> {
    const row = await this.prisma.workflowManagedFlow.findUnique({ where: { id: flowId } });
    if (!row) {
      throw new NotFoundException('WORKFLOW_MANAGED_FLOW_NOT_FOUND');
    }
    return this.serializeFlowState(row);
  }

  private async listActiveSessionFlows(sessionId: string): Promise<WorkflowManagedFlowState[]> {
    const rows = await this.prisma.workflowManagedFlow.findMany({
      where: {
        sessionId,
        status: { in: ['queued', 'running', 'waiting', 'blocked'] },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.serializeFlowState(row));
  }

  private async syncFlowNode(state: WorkflowManagedFlowState): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(state.sessionId);
    const node = snapshot.nodes.find((entry) => entry.id === state.entryNodeId) ?? null;
    if (!node) {
      return;
    }
    const existing =
      node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {};
    await this.graph.patchNode(
      state.sessionId,
      state.entryNodeId,
      {
        metadata: {
          ...existing,
          ...flowMetadata(state),
        },
      },
      { type: 'system', reason: 'workflow_managed_flow' },
      `workflow-flow:${state.id}`,
    );
  }

  private emitFlowState(state: WorkflowManagedFlowState): void {
    this.collaboration.emitSession(state.sessionId, {
      type: 'workflow.flow_updated',
      eventId: 0,
      sessionId: state.sessionId,
      actor: { type: 'system', id: 'workflow_managed_flow' },
      timestamp: state.updatedAt,
      payload: state,
    });
  }

  private ensureTask(flowId: string): void {
    if (this.supervisor) {
      void this.queueFlowTask(flowId);
      return;
    }
    if (this.tasks.has(flowId)) {
      return;
    }
    const task = this.runTask(flowId).finally(() => {
      this.tasks.delete(flowId);
    });
    this.tasks.set(flowId, task);
  }

  private async runTask(flowId: string): Promise<void> {
    await this.executeQueuedFlow(flowId);
  }

  async executeQueuedFlow(flowId: string, _workerId?: string): Promise<Record<string, unknown>> {
    try {
      while (true) {
        const state = await this.loadFlowState(flowId);
        if (TERMINAL_FLOW_STATUSES.has(state.status) || state.status === 'waiting' || state.status === 'blocked') {
          return { flowId, status: state.status };
        }
        const next = await this.advanceFlow(state);
        if (next !== 'continue') {
          return { flowId, status: next };
        }
      }
    } catch (errorValue) {
      const current = await this.prisma.workflowManagedFlow.findUnique({ where: { id: flowId } });
      if (!current) {
        return { flowId, status: 'missing' };
      }
      const state = this.serializeFlowState(current);
      const detail = errorValue instanceof Error ? errorValue.message : String(errorValue);
      await this.writeFlowState({
        ...state,
        status: 'failed',
        lastDetail: detail,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      return { flowId, status: 'failed', detail };
    }
  }

  private async queueFlowTask(flowId: string): Promise<void> {
    const row = await this.prisma.workflowManagedFlow.findUnique({
      where: { id: flowId },
      select: { id: true, sessionId: true },
    });
    if (!row) {
      return;
    }
    await this.supervisor?.queueFlow(row.sessionId, {
      flowId: row.id,
    });
  }

  private async advanceFlow(state: WorkflowManagedFlowState): Promise<FlowAdvance> {
    const session = await this.loadSession(state.sessionId);
    if (state.cancelRequested) {
      await this.writeFlowState({
        ...state,
        status: 'cancelled',
        wait: undefined,
        lastDetail: state.lastDetail ?? 'cancel requested',
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      return 'stop';
    }
    const snapshot = await this.graph.loadSnapshot(state.sessionId);
    const phase = currentPhase(state);
    if (!phase) {
      await this.writeFlowState({
        ...state,
        status: 'completed',
        wait: undefined,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      return 'stop';
    }
    if (phase.kind === 'loop_phase') {
      return this.advanceLoopPhase(state, phase, session);
    }
    if (phase.kind === 'connector_phase') {
      return this.advanceConnectorPhase(state, snapshot, phase, session);
    }
    if (phase.kind === 'agent_phase' || phase.kind === 'runtime_verify_phase') {
      return this.advanceExecutionPhase(state, snapshot, phase, session);
    }
    if (phase.kind === 'validation_phase') {
      return this.advanceValidationPhase(state, snapshot, phase, session);
    }
    return this.advanceDerivePhase(state, snapshot, phase, session);
  }

  private async advanceLoopPhase(
    state: WorkflowManagedFlowState,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'loop_phase' }>,
    session: SessionRow,
  ): Promise<FlowAdvance> {
    const record = phaseRecord(state, phase);
    const forceRestart = phaseForceRestartIds(state).has(phase.id) || (phase.forceRestart === true && record.attempts > 0);
    if (record.controllerId && !forceRestart) {
      const controller = await this.prisma.workflowControllerState.findUnique({ where: { id: record.controllerId } });
      if (controller && ACTIVE_CONTROLLER_STATUSES.has(controller.status as WorkflowControllerState['status'])) {
        await this.writeFlowState(
          waitingState(state, phase, {
            ...record,
            status: 'waiting',
            updatedAt: new Date().toISOString(),
          }, {
            kind: 'controller',
            phaseId: phase.id,
            controllerId: record.controllerId,
            nodeId: phase.nodeId,
          }),
        );
        return 'yield';
      }
      if (!controller) {
        await this.writeFlowState(failedState(state, phase, record, 'loop controller missing'));
        return 'stop';
      }
      const summary = this.controllerDetail(controller);
      if (controller.status === 'completed') {
        await this.writeFlowState(this.completedState(state, phase, record, summary));
        return 'continue';
      }
      if (controller.status === 'blocked') {
        await this.writeFlowState(blockedState(state, phase, record, summary));
        return 'stop';
      }
      if (controller.status === 'cancelled') {
        await this.writeFlowState(failedState(state, phase, record, summary, 'cancelled'));
        return 'stop';
      }
      await this.writeFlowState(failedState(state, phase, record, summary));
      return 'stop';
    }

    const started = await this.controllers.run(state.sessionId, phase.nodeId, {
      requestId: phaseRequestId(state, phase.id, record.attempts + 1),
      workingDirectory: this.resolveWorkingDirectory(session),
      forceRestart,
    });
    const next = await this.writeFlowState(
      waitingState(
        {
          ...state,
          state: withPhaseRestart(state, phase.id, false),
        },
        phase,
        {
          ...record,
          status: 'waiting',
          attempts: record.attempts + 1,
          controllerId: started.controllerId,
          detail: undefined,
          startedAt: record.startedAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          kind: 'controller',
          phaseId: phase.id,
          controllerId: started.controllerId,
          nodeId: phase.nodeId,
        },
      ),
    );
    const controller = await this.prisma.workflowControllerState.findUnique({ where: { id: started.controllerId } });
    if (controller && !ACTIVE_CONTROLLER_STATUSES.has(controller.status as WorkflowControllerState['status'])) {
      await this.writeFlowState({
        ...next,
        status: 'running',
        updatedAt: new Date().toISOString(),
      });
      return 'continue';
    }
    return 'yield';
  }

  private async advanceConnectorPhase(
    state: WorkflowManagedFlowState,
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'connector_phase' }>,
    session: SessionRow,
  ): Promise<FlowAdvance> {
    if (!this.connectors) {
      throw new Error('WORKFLOW_MANAGED_FLOW_CONNECTORS_UNAVAILABLE');
    }
    const record = phaseRecord(state, phase);
    const requestId = phaseRequestId(state, phase.id, record.attempts + 1);
    const summary = await this.connectors.runManagedTarget(state.sessionId, phase.nodeId, requestId);
    const detail = summary.detail ?? summary.error ?? `connector ${summary.status}`;
    const nextRecord: WorkflowManagedFlowPhaseRecord = {
      ...record,
      status: summary.status === 'completed' ? 'completed' : summary.status === 'cancelled' ? 'cancelled' : 'failed',
      attempts: record.attempts + 1,
      runId: summary.runNodeId,
      executionId: undefined,
      detail,
      startedAt: summary.startedAt ?? record.startedAt ?? new Date().toISOString(),
      endedAt: summary.endedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const evaluation = await this.evaluateExecution({
      session,
      snapshot,
      childStatus: summary.status,
      run: {
        id: summary.runNodeId,
        outputText: detail,
        status: summary.status,
        startedAt: new Date(summary.startedAt ?? new Date().toISOString()),
        endedAt: summary.endedAt ? new Date(summary.endedAt) : new Date(),
      },
      connector: summary,
      validatorNodeId: phase.validatorNodeId,
      expectedOutputs: phase.expectedOutputs,
    });
    await this.recordPhaseEvaluation(state, snapshot, phase, nextRecord, evaluation);
    if (evaluation.outcome === 'pass' || evaluation.outcome === 'complete') {
      await this.writeFlowState(
        this.completedState(
          {
            ...state,
            state: withPhaseRestart(state, phase.id, false),
          },
          phase,
          nextRecord,
          evaluation.detail,
        ),
      );
      return 'continue';
    }
    if (
      (evaluation.outcome === 'retry_same_item' || evaluation.outcome === 'retry_new_execution')
      && nextRecord.attempts < 3
    ) {
      await this.writeFlowState({
        ...state,
        status: 'running',
        wait: undefined,
        lastDetail: evaluation.detail,
        updatedAt: new Date().toISOString(),
        state: withPhaseRestart(state, phase.id, false),
        phaseRecords: {
          ...state.phaseRecords,
          [phase.id]: {
            ...nextRecord,
            status: 'pending',
            runId: undefined,
            detail: evaluation.detail,
            endedAt: undefined,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      return 'continue';
    }
    if (evaluation.outcome === 'request_human' || evaluation.outcome === 'block') {
      await this.writeFlowState(blockedState(state, phase, nextRecord, evaluation.detail));
      return 'stop';
    }
    await this.writeFlowState(failedState(state, phase, nextRecord, evaluation.detail));
    return 'stop';
  }

  private async advanceExecutionPhase(
    state: WorkflowManagedFlowState,
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'agent_phase' | 'runtime_verify_phase' }>,
    session: SessionRow,
  ): Promise<FlowAdvance> {
    const record = phaseRecord(state, phase);
    const forceRestart = phaseForceRestartIds(state).has(phase.id);
    if (record.executionId && !forceRestart) {
      const execution = await this.prisma.workflowExecution.findUnique({ where: { id: record.executionId } });
      if (execution && ACTIVE_AGENT_STATUSES.has(execution.status as AgentLifecycleStatus)) {
        await this.writeFlowState(
          waitingState(
            state,
            phase,
            {
              ...record,
              status: 'waiting',
              updatedAt: new Date().toISOString(),
            },
            {
              kind: 'execution',
              phaseId: phase.id,
              executionId: record.executionId,
              nodeId: phase.nodeId,
              ...(record.runId ? { runId: record.runId } : {}),
            },
          ),
        );
        return 'yield';
      }
      const run = record.runId
        ? await this.prisma.agentRun.findUnique({
            where: { id: record.runId },
            select: { id: true, outputText: true, status: true, startedAt: true, endedAt: true },
          })
        : null;
      const evaluation = await this.evaluateExecution({
        session,
        snapshot,
        childStatus:
          (execution?.status as AgentLifecycleStatus | undefined)
          ?? (run?.status as AgentLifecycleStatus | undefined)
          ?? 'failed',
        run,
        validatorNodeId: phase.validatorNodeId,
        expectedOutputs: phase.expectedOutputs,
      });
      await this.recordPhaseEvaluation(state, snapshot, phase, record, evaluation);
      if (evaluation.outcome === 'pass' || evaluation.outcome === 'complete') {
        await this.writeFlowState(this.completedState(state, phase, record, evaluation.detail));
        return 'continue';
      }
      if (
        (evaluation.outcome === 'retry_same_item' || evaluation.outcome === 'retry_new_execution')
        && record.attempts < 3
      ) {
        await this.writeFlowState({
          ...state,
          status: 'running',
          wait: undefined,
          lastDetail: evaluation.detail,
          updatedAt: new Date().toISOString(),
          phaseRecords: {
            ...state.phaseRecords,
            [phase.id]: {
              ...record,
              status: 'pending',
              executionId: undefined,
              runId: undefined,
              detail: evaluation.detail,
              endedAt: undefined,
              updatedAt: new Date().toISOString(),
            },
          },
        });
        return 'continue';
      }
      if (evaluation.outcome === 'request_human' || evaluation.outcome === 'block') {
        await this.writeFlowState(blockedState(state, phase, record, evaluation.detail));
        return 'stop';
      }
      await this.writeFlowState(failedState(state, phase, record, evaluation.detail));
      return 'stop';
    }

    const selection = this.phaseSelection(snapshot, phase.nodeId, phase.selection);
    const cwd = this.resolveWorkingDirectory(session);
    const seedNodeIds = this.phaseSeedNodeIds(snapshot, phase.nodeId);
    if (seedNodeIds.length === 0) {
      throw new BadRequestException('WORKFLOW_MANAGED_FLOW_PHASE_EMPTY');
    }
    const spawned = await this.agents.spawn(
      state.sessionId,
      {
        requestId: phaseRequestId(state, phase.id, record.attempts + 1),
        type: selection.type,
        role: selection.role,
        runtime: { kind: 'local_process', cwd },
        workingDirectory: cwd,
        triggerNodeId: phase.nodeId,
        wakeReason: 'manual',
        seedNodeIds,
        managedContract: {
          phaseKind: phase.kind,
          expectedOutputs: phase.expectedOutputs,
          ...(phase.validatorNodeId ? { validatorNodeId: phase.validatorNodeId } : {}),
        },
        ...(selection.model ? { model: selection.model } : {}),
        newExecution: forceRestart ? true : (phase.newExecution ?? true),
      },
      { allowLoopChildRun: true },
    );
    const run = await this.prisma.agentRun.findUnique({
      where: { id: spawned.data.agentRunId },
      select: { executionId: true },
    });
    if (!run?.executionId) {
      throw new Error('WORKFLOW_MANAGED_FLOW_EXECUTION_MISSING');
    }
    const next = await this.writeFlowState(
      waitingState(
        {
          ...state,
          state: withPhaseRestart(state, phase.id, false),
        },
        phase,
        {
          ...record,
          status: 'waiting',
          attempts: record.attempts + 1,
          executionId: run.executionId,
          runId: spawned.data.agentRunId,
          detail: undefined,
          startedAt: record.startedAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          kind: 'execution',
          phaseId: phase.id,
          executionId: run.executionId,
          nodeId: phase.nodeId,
          runId: spawned.data.agentRunId,
        },
      ),
    );
    const execution = await this.prisma.workflowExecution.findUnique({ where: { id: run.executionId } });
    if (execution && !ACTIVE_AGENT_STATUSES.has(execution.status as AgentLifecycleStatus)) {
      await this.writeFlowState({
        ...next,
        status: 'running',
        updatedAt: new Date().toISOString(),
      });
      return 'continue';
    }
    return 'yield';
  }

  private async advanceValidationPhase(
    state: WorkflowManagedFlowState,
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'validation_phase' }>,
    session: SessionRow,
  ): Promise<FlowAdvance> {
    const record = phaseRecord(state, phase);
    const run = this.latestRunBeforePhase(state, phase.id);
    const outputs =
      phase.expectedOutputs.length > 0
        ? phase.expectedOutputs
        : phase.sourceNodeId
          ? this.outputPathsFromNode(snapshot, phase.sourceNodeId)
          : [];
    const evaluation = await this.evaluateExecution({
      session,
      snapshot,
      childStatus: 'completed',
      run,
      validatorNodeId: phase.validatorNodeId,
      expectedOutputs: outputs,
      passDetail: phase.passDetail,
    });
    await this.recordPhaseEvaluation(state, snapshot, phase, record, evaluation);
    if (evaluation.outcome === 'pass' || evaluation.outcome === 'complete') {
      await this.writeFlowState(this.completedState(state, phase, record, evaluation.detail));
      return 'continue';
    }
    await this.writeFlowState(blockedState(state, phase, record, evaluation.detail));
    return 'stop';
  }

  private async advanceDerivePhase(
    state: WorkflowManagedFlowState,
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'derive_input_phase' }>,
    session: SessionRow,
  ): Promise<FlowAdvance> {
    const record = phaseRecord(state, phase);
    const source = snapshot.nodes.find((entry) => entry.id === phase.sourceNodeId) ?? null;
    const artifact = source?.type === 'workspace_file' ? readWorkflowArtifactContent(source.content) : null;
    if (!source || !artifact) {
      await this.writeFlowState(failedState(state, phase, record, 'derive source missing'));
      return 'stop';
    }
    const resolvedPath = resolveWorkflowArtifactRelativePath(artifact);
    const absolutePath = path.resolve(this.resolveWorkingDirectory(session), resolvedPath);
    const raw = await readTextSafe(absolutePath);
    if (!raw.trim()) {
      await this.writeFlowState(blockedState(state, phase, record, `derive source empty ${resolvedPath}`));
      return 'stop';
    }
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.writeFlowState(blockedState(state, phase, record, `derive source invalid json ${resolvedPath}`));
      return 'stop';
    }
    const items = readWorkflowJsonPath(parsed, phase.jsonPath);
    if (!Array.isArray(items)) {
      await this.writeFlowState(blockedState(state, phase, record, `derive path missing ${phase.jsonPath}`));
      return 'stop';
    }
    const texts = items.map(stringifyDerivedItem).filter((entry): entry is string => Boolean(entry));
    if (texts.length === 0) {
      await this.writeFlowState(this.completedState(state, phase, record, 'no gaps detected'));
      return 'continue';
    }
    const sourceNode = source;
    const position = sourceNode.position ?? { x: 0, y: 0 };
    const summaryValue = phase.summaryPath ? readWorkflowJsonPath(parsed, phase.summaryPath) : undefined;
    const summary = typeof summaryValue === 'string' && summaryValue.trim() ? summaryValue.trim() : `Derived ${texts.length} work item(s)`;
    const nodeEnv = await this.graph.addNode(state.sessionId, {
      type: 'input',
      content: {
        mode: 'bound',
        templateNodeId: phase.targetTemplateNodeId,
        parts: texts.map((text, index) => ({
          id: `part-${index + 1}`,
          type: 'text',
          text,
        })),
        summary,
      },
      position: { x: position.x + 320, y: position.y + 40 },
      creator: { type: 'system', reason: 'workflow_managed_flow' },
      metadata: {
        runtimeOwned: 'workflow_managed_flow',
        flowId: state.id,
        phaseId: phase.id,
      },
    });
    const boundNodeId = nodeEnv.payload.type === 'node_added' ? nodeEnv.payload.node.id : null;
    if (!boundNodeId) {
      throw new Error('WORKFLOW_MANAGED_FLOW_DERIVE_NODE_CREATE_FAILED');
    }
    await this.graph.addEdge(state.sessionId, {
      source: phase.targetTemplateNodeId,
      target: boundNodeId,
      relation: 'derived_from',
      direction: 'source_to_target',
      creator: { type: 'system', reason: 'workflow_managed_flow' },
      metadata: {
        runtimeOwned: 'workflow_managed_flow',
        flowId: state.id,
        phaseId: phase.id,
      },
    });
    const detail = `derived ${texts.length} work item(s)`;
    const next = this.completedState(state, phase, record, detail, phase.restartPhaseId);
    await this.writeFlowState({
      ...next,
      state: {
        ...next.state,
        lastDerivedBoundNodeId: boundNodeId,
        lastDerivedCount: texts.length,
      },
    });
    return 'continue';
  }

  private phaseSelection(
    snapshot: GraphSnapshot,
    nodeId: string,
    override?: { type?: AgentType; model?: AgentModelRef },
  ): { type: AgentType; role: string; model?: AgentModelRef } {
    const node = snapshot.nodes.find((entry) => entry.id === nodeId) ?? null;
    const selection = node ? readGraphNodeLockedSelection(node) : null;
    const role =
      typeof (node?.content as { role?: unknown } | undefined)?.role === 'string'
        ? (((node?.content as { role?: string }).role ?? '').trim() || 'builder')
        : 'builder';
    return {
      type: override?.type ?? selection?.type ?? 'opencode',
      role,
      ...(override?.model ?? selection?.model ? { model: override?.model ?? selection?.model } : {}),
    };
  }

  private async recordPhaseEvaluation(
    state: WorkflowManagedFlowState,
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'agent_phase' | 'connector_phase' | 'runtime_verify_phase' | 'validation_phase' }>,
    record: WorkflowManagedFlowPhaseRecord,
    evaluation: PhaseEvaluation,
  ): Promise<void> {
    if (!this.evals) {
      return;
    }
    const kind = this.phaseReportKind(snapshot, phase);
    if (!kind) {
      return;
    }
    const role = this.phaseRole(snapshot, phase);
    const nextRole = nextSoftwareRole(role);
    const outcome =
      evaluation.outcome === 'pass' || evaluation.outcome === 'complete'
        ? kind === 'integration'
          ? 'integrate'
          : 'pass'
        : evaluation.outcome === 'retry_same_item' || evaluation.outcome === 'retry_new_execution'
          ? 'rework'
          : evaluation.outcome === 'request_human'
            ? 'request_human'
            : 'block';
    await this.evals.record({
      sessionId: state.sessionId,
      kind,
      outcome,
      summary: evaluation.detail,
      nodeId: currentPhaseNodeId(phase),
      flowId: state.id,
      phaseId: phase.id,
      runId: record.runId,
      executionId: record.executionId,
      details: {
        expectedOutputs: 'expectedOutputs' in phase ? phase.expectedOutputs : [],
        validatorNodeId: phase.kind === 'validation_phase' ? phase.validatorNodeId : phase.validatorNodeId,
      },
      handoff: {
        fromRole: role,
        toRole: nextRole,
        status: outcome === 'pass' || outcome === 'integrate' ? 'ready' : outcome === 'rework' ? 'rework' : 'blocked',
        summary: evaluation.detail,
        artifactNodeIds: currentPhaseNodeId(phase) ? [currentPhaseNodeId(phase) as string] : [],
      },
    });
  }

  private phaseReportKind(
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'agent_phase' | 'connector_phase' | 'runtime_verify_phase' | 'validation_phase' }>,
  ): 'review' | 'test' | 'integration' | 'validation' | null {
    if (phase.kind === 'validation_phase' || phase.kind === 'connector_phase' || phase.kind === 'runtime_verify_phase') {
      return 'test';
    }
    const role = this.phaseRole(snapshot, phase);
    if (role === 'reviewer') {
      return 'review';
    }
    if (role === 'tester') {
      return 'test';
    }
    if (role === 'integrator') {
      return 'integration';
    }
    return 'validation';
  }

  private phaseRole(
    snapshot: GraphSnapshot,
    phase: Extract<WorkflowManagedFlowPhase, { kind: 'agent_phase' | 'connector_phase' | 'runtime_verify_phase' | 'validation_phase' }>,
  ): 'orchestrator' | 'planner' | 'builder' | 'reviewer' | 'tester' | 'integrator' | 'observer' {
    if (phase.kind === 'validation_phase' || phase.kind === 'connector_phase') {
      return 'tester';
    }
    const selection = this.phaseSelection(snapshot, phase.nodeId, phase.selection);
    return normalizeSoftwareRole(selection.role);
  }

  private phaseSeedNodeIds(snapshot: GraphSnapshot, nodeId: string): string[] {
    return collectPhasePromptNodeIds(snapshot, nodeId);
  }

  private connectedOutputPaths(snapshot: GraphSnapshot, nodeId: string): string[] {
    return uniq(
      collectPhaseNodeIds(snapshot, nodeId)
        .map((id) => snapshot.nodes.find((entry) => entry.id === id) ?? null)
        .filter((node): node is GraphNode => Boolean(node?.type === 'workspace_file'))
        .map((node) => readWorkflowArtifactContent(node.content))
        .filter((artifact): artifact is NonNullable<ReturnType<typeof readWorkflowArtifactContent>> => Boolean(artifact?.role === 'output'))
        .map((artifact) => artifact.relativePath),
    );
  }

  private outputPathsFromNode(snapshot: GraphSnapshot, nodeId: string): string[] {
    const node = snapshot.nodes.find((entry) => entry.id === nodeId) ?? null;
    const artifact = node?.type === 'workspace_file' ? readWorkflowArtifactContent(node.content) : null;
    return artifact?.relativePath ? [artifact.relativePath] : [];
  }

  private latestRunBeforePhase(
    state: WorkflowManagedFlowState,
    phaseId: string,
  ): { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null {
    const index = phaseIndex(state, phaseId);
    if (index < 0) {
      return null;
    }
    for (let current = index - 1; current >= 0; current -= 1) {
      const phase = state.phases[current];
      if (!phase) {
        continue;
      }
      const record = state.phaseRecords[phase.id];
      if (!record?.runId) {
        continue;
      }
      return {
        id: record.runId,
        outputText: typeof record.detail === 'string' ? record.detail : null,
        status: record.status,
        startedAt: new Date(record.startedAt ?? state.startedAt),
        endedAt: record.endedAt ? new Date(record.endedAt) : null,
      };
    }
    return null;
  }

  private controllerDetail(row: {
    status: string;
    state: unknown;
  }): string {
    const parsed = readWorkflowManagedDetail(row.state);
    return parsed ?? `loop ${row.status}`;
  }

  private async evaluateExecution(input: {
    session: SessionRow;
    snapshot: GraphSnapshot;
    childStatus: string;
    run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
    connector?: ConnectorRunSummary;
    validatorNodeId?: string;
    expectedOutputs: string[];
    passDetail?: string;
  }): Promise<PhaseEvaluation> {
    const validatorNode = input.validatorNodeId
      ? input.snapshot.nodes.find((entry) => entry.id === input.validatorNodeId) ?? null
      : null;
    const validator = validatorNode ? readWorkflowDecisionValidatorContent(validatorNode.content) : null;
    if (input.childStatus !== 'completed') {
      return {
        outcome:
          input.childStatus === 'cancelled'
            ? validator?.blockAction === 'request_human'
              ? 'request_human'
              : 'block'
            : validator?.failAction === 'retry_new_execution'
              ? 'retry_new_execution'
              : 'retry_same_item',
        detail: `child run ${input.childStatus}`,
      };
    }

    const cwd = this.resolveWorkingDirectory(input.session);
    const checks: Array<{ ok: boolean; detail: string }> = [];
    for (const relativePath of input.expectedOutputs) {
      const resolvedPath = resolveOutputPath(input.snapshot, relativePath, input.run?.id);
      const absolutePath = path.resolve(cwd, resolvedPath);
      const stat = await statSafe(absolutePath);
      checks.push({
        ok: Boolean(stat),
        detail: `expected output ${formatPathDetail(relativePath, resolvedPath)}`,
      });
      if (stat) {
        checks.push({
          ok: isOutputFresh(stat.mtimeMs, input.run?.startedAt),
          detail: `expected output fresh ${formatPathDetail(relativePath, resolvedPath)}`,
        });
      }
    }
    if (validator) {
      for (const evidence of validator.evidenceFrom) {
        const resolvedPath = resolveOutputPath(input.snapshot, evidence, input.run?.id);
        const absolutePath = path.resolve(cwd, resolvedPath);
        checks.push({
          ok: await exists(absolutePath),
          detail: `evidence ${formatPathDetail(evidence, resolvedPath)}`,
        });
      }
      for (const check of validator.checks) {
        if (check.kind === 'connector_status_is') {
          checks.push({
            ok: input.connector?.status === check.status,
            detail: `connector status is ${check.status}`,
          });
          continue;
        }
        if (check.kind === 'connector_exit_code_in') {
          checks.push({
            ok: input.connector?.exitCode != null && check.codes.includes(input.connector.exitCode),
            detail: `connector exit code in [${check.codes.join(', ')}]`,
          });
          continue;
        }
        if (check.kind === 'connector_http_status_in') {
          checks.push({
            ok: input.connector?.httpStatus != null && check.statuses.includes(input.connector.httpStatus),
            detail: `connector http status in [${check.statuses.join(', ')}]`,
          });
          continue;
        }
        const resolvedPath = resolveOutputPath(input.snapshot, check.path, input.run?.id);
        const absolutePath = path.resolve(cwd, resolvedPath);
        if (check.kind === 'path_exists') {
          checks.push({
            ok: await exists(absolutePath),
            detail: `path exists ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'path_not_exists') {
          checks.push({
            ok: !(await exists(absolutePath)),
            detail: `path not exists ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'path_nonempty') {
          const stat = await statSafe(absolutePath);
          checks.push({
            ok: Boolean(stat && stat.size > 0),
            detail: `path nonempty ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'file_contains') {
          const text = await readTextSafe(absolutePath);
          checks.push({
            ok: text.includes(check.text),
            detail: `file contains ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'file_not_contains') {
          const text = await readTextSafe(absolutePath);
          checks.push({
            ok: !text.includes(check.text),
            detail: `file not contains ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'file_last_line_equals') {
          const text = await readTextSafe(absolutePath);
          checks.push({
            ok: hasLastLine(text, check.text),
            detail: `file last line equals ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'json_array_nonempty') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          const ok = Array.isArray(parsed) && parsed.length > 0;
          checks.push({
            ok,
            detail: `json array nonempty ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'json_path_exists') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          checks.push({
            ok: hasWorkflowJsonPath(parsed, check.jsonPath),
            detail: `json path exists ${formatPathDetail(check.path, resolvedPath)} @ ${check.jsonPath}`,
          });
          continue;
        }
        if (check.kind === 'json_path_nonempty') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          checks.push({
            ok: hasWorkflowJsonPathNonempty(parsed, check.jsonPath),
            detail: `json path nonempty ${formatPathDetail(check.path, resolvedPath)} @ ${check.jsonPath}`,
          });
          continue;
        }
        if (check.kind === 'json_path_array_nonempty') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          checks.push({
            ok: hasWorkflowJsonPathArrayNonempty(parsed, check.jsonPath),
            detail: `json path array nonempty ${formatPathDetail(check.path, resolvedPath)} @ ${check.jsonPath}`,
          });
          continue;
        }
        if (check.kind === 'workflow_transfer_valid') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          const res = parseWorkflowTransfer(parsed);
          checks.push({
            ok: res.success,
            detail: `workflow transfer valid ${formatPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
      }
    }
    const failed = checks.filter((entry) => !entry.ok);
    if (failed.length === 0) {
      return {
        outcome: validator?.passAction === 'complete' ? 'complete' : 'pass',
        detail: input.passDetail ?? input.run?.outputText?.trim().slice(0, 160) ?? 'validation passed',
      };
    }
    const detail = failed.map((entry) => entry.detail).join(', ');
    if (validator?.failAction === 'retry_new_execution') {
      return { outcome: 'retry_new_execution', detail };
    }
    if (validator?.failAction === 'request_human') {
      return { outcome: 'request_human', detail };
    }
    return { outcome: 'block', detail };
  }

  private async loadSession(sessionId: string): Promise<SessionRow> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        workspaceParentDirectory: true,
        workspaceDirectoryName: true,
      },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    return session;
  }

  private resolveWorkingDirectory(session: SessionRow, workingDirectory?: string): string {
    const stored = readSessionWorkspace(process.cwd(), session);
    return path.resolve(process.cwd(), workingDirectory ?? stored?.workingDirectory ?? process.cwd());
  }

}

function readWorkflowManagedDetail(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as { lastDecisionDetail?: unknown; lastDetail?: unknown };
  if (typeof record.lastDecisionDetail === 'string' && record.lastDecisionDetail.trim()) {
    return record.lastDecisionDetail.trim();
  }
  if (typeof record.lastDetail === 'string' && record.lastDetail.trim()) {
    return record.lastDetail.trim();
  }
  return null;
}

function normalizeSoftwareRole(
  role: string,
): 'orchestrator' | 'planner' | 'builder' | 'reviewer' | 'tester' | 'integrator' | 'observer' {
  if (role === 'orchestrator' || role === 'planner' || role === 'builder' || role === 'reviewer' || role === 'tester' || role === 'integrator' || role === 'observer') {
    return role;
  }
  return 'builder';
}

function nextSoftwareRole(
  role: 'orchestrator' | 'planner' | 'builder' | 'reviewer' | 'tester' | 'integrator' | 'observer',
): 'orchestrator' | 'planner' | 'builder' | 'reviewer' | 'tester' | 'integrator' | 'observer' {
  if (role === 'planner') return 'builder';
  if (role === 'builder') return 'reviewer';
  if (role === 'reviewer') return 'tester';
  if (role === 'tester') return 'integrator';
  if (role === 'integrator') return 'observer';
  return 'builder';
}

function collectPhasePromptNodeIds(snapshot: GraphSnapshot, startId: string): string[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const links = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    const source = links.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    links.set(edge.source, source);
    const target = links.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    links.set(edge.target, target);
  }
  const queue = [startId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    const node = byId.get(current);
    if (!node) {
      continue;
    }
    const isStart = current === startId;
    if (!isStart && isPhasePromptBoundary(node)) {
      continue;
    }
    seen.add(current);
    if (!shouldExpandPhasePrompt(node, isStart)) {
      continue;
    }
    for (const next of links.get(current) ?? []) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
    for (const next of structuredPhaseNodeIds(node)) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return [...seen];
}

function collectPhaseNodeIds(snapshot: GraphSnapshot, startId: string): string[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const links = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    const source = links.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    links.set(edge.source, source);
    const target = links.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    links.set(edge.target, target);
  }
  const queue = [startId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    const node = byId.get(current);
    if (!node) {
      continue;
    }
    if (current !== startId && (node.type === 'loop' || node.type === 'managed_flow')) {
      continue;
    }
    seen.add(current);
    for (const next of links.get(current) ?? []) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
    for (const next of structuredPhaseNodeIds(node)) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return [...seen];
}

function isPhasePromptBoundary(node: GraphNode): boolean {
  return node.type === 'agent_spawn'
    || node.type === 'agent_step'
    || node.type === 'loop'
    || node.type === 'managed_flow'
    || node.type === 'connector_target'
    || node.type === 'runtime_target'
    || node.type === 'sub_graph';
}

function shouldExpandPhasePrompt(node: GraphNode, isStart: boolean): boolean {
  if (isStart) {
    return true;
  }
  if (node.type === 'agent_message') {
    return true;
  }
  if (node.type === 'file_summary') {
    return true;
  }
  if (node.type === 'human_message') {
    return true;
  }
  if (node.type === 'input') {
    return true;
  }
  if (node.type === 'note') {
    return true;
  }
  if (node.type !== 'workspace_file') {
    return false;
  }
  return readWorkflowArtifactContent(node.content)?.role === 'input';
}

function structuredPhaseNodeIds(node: GraphNode): string[] {
  if (node.type === 'loop') {
    const loop = readWorkflowLoopContent(node.content);
    if (!loop) {
      return [];
    }
    return [
      loop.bodyNodeId,
      loop.validatorNodeId,
      loop.source.kind === 'input_parts' ? loop.source.templateNodeId : undefined,
      loop.source.kind === 'input_parts' ? loop.source.boundNodeId : undefined,
      loop.source.kind === 'json_file' ? loop.source.fileNodeId : undefined,
    ].filter((entry): entry is string => Boolean(entry));
  }
  if (node.type === 'sub_graph') {
    const subgraph = readWorkflowSubgraphContent(node.content);
    return subgraph?.entryNodeId ? [subgraph.entryNodeId] : [];
  }
  if (node.type === 'managed_flow') {
    return collectManagedFlowReferencedNodeIds(node.content);
  }
  if (node.type === 'runtime_target') {
    const runtime = readRuntimeTargetSummary(node.content);
    return runtime?.outputNodeId ? [runtime.outputNodeId] : [];
  }
  return [];
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stringifyDerivedItem(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const lines = [
    typeof record.title === 'string' ? record.title.trim() : null,
    typeof record.text === 'string' ? record.text.trim() : null,
    typeof record.description === 'string' ? record.description.trim() : null,
    typeof record.reason === 'string' ? record.reason.trim() : null,
  ].filter((entry): entry is string => Boolean(entry));
  if (lines.length === 0) {
    return JSON.stringify(value);
  }
  return lines.join('\n');
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function statSafe(target: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(target);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

async function readTextSafe(target: string): Promise<string> {
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    return '';
  }
}

function hasLastLine(text: string, expected: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) {
    lines.pop();
  }
  return (lines[lines.length - 1] ?? '').trim() === expected.trim();
}

function isOutputFresh(mtimeMs: number, startedAt?: Date): boolean {
  if (!startedAt) {
    return true;
  }
  return mtimeMs >= startedAt.getTime() - 1000;
}

function readOutputDefinition(
  snapshot: GraphSnapshot,
  relativePath: string,
): NonNullable<ReturnType<typeof readWorkflowArtifactContent>> | null {
  return snapshot.nodes
    .filter((node) => node.type === 'workspace_file')
    .map((node) => readWorkflowArtifactContent(node.content))
    .filter(
      (
        artifact,
      ): artifact is NonNullable<ReturnType<typeof readWorkflowArtifactContent>> =>
        Boolean(artifact?.role === 'output' && artifact.relativePath === relativePath),
    )
    .sort((a, b) => outputDefinitionScore(b) - outputDefinitionScore(a))[0]
    ?? null;
}

function outputDefinitionScore(artifact: NonNullable<ReturnType<typeof readWorkflowArtifactContent>>): number {
  return (artifact.pathMode === 'per_run' ? 2 : 0) + (artifact.origin === 'agent_output' ? 1 : 0);
}

function resolveOutputPath(snapshot: GraphSnapshot, relativePath: string, runId?: string): string {
  const artifact = readOutputDefinition(snapshot, relativePath);
  if (!artifact) {
    return relativePath;
  }
  return resolveWorkflowArtifactRelativePath(
    {
      relativePath,
      ...(artifact.pathMode ? { pathMode: artifact.pathMode } : {}),
      ...(artifact.resolvedRelativePath ? { resolvedRelativePath: artifact.resolvedRelativePath } : {}),
    },
    runId,
  );
}

function formatPathDetail(relativePath: string, resolvedPath: string): string {
  return relativePath === resolvedPath ? relativePath : `${relativePath} -> ${resolvedPath}`;
}
