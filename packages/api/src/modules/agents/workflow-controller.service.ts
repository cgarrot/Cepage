import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AgentLifecycleStatus, AgentRun, GraphNode } from '@cepage/shared-core';
import {
  readWorkflowArtifactContent,
  readWorkflowDecisionValidatorContent,
  readWorkflowLoopContent,
  readWorkflowSubgraphContent,
  resolveWorkflowArtifactRelativePath,
  type WorkflowControllerRunRequest,
  type WorkflowControllerRunResult,
  type WorkflowControllerState,
  workflowControllerRunRequestSchema,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import { GraphService } from '../graph/graph.service';
import { ActivityService } from '../activity/activity.service';
import { CollaborationBusService } from '../collaboration/collaboration-bus.service';
import { AgentsService } from './agents.service';
import { RunSupervisorService } from '../execution/run-supervisor.service';
import {
  collectWorkflowPromptInputs,
  hasWorkflowFileLastLine,
  isWorkflowOutputFresh,
  normalizeControllerItem,
  pickWorkflowControllerOutputNodeId,
  pickWorkflowControllerPromptNodeId,
  pickWorkflowChildSelection,
  renderReferencedWorkflowPrompt,
  summarizeValidatorRequirements,
  type WorkflowControllerItemValue,
} from './workflow-controller.util';
import {
  hasWorkflowJsonPath,
  hasWorkflowJsonPathArrayNonempty,
  hasWorkflowJsonPathNonempty,
  parseWorkflowJsonText,
} from './workflow-json.util';
import { WorkflowManagedFlowNotifierService } from './workflow-managed-flow-notifier.service';
import {
  ACTIVE_RUN_STATUSES,
  buildInitialControllerState,
  controllerDynamicState,
  controllerMetadata,
  isControllerRunning,
  mapExecutionStatus,
  runtimeData,
  serializeControllerState,
  toControllerRunResult,
  withRuntimeData,
  type ControllerAdvance,
  type ControllerRuntimeOutput,
  type MaterializedLoopItems,
} from './workflow-controller.state';

@Injectable()
export class WorkflowControllerService {
  private readonly tasks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
    private readonly collaboration: CollaborationBusService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agents: AgentsService,
    @Optional()
    @Inject(forwardRef(() => WorkflowManagedFlowNotifierService))
    private readonly flowNotifier?: WorkflowManagedFlowNotifierService,
    @Optional()
    private readonly supervisor?: RunSupervisorService,
  ) {}

  async run(sessionId: string, nodeId: string, body: unknown): Promise<WorkflowControllerRunResult> {
    const req = this.parseRunRequest(body);
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

    const snapshot = await this.graph.loadSnapshot(sessionId);
    const loopNode = snapshot.nodes.find((node) => node.id === nodeId) ?? null;
    if (!loopNode || loopNode.type !== 'loop') {
      throw new NotFoundException('WORKFLOW_CONTROLLER_NOT_FOUND');
    }
    const loop = readWorkflowLoopContent(loopNode.content);
    if (!loop) {
      throw new BadRequestException('WORKFLOW_CONTROLLER_INVALID_LOOP');
    }
    if (loop.mode !== 'for_each') {
      throw new BadRequestException('WORKFLOW_CONTROLLER_MODE_UNSUPPORTED');
    }
    const bodyNode = snapshot.nodes.find((node) => node.id === loop.bodyNodeId) ?? null;
    if (!bodyNode || bodyNode.type !== 'sub_graph') {
      throw new BadRequestException('WORKFLOW_CONTROLLER_BODY_INVALID');
    }
    const subgraph = readWorkflowSubgraphContent(bodyNode.content);
    if (!subgraph) {
      throw new BadRequestException('WORKFLOW_CONTROLLER_SUBGRAPH_INVALID');
    }

    const existing = await this.prisma.workflowControllerState.findFirst({
      where: { sessionId, controllerNodeId: nodeId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const active = existing ? serializeControllerState(existing) : null;
    if (active) {
      if (isControllerRunning(active.status)) {
        if (req.forceRestart) {
          throw new BadRequestException('WORKFLOW_CONTROLLER_ALREADY_RUNNING');
        }
        this.ensureTask(active.id);
        return toControllerRunResult(active, 'resume');
      }
      if (active.status === 'blocked' && !req.forceRestart) {
        const resumed = await this.writeControllerState({
          ...active,
          status: 'running',
          endedAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        this.ensureTask(resumed.id);
        return toControllerRunResult(resumed, 'resume');
      }
      if (!req.forceRestart) {
        return toControllerRunResult(active, 'noop', active.status);
      }
    }

    const now = new Date().toISOString();
    const cwd = this.resolveWorkingDirectory(session, req.workingDirectory);
    await fs.mkdir(cwd, { recursive: true });
    const materialized = await this.materializeItems(sessionId, snapshot, loop, cwd);
    const execution = await this.prisma.workflowExecution.create({
      data: {
        id: randomUUID(),
        sessionId,
        triggerNodeId: loopNode.id,
        stepNodeId: loop.bodyNodeId,
        agentType: 'orchestrator',
        role: 'controller',
        status: 'running',
        wakeReason: 'manual',
        runtime: { kind: 'local_process', cwd },
        seedNodeIds: [loopNode.id, loop.bodyNodeId],
        startedAt: new Date(now),
      },
    });
    const state = buildInitialControllerState({
      controllerId: randomUUID(),
      sessionId,
      controllerNodeId: loopNode.id,
      executionId: execution.id,
      loop,
      items: materialized.items,
      source: materialized.source,
      now,
    });
    const saved = await this.createControllerState(state);
    this.ensureTask(saved.id);
    return toControllerRunResult(saved, active ? 'restart' : 'run');
  }

  private parseRunRequest(body: unknown): WorkflowControllerRunRequest {
    const parsed = workflowControllerRunRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((issue: { path: Array<string | number>; message: string }) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
      );
    }
    return parsed.data;
  }

  private async createControllerState(state: WorkflowControllerState): Promise<WorkflowControllerState> {
    await this.prisma.workflowControllerState.create({
      data: {
        id: state.id,
        sessionId: state.sessionId,
        controllerNodeId: state.controllerNodeId,
        parentExecutionId: state.parentExecutionId ?? null,
        executionId: state.executionId ?? null,
        currentChildExecutionId: state.currentChildExecutionId ?? null,
        mode: state.mode,
        sourceKind: state.sourceKind,
        status: state.status,
        state: controllerDynamicState(state) as Prisma.InputJsonValue,
        startedAt: new Date(state.startedAt),
      },
    });
    const saved = await this.loadControllerState(state.id);
    await this.syncControllerNode(saved);
    this.emitControllerState(saved);
    return saved;
  }

  private async loadControllerState(id: string): Promise<WorkflowControllerState> {
    const row = await this.prisma.workflowControllerState.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('WORKFLOW_CONTROLLER_STATE_NOT_FOUND');
    }
    return serializeControllerState(row);
  }

  private async writeControllerState(state: WorkflowControllerState): Promise<WorkflowControllerState> {
    await this.prisma.workflowControllerState.update({
      where: { id: state.id },
      data: {
        parentExecutionId: state.parentExecutionId ?? null,
        executionId: state.executionId ?? null,
        currentChildExecutionId: state.currentChildExecutionId ?? null,
        mode: state.mode,
        sourceKind: state.sourceKind,
        status: state.status,
        state: controllerDynamicState(state) as Prisma.InputJsonValue,
        endedAt: state.endedAt ? new Date(state.endedAt) : null,
      },
    });
    if (state.executionId) {
      await this.prisma.workflowExecution.update({
        where: { id: state.executionId },
        data: {
          status: mapExecutionStatus(state.status),
          currentRunId: state.currentChildRunId ?? null,
          ...(state.currentChildRunId ? { latestRunId: state.currentChildRunId } : {}),
          endedAt: state.endedAt ? new Date(state.endedAt) : state.status === 'blocked' ? new Date() : null,
        },
      });
    }
    const saved = await this.loadControllerState(state.id);
    await this.syncControllerNode(saved);
    this.emitControllerState(saved);
    return saved;
  }

  private emitControllerState(state: WorkflowControllerState): void {
    this.collaboration.emitSession(state.sessionId, {
      type: 'workflow.controller_updated',
      eventId: 0,
      sessionId: state.sessionId,
      runId: state.currentChildRunId,
      actor: { type: 'system', id: 'workflow_controller' },
      timestamp: state.updatedAt,
      payload: state,
    });
    this.flowNotifier?.notifyControllerState(state);
  }

  private async syncControllerNode(state: WorkflowControllerState): Promise<void> {
    await this.graph.patchNode(
      state.sessionId,
      state.controllerNodeId,
      {
        metadata: await this.mergedNodeMetadata(
          state.sessionId,
          state.controllerNodeId,
          controllerMetadata(state),
        ),
      },
      { type: 'system', reason: 'workflow_controller' },
      `workflow-controller:${state.id}`,
    );
  }

  private async mergedNodeMetadata(
    sessionId: string,
    nodeId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const node = snapshot.nodes.find((entry) => entry.id === nodeId) ?? null;
    const existing =
      node?.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {};
    return {
      ...existing,
      ...patch,
    };
  }

  private ensureTask(controllerId: string): void {
    if (this.supervisor) {
      void this.queueControllerTask(controllerId);
      return;
    }
    if (this.tasks.has(controllerId)) {
      return;
    }
    const task = this.runTask(controllerId).finally(() => {
      this.tasks.delete(controllerId);
    });
    this.tasks.set(controllerId, task);
  }

  private async runTask(controllerId: string): Promise<void> {
    await this.executeQueuedController(controllerId);
  }

  async notifyAgentStatus(sessionId: string, run: AgentRun): Promise<void> {
    if (ACTIVE_RUN_STATUSES.has(run.status)) {
      return;
    }
    const rows = await this.prisma.workflowControllerState.findMany({
      where: { sessionId },
    });
    const running = rows
      .map((row) => serializeControllerState(row))
      .filter((state) => isControllerRunning(state.status));
    const matched = running.filter((state) =>
      state.currentChildRunId === run.id
      || (Boolean(run.executionId) && state.currentChildExecutionId === run.executionId),
    );
    const targets = matched.length > 0 ? matched : running.length === 1 ? running : [];
    for (const state of targets) {
      // Recovery and rerun paths can leave the controller holding only one side of the child ids.
      // If there is a single active controller in the session, wake it optimistically and let
      // advanceController decide whether the child is really ready.
      this.ensureTask(state.id);
    }
  }

  async executeQueuedController(controllerId: string, _workerId?: string): Promise<Record<string, unknown>> {
    try {
      while (true) {
        const state = await this.loadControllerState(controllerId);
        if (!isControllerRunning(state.status)) {
          return { controllerId, status: state.status };
        }
        const next = await this.advanceController(state);
        if (next === 'wait') {
          return { controllerId, status: 'waiting' };
        }
      }
    } catch (errorValue) {
      const row = await this.prisma.workflowControllerState.findUnique({ where: { id: controllerId } });
      if (!row) {
        return { controllerId, status: 'missing' };
      }
      const state = serializeControllerState(row);
      const detail = errorValue instanceof Error ? errorValue.message : String(errorValue);
      await this.writeControllerState({
        ...state,
        status: 'failed',
        lastDecisionDetail: detail,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      return { controllerId, status: 'failed', detail };
    }
  }

  private async queueControllerTask(controllerId: string): Promise<void> {
    const row = await this.prisma.workflowControllerState.findUnique({
      where: { id: controllerId },
      select: { id: true, sessionId: true },
    });
    if (!row) {
      return;
    }
    await this.supervisor?.queueController(row.sessionId, {
      controllerId: row.id,
    });
  }

  private async advanceController(state: WorkflowControllerState): Promise<ControllerAdvance> {
    const session = await this.prisma.session.findUnique({
      where: { id: state.sessionId },
      select: {
        id: true,
        workspaceParentDirectory: true,
        workspaceDirectoryName: true,
      },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const snapshot = await this.graph.loadSnapshot(state.sessionId);
    const loopNode = snapshot.nodes.find((node) => node.id === state.controllerNodeId) ?? null;
    if (!loopNode || loopNode.type !== 'loop') {
      throw new BadRequestException('WORKFLOW_CONTROLLER_NOT_FOUND');
    }
    const loop = readWorkflowLoopContent(loopNode.content);
    if (!loop || loop.mode !== 'for_each') {
      throw new BadRequestException('WORKFLOW_CONTROLLER_INVALID_LOOP');
    }
    const bodyNode = snapshot.nodes.find((node) => node.id === loop.bodyNodeId) ?? null;
    if (!bodyNode || bodyNode.type !== 'sub_graph') {
      throw new BadRequestException('WORKFLOW_CONTROLLER_BODY_INVALID');
    }
    const subgraph = readWorkflowSubgraphContent(bodyNode.content);
    if (!subgraph) {
      throw new BadRequestException('WORKFLOW_CONTROLLER_SUBGRAPH_INVALID');
    }
    const validatorNode = loop.validatorNodeId
      ? snapshot.nodes.find((node) => node.id === loop.validatorNodeId) ?? null
      : null;
    const refSnapshot = await this.resolveReferenceSnapshot(subgraph, state.sessionId);
    if (state.currentChildExecutionId) {
      const child = await this.prisma.workflowExecution.findUnique({
        where: { id: state.currentChildExecutionId },
      });
      if (!child) {
        const cleared = await this.writeControllerState({
          ...state,
          currentChildExecutionId: undefined,
          currentChildRunId: undefined,
          updatedAt: new Date().toISOString(),
        });
        return this.advanceController(cleared);
      }
      if (ACTIVE_RUN_STATUSES.has(child.status as AgentLifecycleStatus)) {
        return 'wait';
      }
      await this.handleChildCompletion(state, loop, subgraph, validatorNode, session, refSnapshot, bodyNode, child);
      return 'continue';
    }

    if ((state.currentIndex ?? 0) >= (state.totalItems ?? 0)) {
      await this.writeControllerState({
        ...state,
        status: 'completed',
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      return 'continue';
    }

    await this.startChildAttempt(state, loop, subgraph, validatorNode, session, snapshot, refSnapshot, bodyNode);
    return 'continue';
  }

  private async startChildAttempt(
    state: WorkflowControllerState,
    loop: NonNullable<ReturnType<typeof readWorkflowLoopContent>>,
    subgraph: NonNullable<ReturnType<typeof readWorkflowSubgraphContent>>,
    validatorNode: { id: string; type: string; content: Record<string, unknown> } | null,
    session: {
      id: string;
      workspaceParentDirectory: string | null;
      workspaceDirectoryName: string | null;
    },
    sessionSnapshot: Awaited<ReturnType<GraphService['loadSnapshot']>>,
    refSnapshot: Awaited<ReturnType<GraphService['loadSnapshot']>>,
    bodyNode: { id: string; position: { x: number; y: number } },
  ): Promise<void> {
    const itemIndex = state.currentIndex ?? 0;
    const item = state.items.find((entry) => entry.index === itemIndex);
    if (!item) {
      throw new BadRequestException('WORKFLOW_CONTROLLER_ITEM_MISSING');
    }
    const current = runtimeData(state);
    const itemValue = this.readItemValue(state, item.key, itemIndex);
    const attempt = item.attempts + 1;
    const selection = pickWorkflowChildSelection(refSnapshot, subgraph);
    const validator = summarizeValidatorRequirements(validatorNode as never);
    const itemRuntime = current.items?.[item.key] ?? {};
    const plannedRunId = randomUUID();
    let promptNodeId = pickWorkflowControllerPromptNodeId(
      sessionSnapshot,
      state.id,
      current.promptNodeId,
    );
    let outputNodeIds: string[] = [];
    const outputs: Array<{
      nodeId: string;
      relativePath: string;
      pathMode: 'static' | 'per_run';
      resolvedRelativePath: string;
    }> = [];
    if (subgraph.expectedOutputs?.length) {
      for (const [index, relativePath] of subgraph.expectedOutputs.entries()) {
        const existingId = pickWorkflowControllerOutputNodeId(sessionSnapshot, {
          controllerId: state.id,
          bodyNodeId: bodyNode.id,
          relativePath,
          currentId: current.outputNodeIds?.[index],
          itemKey: item.key,
        });
        const output = readWorkflowOutputSeed({
          sessionSnapshot,
          refSnapshot,
          nodeId: existingId,
          relativePath,
        });
        const pathMode = output?.pathMode === 'per_run' ? 'per_run' : 'static';
        const resolvedRelativePath = resolveWorkflowArtifactRelativePath(
          {
            relativePath,
            ...(output?.pathMode ? { pathMode: output.pathMode } : {}),
            ...(output?.resolvedRelativePath ? { resolvedRelativePath: output.resolvedRelativePath } : {}),
          },
          plannedRunId,
        );
        if (existingId) {
          outputNodeIds.push(existingId);
          outputs.push({
            nodeId: existingId,
            relativePath,
            pathMode,
            resolvedRelativePath,
          });
          continue;
        }
        const env = await this.graph.addNode(state.sessionId, {
          type: 'workspace_file',
          content: {
            title: output?.title ?? relativePath,
            relativePath,
            ...(output?.pathMode ? { pathMode: output.pathMode } : {}),
            ...(pathMode === 'per_run' ? { resolvedRelativePath } : {}),
            role: 'output',
            origin: output?.origin ?? 'derived',
            kind: output?.kind ?? 'text',
            transferMode: output?.transferMode ?? 'reference',
            ...(output?.summary ? { summary: output.summary } : {}),
            status: 'declared',
          },
          position: { x: bodyNode.position.x + 640, y: bodyNode.position.y + outputNodeIds.length * 72 },
          creator: { type: 'system', reason: 'workflow_controller' },
          metadata: {
            runtimeOwned: 'workflow_controller',
            controllerId: state.id,
            itemKey: item.key,
          },
        });
        if (env.payload.type === 'node_added') {
          outputNodeIds.push(env.payload.node.id);
          outputs.push({
            nodeId: env.payload.node.id,
            relativePath,
            pathMode,
            resolvedRelativePath,
          });
        }
      }
    }

    const prompt = [
      renderReferencedWorkflowPrompt(refSnapshot, subgraph, {
        item: itemValue,
        index: itemIndex,
        attempt,
        completedSummaries: state.completedSummaries,
        retryFeedback: current.retryFeedback,
        inputs: collectWorkflowPromptInputs(sessionSnapshot),
        outputs,
      }),
      validator.length > 0 ? `Validator requirements\n${validator.map((line) => `- ${line}`).join('\n')}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
    if (promptNodeId) {
      await this.graph.patchNode(
        state.sessionId,
        promptNodeId,
        {
          content: { text: prompt, format: 'markdown' },
          metadata: {
            runtimeOwned: 'workflow_controller',
            controllerId: state.id,
            itemKey: item.key,
            attempt,
          },
        },
        { type: 'system', reason: 'workflow_controller' },
        `workflow-controller-prompt:${state.id}:${item.key}`,
      );
    } else {
      const env = await this.graph.addNode(state.sessionId, {
        type: 'note',
        content: { text: prompt, format: 'markdown' },
        position: { x: bodyNode.position.x + 360, y: bodyNode.position.y },
        creator: { type: 'system', reason: 'workflow_controller' },
        metadata: {
          runtimeOwned: 'workflow_controller',
          controllerId: state.id,
          itemKey: item.key,
          attempt,
        },
      });
      promptNodeId = env.payload.type === 'node_added' ? env.payload.node.id : undefined;
    }
    if (!promptNodeId) {
      throw new Error('WORKFLOW_CONTROLLER_PROMPT_NODE_CREATE_FAILED');
    }

    let runId: string | undefined;
    let executionId: string | undefined;
    if (
      itemRuntime.lastRunId &&
      attempt > 1 &&
      loop.sessionPolicy.withinItem === 'reuse_execution' &&
      state.status === 'retrying' &&
      state.lastDecision !== 'retry_new_execution'
    ) {
      const rerun = await this.agents.rerun(
        state.sessionId,
        itemRuntime.lastRunId,
        {
          newExecution: false,
        },
        {
          runId: plannedRunId,
        },
      );
      runId = rerun.data.agentRunId;
      const run = await this.prisma.agentRun.findUnique({
        where: { id: rerun.data.agentRunId },
        select: { executionId: true },
      });
      executionId = run?.executionId ?? undefined;
    } else {
      const cwd = this.resolveWorkingDirectory(session);
      const spawned = await this.agents.spawn(state.sessionId, {
        type: selection.type,
        role: selection.role,
        runtime: { kind: 'local_process', cwd },
        workingDirectory: cwd,
        triggerNodeId: bodyNode.id,
        wakeReason: 'manual',
        seedNodeIds: [promptNodeId, ...outputNodeIds],
        ...(selection.model ? { model: selection.model } : {}),
        parentExecutionId: state.executionId,
        newExecution: true,
      }, {
        runId: plannedRunId,
      });
      runId = spawned.data.agentRunId;
      const run = await this.prisma.agentRun.findUnique({
        where: { id: spawned.data.agentRunId },
        select: { executionId: true },
      });
      executionId = run?.executionId ?? undefined;
    }
    if (!runId || !executionId) {
      throw new Error('WORKFLOW_CONTROLLER_CHILD_RUN_MISSING');
    }
    if (runId !== plannedRunId) {
      throw new Error('WORKFLOW_CONTROLLER_CHILD_RUN_ID_MISMATCH');
    }
    const resolvedOutputs = outputs;

    const saved = await this.writeControllerState(
      withRuntimeData(
        {
          ...state,
          status: 'running',
          currentChildExecutionId: executionId,
          currentChildRunId: runId,
          attemptsTotal: state.attemptsTotal + 1,
          updatedAt: new Date().toISOString(),
          lastDecision: undefined,
          lastDecisionDetail: undefined,
          items: state.items.map((entry) =>
            entry.index === itemIndex
              ? {
                  ...entry,
                  attempts: attempt,
                  status: 'running',
                }
              : entry,
          ),
        },
        {
          retryFeedback: undefined,
          promptNodeId,
          outputNodeIds,
          items: {
            ...(current.items ?? {}),
            [item.key]: {
              ...itemRuntime,
              lastRunId: runId,
              lastExecutionId: executionId,
              outputs: resolvedOutputs,
            },
          },
        },
      ),
    );
    const loopPatch = await this.graph.patchNode(
      saved.sessionId,
      saved.controllerNodeId,
      {
        metadata: await this.mergedNodeMetadata(
          saved.sessionId,
          saved.controllerNodeId,
          controllerMetadata(saved),
        ),
      },
      { type: 'system', reason: 'workflow_controller' },
      `workflow-controller-start:${saved.id}:${item.key}:${attempt}`,
    );
    await this.activity.log({
      sessionId: saved.sessionId,
      eventId: loopPatch.eventId,
      actorType: 'system',
      actorId: 'workflow_controller',
      runId: runId,
      summary: `Workflow loop started ${item.label}`,
      relatedNodeIds: [saved.controllerNodeId, bodyNode.id],
    });
  }

  private async handleChildCompletion(
    state: WorkflowControllerState,
    loop: NonNullable<ReturnType<typeof readWorkflowLoopContent>>,
    subgraph: NonNullable<ReturnType<typeof readWorkflowSubgraphContent>>,
    validatorNode: { id: string; type: string; content: Record<string, unknown> } | null,
    session: {
      id: string;
      workspaceParentDirectory: string | null;
      workspaceDirectoryName: string | null;
    },
    refSnapshot: Awaited<ReturnType<GraphService['loadSnapshot']>>,
    bodyNode: { id: string },
    child: {
      id: string;
      status: string;
      latestRunId: string | null;
      currentRunId: string | null;
    },
  ): Promise<void> {
    const itemIndex = state.currentIndex ?? 0;
    const item = state.items.find((entry) => entry.index === itemIndex);
    if (!item) {
      throw new BadRequestException('WORKFLOW_CONTROLLER_ITEM_MISSING');
    }
    const runId = state.currentChildRunId ?? child.currentRunId ?? child.latestRunId ?? undefined;
    const run = runId
      ? await this.prisma.agentRun.findUnique({
          where: { id: runId },
          select: { id: true, outputText: true, status: true, startedAt: true, endedAt: true },
        })
      : null;
    const evaluation = await this.evaluateChildRun({
      session,
      refSnapshot,
      loop,
      subgraph,
      validatorNode,
      childStatus: child.status,
      run,
      outputDefs: runtimeData(state).items?.[item.key]?.outputs ?? [],
    });
    const summary = `${item.label}: ${evaluation.detail}`;
    if (evaluation.outcome === 'pass' || evaluation.outcome === 'complete') {
      const nextIndex = itemIndex + 1;
      const next = await this.writeControllerState(
        withRuntimeData(
          {
            ...state,
            status: nextIndex >= (state.totalItems ?? 0) ? 'completed' : 'running',
            currentChildExecutionId: undefined,
            currentChildRunId: undefined,
            currentIndex: nextIndex >= (state.totalItems ?? 0) ? undefined : nextIndex,
            lastDecision: evaluation.outcome,
            lastDecisionDetail: evaluation.detail,
            completedSummaries: [...state.completedSummaries, summary],
            updatedAt: new Date().toISOString(),
            ...(nextIndex >= (state.totalItems ?? 0) ? { endedAt: new Date().toISOString() } : {}),
            items: state.items.map((entry) =>
              entry.index === itemIndex
                ? {
                    ...entry,
                    status: 'completed',
                    summary: evaluation.detail,
                  }
                : entry,
            ),
          },
          { retryFeedback: undefined },
        ),
      );
      const patch = await this.graph.patchNode(
        next.sessionId,
        next.controllerNodeId,
        {
          metadata: await this.mergedNodeMetadata(
            next.sessionId,
            next.controllerNodeId,
            controllerMetadata(next),
          ),
        },
        { type: 'system', reason: 'workflow_controller' },
        `workflow-controller-pass:${next.id}:${item.key}`,
      );
      await this.activity.log({
        sessionId: next.sessionId,
        eventId: patch.eventId,
        actorType: 'system',
        actorId: 'workflow_controller',
        runId: run?.id,
        summary: `Workflow loop completed ${item.label}`,
        relatedNodeIds: [next.controllerNodeId, bodyNode.id],
      });
      return;
    }

    if (
      (evaluation.outcome === 'retry_same_item' || evaluation.outcome === 'retry_new_execution') &&
      item.attempts < (loop.maxAttemptsPerItem ?? 3)
    ) {
      await this.writeControllerState(
        withRuntimeData(
          {
            ...state,
            status: 'retrying',
            currentChildExecutionId: undefined,
            currentChildRunId: undefined,
            lastDecision: evaluation.outcome,
            lastDecisionDetail: evaluation.detail,
            updatedAt: new Date().toISOString(),
            items: state.items.map((entry) =>
              entry.index === itemIndex
                ? {
                    ...entry,
                    status: 'retrying',
                    summary: evaluation.detail,
                  }
                : entry,
            ),
          },
          { retryFeedback: evaluation.detail },
        ),
      );
      return;
    }

    if (loop.blockedPolicy === 'skip_item') {
      const nextIndex = itemIndex + 1;
      await this.writeControllerState(
        withRuntimeData(
          {
            ...state,
            status: nextIndex >= (state.totalItems ?? 0) ? 'completed' : 'running',
            currentChildExecutionId: undefined,
            currentChildRunId: undefined,
            currentIndex: nextIndex >= (state.totalItems ?? 0) ? undefined : nextIndex,
            lastDecision: evaluation.outcome,
            lastDecisionDetail: evaluation.detail,
            completedSummaries: [...state.completedSummaries, `${item.label}: skipped`],
            updatedAt: new Date().toISOString(),
            ...(nextIndex >= (state.totalItems ?? 0) ? { endedAt: new Date().toISOString() } : {}),
            items: state.items.map((entry) =>
              entry.index === itemIndex
                ? {
                    ...entry,
                    status: 'skipped',
                    summary: evaluation.detail,
                  }
                : entry,
            ),
          },
          { retryFeedback: undefined },
        ),
      );
      return;
    }

    await this.writeControllerState(
      withRuntimeData(
        {
          ...state,
          status: loop.blockedPolicy === 'stop_controller' ? 'failed' : 'blocked',
          currentChildExecutionId: undefined,
          currentChildRunId: undefined,
          lastDecision: evaluation.outcome,
          lastDecisionDetail: evaluation.detail,
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          items: state.items.map((entry) =>
            entry.index === itemIndex
              ? {
                  ...entry,
                  status: loop.blockedPolicy === 'stop_controller' ? 'failed' : 'blocked',
                  summary: evaluation.detail,
                }
              : entry,
          ),
        },
        { retryFeedback: undefined },
      ),
    );
  }

  private async evaluateChildRun(input: {
    session: {
      id: string;
      workspaceParentDirectory: string | null;
      workspaceDirectoryName: string | null;
    };
    refSnapshot: Awaited<ReturnType<GraphService['loadSnapshot']>>;
    loop: NonNullable<ReturnType<typeof readWorkflowLoopContent>>;
    subgraph: NonNullable<ReturnType<typeof readWorkflowSubgraphContent>>;
    validatorNode: { id: string; type: string; content: Record<string, unknown> } | null;
    childStatus: string;
    run: { id: string; outputText: string | null; status: string; startedAt: Date; endedAt: Date | null } | null;
    outputDefs?: ControllerRuntimeOutput[];
  }): Promise<{
    outcome: 'pass' | 'complete' | 'retry_same_item' | 'retry_new_execution' | 'block' | 'request_human';
    detail: string;
  }> {
    const validator = input.validatorNode ? readWorkflowDecisionValidatorContent(input.validatorNode.content) : null;
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
    const outputs = input.subgraph.expectedOutputs ?? [];
    for (const relativePath of outputs) {
      const resolvedPath = resolveWorkflowControllerPath(
        input.outputDefs,
        input.refSnapshot,
        relativePath,
        input.run?.id,
      );
      const absolutePath = path.resolve(cwd, resolvedPath);
      const stat = await statSafe(absolutePath);
      checks.push({
        ok: Boolean(stat),
        detail: `expected output ${formatWorkflowPathDetail(relativePath, resolvedPath)}`,
      });
      if (stat) {
        checks.push({
          ok: isWorkflowOutputFresh(stat.mtimeMs, input.run?.startedAt),
          detail: `expected output fresh ${formatWorkflowPathDetail(relativePath, resolvedPath)}`,
        });
      }
    }
    if (validator) {
      for (const evidence of validator.evidenceFrom) {
        const resolvedPath = resolveWorkflowControllerPath(
          input.outputDefs,
          input.refSnapshot,
          evidence,
          input.run?.id,
        );
        const absolutePath = path.resolve(cwd, resolvedPath);
        checks.push({
          ok: await exists(absolutePath),
          detail: `evidence ${formatWorkflowPathDetail(evidence, resolvedPath)}`,
        });
      }
      for (const check of validator.checks) {
        if (check.kind === 'connector_status_is') {
          checks.push({
            ok: false,
            detail: `connector status is ${check.status}`,
          });
          continue;
        }
        if (check.kind === 'connector_exit_code_in') {
          checks.push({
            ok: false,
            detail: `connector exit code in [${check.codes.join(', ')}]`,
          });
          continue;
        }
        if (check.kind === 'connector_http_status_in') {
          checks.push({
            ok: false,
            detail: `connector http status in [${check.statuses.join(', ')}]`,
          });
          continue;
        }
        const resolvedPath = resolveWorkflowControllerPath(
          input.outputDefs,
          input.refSnapshot,
          check.path,
          input.run?.id,
        );
        const absolutePath = path.resolve(cwd, resolvedPath);
        if (check.kind === 'path_exists') {
          checks.push({
            ok: await exists(absolutePath),
            detail: `path exists ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'path_not_exists') {
          checks.push({
            ok: !(await exists(absolutePath)),
            detail: `path not exists ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'path_nonempty') {
          const stat = await statSafe(absolutePath);
          checks.push({
            ok: Boolean(stat && stat.size > 0),
            detail: `path nonempty ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'file_contains') {
          const text = await readTextSafe(absolutePath);
          checks.push({
            ok: text.includes(check.text),
            detail: `file contains ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'file_not_contains') {
          const text = await readTextSafe(absolutePath);
          checks.push({
            ok: !text.includes(check.text),
            detail: `file not contains ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'file_last_line_equals') {
          const text = await readTextSafe(absolutePath);
          checks.push({
            ok: hasWorkflowFileLastLine(text, check.text),
            detail: `file last line equals ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'json_array_nonempty') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          const ok = Array.isArray(parsed) && parsed.length > 0;
          checks.push({
            ok,
            detail: `json array nonempty ${formatWorkflowPathDetail(check.path, resolvedPath)}`,
          });
          continue;
        }
        if (check.kind === 'json_path_exists') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          checks.push({
            ok: hasWorkflowJsonPath(parsed, check.jsonPath),
            detail: `json path exists ${formatWorkflowPathDetail(check.path, resolvedPath)} @ ${check.jsonPath}`,
          });
          continue;
        }
        if (check.kind === 'json_path_nonempty') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          checks.push({
            ok: hasWorkflowJsonPathNonempty(parsed, check.jsonPath),
            detail: `json path nonempty ${formatWorkflowPathDetail(check.path, resolvedPath)} @ ${check.jsonPath}`,
          });
          continue;
        }
        if (check.kind === 'json_path_array_nonempty') {
          const text = await readTextSafe(absolutePath);
          const parsed = parseWorkflowJsonText(text);
          checks.push({
            ok: hasWorkflowJsonPathArrayNonempty(parsed, check.jsonPath),
            detail: `json path array nonempty ${formatWorkflowPathDetail(check.path, resolvedPath)} @ ${check.jsonPath}`,
          });
        }
      }
    }

    const failed = checks.filter((entry) => !entry.ok);
    if (failed.length === 0) {
      return {
        outcome: validator?.passAction === 'complete' ? 'complete' : 'pass',
        detail: input.run?.outputText?.trim().slice(0, 160) || 'validation passed',
      };
    }
    const detail = failed.map((entry) => entry.detail).join(', ');
    if (validator?.failAction === 'retry_new_execution') {
      return { outcome: 'retry_new_execution', detail };
    }
    if (validator?.failAction === 'request_human') {
      return { outcome: 'request_human', detail };
    }
    if (input.loop.advancePolicy === 'always_advance') {
      return { outcome: 'complete', detail };
    }
    return { outcome: 'retry_same_item', detail };
  }

  private readItemValue(
    state: WorkflowControllerState,
    itemKey: string,
    index: number,
  ): WorkflowControllerItemValue {
    const raw =
      ((state.data.itemValues as Record<string, { value?: unknown }> | undefined)?.[itemKey]?.value ?? undefined);
    return normalizeControllerItem(raw, index);
  }

  private async materializeItems(
    _sessionId: string,
    snapshot: Awaited<ReturnType<GraphService['loadSnapshot']>>,
    loop: NonNullable<ReturnType<typeof readWorkflowLoopContent>>,
    cwd: string,
  ): Promise<MaterializedLoopItems> {
    if (loop.source.kind === 'inline_list') {
      return {
        items: loop.source.items.map((item, index) => normalizeControllerItem(item, index)),
      };
    }
    if (loop.source.kind === 'input_parts') {
      const source = loop.source;
      const requestedBoundNodeId = source.boundNodeId?.trim();
      const boundNode =
        (source.boundNodeId ? snapshot.nodes.find((node) => node.id === source.boundNodeId) ?? null : null) ??
        findLatestBoundInput(snapshot, source.templateNodeId);
      const content = boundNode ? readInputBound(boundNode.content) : null;
      if (!boundNode || !content) {
        throw new BadRequestException('WORKFLOW_CONTROLLER_INPUT_PARTS_MISSING');
      }
      const items = content.parts.map((part, index) => {
        if (part.type === 'text') {
          return normalizeControllerItem(part.text, index);
        }
        if (!part.file) {
          throw new BadRequestException('WORKFLOW_CONTROLLER_INPUT_PART_INVALID');
        }
        return normalizeControllerItem(
          {
            id: part.id,
            type: part.type,
            name: part.file.name,
            mimeType: part.file.mimeType,
            relativePath: part.relativePath,
            extractedText: part.extractedText,
            claimRef: part.claimRef,
          },
          index,
        );
      });
      const itemHintCount = inferStructuredItemHint(content.parts);
      return {
        items,
        source: {
          templateNodeId: source.templateNodeId,
          ...(requestedBoundNodeId ? { requestedBoundNodeId } : {}),
          resolvedBoundNodeId: boundNode.id,
          partCount: content.parts.length,
          itemCount: items.length,
          ...(itemHintCount > items.length ? { itemHintCount } : {}),
          ...(itemHintCount > items.length
            ? {
                warning: `Resolved bound input ${boundNode.id} materialized ${items.length} item, but the single text part looks like ${itemHintCount} list items.`,
              }
            : {}),
        },
      };
    }
    if (loop.source.kind === 'json_file') {
      const source = loop.source;
      const relativePath =
        source.relativePath ??
        (() => {
          const fileNode = source.fileNodeId
            ? snapshot.nodes.find((node) => node.id === source.fileNodeId) ?? null
            : null;
          const artifact = fileNode ? readWorkflowArtifactContent(fileNode.content) : null;
          if (!artifact) {
            return undefined;
          }
          return resolveWorkflowArtifactRelativePath(artifact);
        })();
      if (!relativePath) {
        throw new BadRequestException('WORKFLOW_CONTROLLER_JSON_SOURCE_MISSING');
      }
      const text = await fs.readFile(path.resolve(cwd, relativePath), 'utf8');
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new BadRequestException('WORKFLOW_CONTROLLER_JSON_SOURCE_INVALID');
      }
      return {
        items: parsed.map((item, index) => normalizeControllerItem(item, index)),
      };
    }
    throw new BadRequestException(`WORKFLOW_CONTROLLER_SOURCE_UNSUPPORTED:${loop.source.kind}`);
  }

  private async resolveReferenceSnapshot(
    subgraph: NonNullable<ReturnType<typeof readWorkflowSubgraphContent>>,
    currentSessionId?: string,
  ): Promise<Awaited<ReturnType<GraphService['loadSnapshot']>>> {
    const sessionId =
      subgraph.workflowRef.kind === 'session'
      && (subgraph.workflowRef.sessionId === '{{sessionId}}' || subgraph.workflowRef.sessionId === '$self')
        ? currentSessionId ?? subgraph.workflowRef.sessionId
        : subgraph.workflowRef.sessionId;
    return this.graph.loadSnapshot(sessionId);
  }

  private resolveWorkingDirectory(
    session: {
      id: string;
      workspaceParentDirectory: string | null;
      workspaceDirectoryName: string | null;
    },
    workingDirectory?: string,
  ): string {
    const stored = readSessionWorkspace(process.cwd(), session);
    return path.resolve(process.cwd(), workingDirectory ?? stored?.workingDirectory ?? process.cwd());
  }

}

function readInputBound(
  value: unknown,
): { parts: Array<{ type: string; id: string; text?: string; file?: { name: string; mimeType: string }; relativePath?: string; extractedText?: string; claimRef?: string }> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const mode = (value as { mode?: unknown }).mode;
  const parts = (value as { parts?: unknown }).parts;
  if (mode !== 'bound' || !Array.isArray(parts)) {
    return null;
  }
  return value as {
    parts: Array<{ type: string; id: string; text?: string; file?: { name: string; mimeType: string }; relativePath?: string; extractedText?: string; claimRef?: string }>;
  };
}

function findLatestBoundInput(
  snapshot: Awaited<ReturnType<GraphService['loadSnapshot']>>,
  templateNodeId: string,
) {
  return snapshot.nodes
    .filter((node) => node.type === 'input')
    .map((node) => ({ node, content: readInputBound(node.content) }))
    .filter(
      (entry): entry is { node: (typeof snapshot.nodes)[number]; content: NonNullable<ReturnType<typeof readInputBound>> } =>
        Boolean(entry.content) &&
        ((entry.node.content as { templateNodeId?: unknown }).templateNodeId as string | undefined) ===
          templateNodeId,
    )
    .sort((a, b) => b.node.updatedAt.localeCompare(a.node.updatedAt) || b.node.createdAt.localeCompare(a.node.createdAt))[0]
    ?.node;
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

function readWorkflowOutputDefinition(
  snapshot: { nodes: GraphNode[] },
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
    .sort((a, b) => workflowOutputDefinitionScore(b) - workflowOutputDefinitionScore(a))[0]
    ?? null;
}

function readWorkflowOutputSeed(input: {
  sessionSnapshot: { nodes: GraphNode[] };
  refSnapshot: { nodes: GraphNode[] };
  nodeId?: string;
  relativePath: string;
}): NonNullable<ReturnType<typeof readWorkflowArtifactContent>> | null {
  const sessionArtifact =
    input.nodeId
      ? input.sessionSnapshot.nodes
          .filter((node) => node.id === input.nodeId && node.type === 'workspace_file')
          .map((node) => readWorkflowArtifactContent(node.content))
          .find((artifact): artifact is NonNullable<ReturnType<typeof readWorkflowArtifactContent>> => Boolean(artifact))
      : null;
  return (
    sessionArtifact
    ?? readWorkflowOutputDefinition(input.refSnapshot, input.relativePath)
    ?? readWorkflowOutputDefinition(input.sessionSnapshot, input.relativePath)
  );
}

function workflowOutputDefinitionScore(
  artifact: NonNullable<ReturnType<typeof readWorkflowArtifactContent>>,
): number {
  return (artifact.pathMode === 'per_run' ? 2 : 0) + (artifact.origin === 'agent_output' ? 1 : 0);
}

function resolveWorkflowControllerPath(
  outputDefs: ControllerRuntimeOutput[] | undefined,
  snapshot: { nodes: GraphNode[] },
  relativePath: string,
  runId?: string,
): string {
  const runtimeOutput = outputDefs?.find((output) => output.relativePath === relativePath);
  if (runtimeOutput?.resolvedRelativePath) {
    return runtimeOutput.resolvedRelativePath;
  }
  const artifact = readWorkflowOutputDefinition(snapshot, relativePath);
  if (!artifact) {
    return relativePath;
  }
  return resolveWorkflowArtifactRelativePath(
    {
      relativePath,
      ...(artifact?.pathMode ? { pathMode: artifact.pathMode } : {}),
      ...(artifact?.resolvedRelativePath ? { resolvedRelativePath: artifact.resolvedRelativePath } : {}),
    },
    runId,
  );
}

function formatWorkflowPathDetail(relativePath: string, resolvedPath: string): string {
  return relativePath === resolvedPath ? relativePath : `${relativePath} -> ${resolvedPath}`;
}

function inferStructuredItemHint(
  parts: Array<{
    type: string;
    text?: string;
  }>,
): number {
  if (parts.length !== 1 || parts[0]?.type !== 'text' || !parts[0].text?.trim()) {
    return parts.length;
  }
  const text = parts[0].text;
  const bulletCount = text.split('\n').filter((line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)).length;
  if (bulletCount >= 2) {
    return bulletCount;
  }
  const headingCount = text
    .split('\n')
    .filter((line) => /^\s*(?:chunk|morceau|requirement|task)\s+\d+\b[:.)-]?\s*/i.test(line)).length;
  if (headingCount >= 2) {
    return headingCount;
  }
  return parts.length;
}
