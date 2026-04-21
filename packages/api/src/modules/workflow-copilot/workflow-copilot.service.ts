import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { getEnv } from '@cepage/config';
import { z } from 'zod';
import {
  WORKFLOW_COPILOT_STOPPED,
  collectManagedFlowReferencedNodeIds,
  readGraphNodeLockedSelection,
  readWorkflowArtifactContent,
  workflowArchitectureSpecSchema,
  readWorkflowLoopContent,
  readWorkflowManagedFlowContent,
  readWorkflowSubgraphContent,
  resolveAgentToolset,
  workflowFromSnapshot,
  workflowCopilotAttachmentDisplayName,
  workflowCopilotAttachmentSchema,
  workflowCopilotEnsureThreadSchema,
  workflowCopilotSendMessageSchema,
  workflowCopilotThreadPatchSchema,
  type AgentModelRef,
  type AgentKernelRecallEntry,
  type AgentType,
  type GraphNode,
  type WorkflowSkill,
  type WorkflowCopilotApplyResult,
  type WorkflowCopilotCheckpoint,
  type WorkflowCopilotEnsureThread,
  type WorkflowCopilotExecution,
  type WorkflowCopilotExecutionResult,
  type WorkflowCopilotLiveMessagePayload,
  type WorkflowCopilotRestoreResult,
  type WorkflowCopilotScope,
  type WorkflowCopilotSendResult,
  type WorkflowCopilotThreadBundle,
  type AgentPromptPart,
  type WorkflowCopilotAttachment,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import { ActivityService } from '../activity/activity.service';
import { AgentRecallService } from '../agents/agent-recall.service';
import { AgentsService } from '../agents/agents.service';
import { WorkflowControllerService } from '../agents/workflow-controller.service';
import { WorkflowManagedFlowService } from '../agents/workflow-managed-flow.service';
import { CollaborationBusService } from '../collaboration/collaboration-bus.service';
import { DaemonDispatchService } from '../execution/daemon/daemon-dispatch.service';
import { FileNodeService } from '../graph/file-node.service';
import { GraphService } from '../graph/graph.service';
import { WorkflowSkillsService } from '../workflow-skills/workflow-skills.service';
import { collectWorkflowStructuralEdges, edgeKey } from './workflow-copilot-graph';
import {
  buildWorkflowArchitectureOps,
  canAutoBuildArchitecture,
} from './workflow-copilot-architect';
import { applyWorkflowCopilotMessage } from './workflow-copilot-apply';
import {
  emitCopilotMessage,
  emitMessageRow,
  emitThreadRow,
} from './workflow-copilot-events';
import {
  defaultNodeContent,
  normalizeNodeContent,
  sameJson,
  workflowFromSafeJson,
} from './workflow-copilot-normalize';
import { buildPrompt, isDefined, isTempLikePath, scopeNodeIds } from './workflow-copilot-prompt';
import { sendWorkflowCopilotMessage } from './workflow-copilot-send';
import {
  decodeBase64DataUrlBuffer,
  defaultScope,
  executionResultRecord,
  readCopilotExecutionError,
  readMode,
  readModelRef,
  readThreadMetadata,
  rowToMessage,
  rowToThread,
  shortId,
  threadOwnerKey,
} from './workflow-copilot-rows';
import { finalizeWorkflowCopilotRun, importAgentCore } from './workflow-copilot-runtime';
import {
  assertSession,
  readBundle,
  readCheckpointRow,
  readLockedNodeSelection,
  readMessageRow,
  readSession,
  readThreadRow,
} from './workflow-copilot-readers';
import {
  DEFAULT_AGENT_TYPE,
  DEFAULT_AUTO_APPLY,
  DEFAULT_AUTO_RUN,
  DEFAULT_MODE,
  HUMAN_ACTOR,
  type CheckpointRow,
  type MessageRow,
  type RunThreadProgress,
  type RunTurnResult,
  type SessionRow,
  type ThreadRow,
} from './workflow-copilot.types';

export { buildPrompt } from './workflow-copilot-prompt';
export { finalizeWorkflowCopilotRun } from './workflow-copilot-runtime';

function mergeThreadMetadata(
  current: WorkflowCopilotEnsureThread['metadata'] | undefined,
  patch: WorkflowCopilotEnsureThread['metadata'] | undefined,
): WorkflowCopilotEnsureThread['metadata'] | undefined {
  if (!current && !patch) return undefined;
  const next = {
    ...(current ?? {}),
    ...(patch ?? {}),
  };
  if (!next.role) {
    delete next.role;
  }
  if (!next.toolset && next.role) {
    next.toolset = resolveAgentToolset(next.role);
  }
  return next;
}

function uniqText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const noopRecall = {
  forWorkflowCopilot: async (): Promise<AgentKernelRecallEntry[]> => [],
} satisfies Pick<AgentRecallService, 'forWorkflowCopilot'>;

const noopSkills = {
  listSkills: async () => [],
  getSkill: async () => {
    throw new NotFoundException('WORKFLOW_SKILL_NOT_FOUND');
  },
  getSkillPrompt: async () => null,
  routeSkill: async () => null,
  routeSkillCandidates: async () => [],
} satisfies Pick<
  WorkflowSkillsService,
  'listSkills' | 'getSkill' | 'getSkillPrompt' | 'routeSkill' | 'routeSkillCandidates'
>;

@Injectable()
export class WorkflowCopilotService {
  private readonly abortByThread = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
    private readonly agents: AgentsService,
    private readonly flows: WorkflowManagedFlowService,
    private readonly controllers: WorkflowControllerService,
    private readonly fileNodes: FileNodeService,
    private readonly collaboration: CollaborationBusService = {
      emitSession: () => {},
    } as unknown as CollaborationBusService,
    @Optional()
    private readonly recallService?: AgentRecallService,
    @Optional()
    private readonly skillsService?: WorkflowSkillsService,
    // dispatch is injected by Nest via the @Global ExecutionModule. The default
    // mock here is only consumed by unit tests that build the service directly
    // and never reach runThread() — runtime would throw if it actually runs.
    private readonly dispatch: DaemonDispatchService = {
      enqueueCopilotRun: () => {
        throw new Error('DaemonDispatchService not provided');
      },
      cancelCopilotRun: async () => {},
    } as unknown as DaemonDispatchService,
  ) {}

  private async materializeCopilotEmbeddedFiles(
    sessionId: string,
    nodeId: string,
    files: WorkflowCopilotAttachment[],
    nodesById: Map<string, GraphNode>,
    eventId: number,
  ): Promise<number> {
    if (files.length === 0) return eventId;
    const uploads = files.map((a) => {
      const buffer = decodeBase64DataUrlBuffer(a.data);
      if (!buffer) throw new BadRequestException('WORKFLOW_COPILOT_EMBEDDED_FILE_DECODE');
      return {
        originalname: workflowCopilotAttachmentDisplayName(a),
        mimetype: a.mime.trim(),
        size: buffer.length,
        buffer,
      };
    });
    await this.fileNodes.upload(sessionId, nodeId, uploads);
    const snap = await this.graph.loadSnapshot(sessionId);
    const n = snap.nodes.find((e) => e.id === nodeId);
    if (n) nodesById.set(nodeId, n);
    return snap.lastEventId ?? eventId;
  }

  /** Writes chat attachments into a real `file_summary` via {@link FileNodeService.upload} (after model {@link WorkflowCopilotTurn.attachmentGraph}). */
  private async materializeSendMessageFileSummary(
    sessionId: string,
    target: 'new' | 'existing',
    existingNodeId: string | undefined,
    position: { x: number; y: number } | undefined,
    branches: string[] | undefined,
    attachments: WorkflowCopilotAttachment[],
    threadAgentType: AgentType,
  ): Promise<string> {
    let nodeId: string;
    if (target === 'new') {
      const snap = await this.graph.loadSnapshot(sessionId);
      const nodesById = new Map(snap.nodes.map((e) => [e.id, e] as const));
      const next = normalizeNodeContent(
        'file_summary',
        defaultNodeContent('file_summary'),
        threadAgentType,
        new Map(),
        sessionId,
        nodesById,
      );
      const env = await this.graph.addNode(sessionId, {
        type: next.type,
        content: next.content,
        creator: HUMAN_ACTOR,
        position: position ?? { x: 280, y: 120 },
        requestId: randomUUID(),
        branches,
      });
      if (env.payload.type !== 'node_added') {
        throw new BadRequestException('WORKFLOW_COPILOT_FILE_SUMMARY_NODE_CREATE_FAILED');
      }
      nodeId = env.payload.node.id;
    } else {
      const id = existingNodeId?.trim();
      if (!id) throw new BadRequestException('WORKFLOW_COPILOT_FILE_SUMMARY_NODE_REQUIRED');
      const snap = await this.graph.loadSnapshot(sessionId);
      const n = snap.nodes.find((e) => e.id === id);
      if (!n) throw new NotFoundException('NODE_NOT_FOUND');
      if (n.type !== 'file_summary') throw new BadRequestException('WORKFLOW_COPILOT_FILE_SUMMARY_TYPE_REQUIRED');
      nodeId = id;
    }
    const uploads = attachments.map((a) => {
      const buffer = decodeBase64DataUrlBuffer(a.data);
      if (!buffer) throw new BadRequestException('WORKFLOW_COPILOT_EMBEDDED_FILE_DECODE');
      return {
        originalname: workflowCopilotAttachmentDisplayName(a),
        mimetype: a.mime.trim(),
        size: buffer.length,
        buffer,
      };
    });
    await this.fileNodes.upload(sessionId, nodeId, uploads);
    return nodeId;
  }

  private sendDeps() {
    return {
      prisma: this.prisma,
      readSession: this.readSession.bind(this),
      readThreadRow: this.readThreadRow.bind(this),
      readLockedNodeSelection: this.readLockedNodeSelection.bind(this),
      emitThreadRow: this.emitThreadRow.bind(this),
      emitMessageRow: this.emitMessageRow.bind(this),
      emitCopilotMessage: this.emitCopilotMessage.bind(this),
      readBundle: this.readBundle.bind(this),
      runThread: this.runThread.bind(this),
      applyMessage: this.applyMessage.bind(this),
      materializeSendMessageFileSummary: this.materializeSendMessageFileSummary.bind(this),
      runCopilotExecutions: this.runCopilotExecutions.bind(this),
      abortByThread: this.abortByThread,
    };
  }

  private applyDeps() {
    return {
      prisma: this.prisma,
      graph: this.graph,
      activity: this.activity,
      readThreadRow: this.readThreadRow.bind(this),
      readMessageRow: this.readMessageRow.bind(this),
      readBundle: this.readBundle.bind(this),
      materializeCopilotEmbeddedFiles: this.materializeCopilotEmbeddedFiles.bind(this),
      reconcileStructuredNodeRefs: this.reconcileStructuredNodeRefs.bind(this),
      validateStructuredNodes: this.validateStructuredNodes.bind(this),
      materializeWorkflowEdges: this.materializeWorkflowEdges.bind(this),
    };
  }

  async ensureThread(sessionId: string, body: WorkflowCopilotEnsureThread): Promise<WorkflowCopilotThreadBundle> {
    const input = workflowCopilotEnsureThreadSchema.parse(body);
    await this.assertSession(sessionId);
    if (input.surface === 'node' && !input.ownerNodeId) {
      throw new BadRequestException('WORKFLOW_COPILOT_OWNER_NODE_REQUIRED');
    }
    const scope = input.scope ?? defaultScope(input.surface, input.ownerNodeId);
    const mode = input.mode ?? DEFAULT_MODE;
    const locked =
      input.surface === 'node' ? await this.readLockedNodeSelection(sessionId, input.ownerNodeId) : null;
    const agentType = locked?.type ?? input.agentType ?? DEFAULT_AGENT_TYPE;
    const model = locked?.model ?? input.model;
    const key = {
      sessionId,
      surface: input.surface,
      ownerKey: threadOwnerKey(input.surface, input.ownerNodeId),
    };
    const current = await this.prisma.workflowCopilotThread.findUnique({
      where: { sessionId_surface_ownerKey: key },
      select: { metadata: true },
    });
    const metadata = mergeThreadMetadata(readThreadMetadata(current?.metadata), input.metadata);
    const row = await this.prisma.workflowCopilotThread.upsert({
      where: {
        sessionId_surface_ownerKey: key,
      },
      create: {
        sessionId,
        surface: input.surface,
        ownerKey: key.ownerKey,
        ownerNodeId: input.ownerNodeId,
        title: input.title,
        agentType,
        modelProviderId: model?.providerID ?? null,
        modelId: model?.modelID ?? null,
        scope: scope as never,
        mode: mode as never,
        autoApply: input.autoApply ?? DEFAULT_AUTO_APPLY,
        autoRun: input.autoRun ?? DEFAULT_AUTO_RUN,
        ...(metadata ? { metadata: metadata as never } : {}),
      },
      update: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.agentType !== undefined || input.model !== undefined || locked
          ? { agentType }
          : {}),
        ...(input.model !== undefined || locked
          ? {
              modelProviderId: model?.providerID ?? null,
              modelId: model?.modelID ?? null,
            }
          : {}),
        ...(input.scope !== undefined ? { scope: input.scope as never } : {}),
        ...(input.autoApply !== undefined ? { autoApply: input.autoApply } : {}),
        ...(input.autoRun !== undefined ? { autoRun: input.autoRun } : {}),
        ...(input.metadata !== undefined ? { metadata: metadata as never } : {}),
      },
    }) as ThreadRow;
    this.emitThreadRow(sessionId, row);
    return this.readBundle(sessionId, row.id);
  }

  async getThread(sessionId: string, threadId: string): Promise<WorkflowCopilotThreadBundle> {
    return this.readBundle(sessionId, threadId);
  }

  async patchThread(
    sessionId: string,
    threadId: string,
    body: unknown,
  ): Promise<WorkflowCopilotThreadBundle> {
    const patch = workflowCopilotThreadPatchSchema.parse(body);
    const row = await this.readThreadRow(sessionId, threadId);
    const locked =
      row.surface === 'node' ? await this.readLockedNodeSelection(sessionId, row.ownerNodeId) : null;
    const agentType = locked?.type ?? patch.agentType;
    const model = locked?.model ?? patch.model;
    const metadata = mergeThreadMetadata(readThreadMetadata(row.metadata), patch.metadata);
    const next = await this.prisma.workflowCopilotThread.update({
      where: { id: row.id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.scope !== undefined ? { scope: patch.scope as never } : {}),
        ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        ...(patch.agentType !== undefined || locked
          ? { agentType: agentType ?? row.agentType }
          : {}),
        ...(patch.model !== undefined || locked
          ? {
              modelProviderId: model?.providerID ?? null,
              modelId: model?.modelID ?? null,
            }
          : {}),
        ...(patch.autoApply !== undefined ? { autoApply: patch.autoApply } : {}),
        ...(patch.autoRun !== undefined ? { autoRun: patch.autoRun } : {}),
        ...(patch.externalSessionId !== undefined ? { externalSessionId: patch.externalSessionId } : {}),
        ...(patch.metadata !== undefined ? { metadata: metadata as never } : {}),
      },
    }) as ThreadRow;
    this.emitThreadRow(sessionId, next);
    return this.readBundle(sessionId, threadId);
  }

  async sendMessage(
    sessionId: string,
    threadId: string,
    body: unknown,
  ): Promise<WorkflowCopilotSendResult> {
    const input = workflowCopilotSendMessageSchema.parse(body);
    const row = await this.readThreadRow(sessionId, threadId);
    const current = readThreadMetadata(row.metadata);
    if (current?.role === 'concierge') {
      if (current.skill?.id && current.lockSkill) {
        return sendWorkflowCopilotMessage(this.sendDeps(), {
          sessionId,
          threadId,
          body: input,
        });
      }
      const candidatesRoute = this.skillsService?.routeSkillCandidates?.bind(this.skillsService)
        ?? noopSkills.routeSkillCandidates;
      const singleRoute = this.skillsService?.routeSkill?.bind(this.skillsService)
        ?? noopSkills.routeSkill;
      const candidates = input.content.trim()
        ? await candidatesRoute(input.content, ['workflow_template'], 3)
        : [];
      const skill = input.content.trim()
        ? await singleRoute(input.content)
        : null;
      const nextSkill = skill ?? current.skill;
      const nextCandidates = candidates.length > 0 ? candidates : (current?.architect?.candidates ?? []);
      const clarificationCount = nextSkill
        ? 0
        : Math.min(3, (current.clarificationCount ?? 0) + 1);
      const keepSpec = nextSkill && current?.skill?.id === nextSkill.id
        ? current?.architect?.spec
        : undefined;
      const metadata = mergeThreadMetadata(current, {
        skill: nextSkill,
        clarificationStatus: nextSkill ? 'ready' : 'needs_input',
        clarificationCount,
        architect: {
          status: keepSpec ? (current?.architect?.status ?? 'draft') : 'draft',
          candidates: nextCandidates,
          ...(keepSpec ? { spec: keepSpec } : {}),
          ...(current?.architect?.generatedAt ? { generatedAt: current.architect.generatedAt } : {}),
        },
      });
      if (!sameJson(current ?? null, metadata ?? null)) {
        const next = await this.prisma.workflowCopilotThread.update({
          where: { id: row.id },
          data: { metadata: metadata as never },
        }) as ThreadRow;
        this.emitThreadRow(sessionId, next);
      }
    }
    return sendWorkflowCopilotMessage(this.sendDeps(), {
      sessionId,
      threadId,
      body: input,
    });
  }

  private async listRunnableAgentTypes(): Promise<Set<AgentType>> {
    try {
      const { listAgentAdapters } = await importAgentCore();
      return new Set(listAgentAdapters().map((adapter) => adapter.type));
    } catch {
      return new Set<AgentType>();
    }
  }

  /**
   * The LLM sometimes emits {@link WorkflowCopilotWorkflowRunExecution.type}
   * values (e.g. `"orchestrator"`) that pass `agentTypeSchema` but have no
   * registered adapter in `@cepage/agent-core`, yielding a useless
   * `AGENT_ADAPTER_UNAVAILABLE`. When the declared type is not a runnable
   * adapter, fall back to the trigger node's locked selection, then to its
   * `content.agentType`; both reflect the user's real intent for that step.
   */
  private async resolveRunnableWorkflowRunType(
    sessionId: string,
    declaredType: AgentType,
    triggerNodeId: string,
    runnableTypes: Set<AgentType>,
  ): Promise<AgentType> {
    if (runnableTypes.size === 0 || runnableTypes.has(declaredType)) {
      return declaredType;
    }
    const snapshot = await this.graph.loadSnapshot(sessionId);
    const node = snapshot.nodes.find((entry) => entry.id === triggerNodeId) ?? null;
    const locked = readGraphNodeLockedSelection(node);
    if (locked && runnableTypes.has(locked.type)) {
      return locked.type;
    }
    const contentRecord =
      node && typeof node.content === 'object' && node.content !== null
        ? (node.content as Record<string, unknown>)
        : null;
    const contentAgentType =
      typeof contentRecord?.agentType === 'string' ? contentRecord.agentType : undefined;
    if (contentAgentType && runnableTypes.has(contentAgentType as AgentType)) {
      return contentAgentType as AgentType;
    }
    return declaredType;
  }

  private async runCopilotExecutions(
    sessionId: string,
    executions: WorkflowCopilotExecution[],
    refMap: Record<string, string>,
  ): Promise<WorkflowCopilotExecutionResult[]> {
    const results: WorkflowCopilotExecutionResult[] = [];
    const runnableTypes = await this.listRunnableAgentTypes();
    for (const ex of executions) {
      try {
        if (ex.kind === 'workflow_run') {
          const triggerNodeId =
            ex.triggerNodeId?.trim()
            ?? (ex.triggerRef?.trim() ? refMap[ex.triggerRef.trim()] : undefined);
          if (!triggerNodeId) {
            throw new BadRequestException('WORKFLOW_COPILOT_EXECUTION_NO_TRIGGER');
          }
          const resolvedType = await this.resolveRunnableWorkflowRunType(
            sessionId,
            ex.type,
            triggerNodeId,
            runnableTypes,
          );
          const { kind: _k, triggerRef: _tr, ...rest } = ex;
          const res = await this.agents.runWorkflow(sessionId, {
            ...rest,
            type: resolvedType,
            triggerNodeId,
          });
          results.push({
            kind: 'workflow_run',
            ok: true,
            result: executionResultRecord(res),
          });
          continue;
        }
        if (ex.kind === 'managed_flow_run') {
          const flowNodeId =
            ex.flowNodeId?.trim()
            ?? (ex.flowRef?.trim() ? refMap[ex.flowRef.trim()] : undefined);
          if (!flowNodeId) {
            throw new BadRequestException('WORKFLOW_COPILOT_EXECUTION_NO_FLOW_NODE');
          }
          const { kind: _k, flowNodeId: _f, flowRef: _fr, ...rest } = ex;
          const res = await this.flows.run(sessionId, flowNodeId, rest);
          results.push({
            kind: 'managed_flow_run',
            ok: true,
            result: executionResultRecord(res),
          });
          continue;
        }
        const controllerNodeId =
          ex.controllerNodeId?.trim()
          ?? (ex.controllerRef?.trim() ? refMap[ex.controllerRef.trim()] : undefined);
        if (!controllerNodeId) {
          throw new BadRequestException('WORKFLOW_COPILOT_EXECUTION_NO_CONTROLLER_NODE');
        }
        const { kind: _k, controllerNodeId: _c, controllerRef: _cr, ...rest } = ex;
        const res = await this.controllers.run(sessionId, controllerNodeId, rest);
        results.push({
          kind: 'controller_run',
          ok: true,
          result: executionResultRecord(res),
        });
      } catch (err) {
        results.push({
          kind: ex.kind,
          ok: false,
          error: readCopilotExecutionError(err),
        });
      }
    }
    return results;
  }

  async stopThread(sessionId: string, threadId: string): Promise<{ stopped: true }> {
    await this.readThreadRow(sessionId, threadId);
    const ac = this.abortByThread.get(threadId);
    ac?.abort();
    return { stopped: true };
  }

  async applyMessage(
    sessionId: string,
    threadId: string,
    messageId: string,
  ): Promise<WorkflowCopilotApplyResult> {
    return applyWorkflowCopilotMessage(this.applyDeps(), {
      sessionId,
      threadId,
      messageId,
    });
  }

  private async materializeWorkflowEdges(input: {
    sessionId: string;
    threadId: string;
    messageId: string;
    nodeIds: Set<string>;
    nodesById: Map<string, GraphNode>;
    edgeKeys: Set<string>;
    createdEdgeIds: string[];
    summary: string[];
    eventId: number;
  }): Promise<number> {
    let eventId = input.eventId;
    const next = [...input.nodeIds]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((nodeId) => {
        const node = input.nodesById.get(nodeId);
        if (!node) return [];
        return collectWorkflowStructuralEdges(node, input.nodesById).map((edge) => ({
          nodeId,
          edge,
        }));
      })
      .sort(
        (a, b) =>
          a.edge.source.localeCompare(b.edge.source) ||
          a.edge.target.localeCompare(b.edge.target) ||
          a.edge.relation.localeCompare(b.edge.relation) ||
          a.nodeId.localeCompare(b.nodeId),
      );
    for (const item of next) {
      const key = edgeKey(item.edge);
      if (input.edgeKeys.has(key)) continue;
      const env = await this.graph.addEdge(input.sessionId, {
        source: item.edge.source,
        target: item.edge.target,
        relation: item.edge.relation,
        direction: 'source_to_target',
        creator: HUMAN_ACTOR,
        requestId: `workflow-copilot:${input.threadId}:${input.messageId}:struct:${item.nodeId}:${item.edge.relation}:${item.edge.source}:${item.edge.target}`,
      });
      if (env.payload.type !== 'edge_added') continue;
      input.edgeKeys.add(edgeKey(env.payload.edge));
      input.createdEdgeIds.push(env.payload.edge.id);
      input.summary.push(`Connected ${shortId(env.payload.edge.source)} to ${shortId(env.payload.edge.target)}.`);
      eventId = env.eventId;
    }
    return eventId;
  }

  private validateStructuredNodes(input: {
    nodeIds: Set<string>;
    nodesById: Map<string, GraphNode>;
  }): void {
    for (const nodeId of [...input.nodeIds].sort((a, b) => a.localeCompare(b))) {
      const node = input.nodesById.get(nodeId);
      if (!node) {
        continue;
      }
      if (node.type === 'workspace_file') {
        const artifact = readWorkflowArtifactContent(node.content);
        if (
          artifact?.role === 'output'
          && artifact.pathMode === 'static'
          && isTempLikePath(artifact.relativePath)
        ) {
          throw new BadRequestException(`WORKFLOW_COPILOT_TEMP_OUTPUT_PATH:${nodeId}:${artifact.relativePath}`);
        }
        continue;
      }
      if (node.type === 'loop') {
        const loop = readWorkflowLoopContent(node.content);
        if (!loop) {
          continue;
        }
        const refs = [
          loop.bodyNodeId,
          loop.validatorNodeId,
          loop.source.kind === 'input_parts' ? loop.source.templateNodeId : undefined,
          loop.source.kind === 'input_parts' ? loop.source.boundNodeId : undefined,
          loop.source.kind === 'json_file' ? loop.source.fileNodeId : undefined,
        ];
        for (const ref of refs) {
          this.assertStructuredRefExists(node.id, ref, input.nodesById);
        }
        continue;
      }
      if (node.type === 'sub_graph') {
        const subgraph = readWorkflowSubgraphContent(node.content);
        if (!subgraph) {
          continue;
        }
        this.assertStructuredRefExists(node.id, subgraph.entryNodeId, input.nodesById);
        continue;
      }
      if (node.type !== 'managed_flow') {
        continue;
      }
      const flow = readWorkflowManagedFlowContent(node.content);
      if (!flow) {
        continue;
      }
      for (const ref of collectManagedFlowReferencedNodeIds(flow)) {
        this.assertStructuredRefExists(node.id, ref, input.nodesById);
      }
      for (const phase of flow.phases) {
        if (phase.kind !== 'runtime_verify_phase') {
          continue;
        }
        for (const output of phase.expectedOutputs) {
          if (!isTempLikePath(output)) {
            continue;
          }
          throw new BadRequestException(`WORKFLOW_COPILOT_TEMP_OUTPUT_PATH:${node.id}:${output}`);
        }
      }
    }
  }

  private assertStructuredRefExists(
    ownerNodeId: string,
    ref: string | undefined,
    nodesById: Map<string, GraphNode>,
  ): void {
    if (!ref) {
      return;
    }
    if (nodesById.has(ref)) {
      return;
    }
    throw new BadRequestException(`WORKFLOW_COPILOT_STRUCTURED_REF_MISSING:${ownerNodeId}:${ref}`);
  }

  private async reconcileStructuredNodeRefs(input: {
    sessionId: string;
    threadId: string;
    messageId: string;
    refs: Map<string, string>;
    nodesById: Map<string, GraphNode>;
    nodeTypes: Map<string, GraphNode['type']>;
    touchedNodeIds: Set<string>;
    createdNodeIds: string[];
    updatedNodeIds: string[];
    summary: string[];
    eventId: number;
    fallback: AgentType;
  }): Promise<number> {
    let eventId = input.eventId;
    for (const nodeId of [...input.touchedNodeIds].sort((a, b) => a.localeCompare(b))) {
      const node = input.nodesById.get(nodeId);
      if (!node) continue;
      const next = normalizeNodeContent(
        node.type,
        node.content,
        input.fallback,
        input.refs,
        input.sessionId,
        input.nodesById,
      );
      if (sameJson(next.content, node.content)) {
        continue;
      }
      const env = await this.graph.patchNode(
        input.sessionId,
        nodeId,
        { content: next.content as Record<string, unknown> },
        HUMAN_ACTOR,
        `workflow-copilot:${input.threadId}:${input.messageId}:resolve:${nodeId}`,
      );
      if (env.payload.type !== 'node_updated') continue;
      input.nodeTypes.set(nodeId, next.type);
      input.nodesById.set(nodeId, {
        ...node,
        content: next.content as GraphNode['content'],
        updatedAt: new Date().toISOString(),
      });
      if (!input.createdNodeIds.includes(nodeId) && !input.updatedNodeIds.includes(nodeId)) {
        input.updatedNodeIds.push(nodeId);
      }
      input.summary.push(`Resolved structured refs in node ${shortId(nodeId)}.`);
      eventId = env.eventId;
    }
    return eventId;
  }

  async restoreCheckpoint(
    sessionId: string,
    threadId: string,
    checkpointId: string,
  ): Promise<WorkflowCopilotRestoreResult> {
    await this.readThreadRow(sessionId, threadId);
    const checkpoint = await this.readCheckpointRow(threadId, checkpointId);
    const rows = await this.prisma.workflowCopilotMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
    const idx = rows.findIndex((entry) => entry.id === checkpoint.messageId);
    if (idx < 0) {
      throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
    }
    const ids = rows.slice(idx + 1).map((entry) => entry.id);
    const parsed = workflowFromSafeJson(checkpoint.flow);
    const restored = await this.graph.restoreWorkflow(
      sessionId,
      parsed,
      HUMAN_ACTOR,
      'workflow_copilot_restore',
    );
    if (ids.length > 0) {
      await this.prisma.workflowCopilotCheckpoint.deleteMany({
        where: { threadId, messageId: { in: ids } },
      });
      await this.prisma.workflowCopilotMessage.deleteMany({
        where: { threadId, id: { in: ids } },
      });
    }
    await this.prisma.workflowCopilotCheckpoint.update({
      where: { id: checkpointId },
      data: { restoredAt: new Date() },
    });
    await this.activity.log({
      sessionId,
      eventId: restored.eventId,
      actorType: 'human',
      actorId: 'local-user',
      summary: 'Restored a workflow copilot checkpoint.',
      summaryKey: 'activity.workflow_copilot_restored',
      summaryParams: { id: shortId(checkpointId) },
    });
    const bundle = await this.readBundle(sessionId, threadId);
    const nextCheckpoint = bundle.checkpoints.find((entry) => entry.id === checkpointId);
    if (!nextCheckpoint) {
      throw new NotFoundException('WORKFLOW_COPILOT_CHECKPOINT_NOT_FOUND');
    }
    return {
      thread: bundle.thread,
      messages: bundle.messages,
      checkpoint: nextCheckpoint,
      checkpoints: bundle.checkpoints,
    };
  }

  private emitCopilotMessage(sessionId: string, payload: WorkflowCopilotLiveMessagePayload): void {
    emitCopilotMessage(this.collaboration, sessionId, payload);
  }

  private emitThreadRow(sessionId: string, row: ThreadRow): void {
    emitThreadRow(this.collaboration, sessionId, row);
  }

  private emitMessageRow(
    sessionId: string,
    thread: ThreadRow,
    row: MessageRow,
    checkpoints?: WorkflowCopilotCheckpoint[],
  ): void {
    emitMessageRow(this.collaboration, sessionId, thread, row, checkpoints);
  }

  private async readBundle(sessionId: string, threadId: string): Promise<WorkflowCopilotThreadBundle> {
    return readBundle(this.prisma, sessionId, threadId);
  }

  private async readThreadRow(sessionId: string, threadId: string): Promise<ThreadRow> {
    return readThreadRow(this.prisma, sessionId, threadId);
  }

  private async readMessageRow(threadId: string, messageId: string): Promise<MessageRow> {
    return readMessageRow(this.prisma, threadId, messageId);
  }

  private async readCheckpointRow(threadId: string, checkpointId: string): Promise<CheckpointRow> {
    return readCheckpointRow(this.prisma, threadId, checkpointId);
  }

  private async assertSession(sessionId: string): Promise<void> {
    return assertSession(this.prisma, sessionId);
  }

  private async readSession(sessionId: string): Promise<SessionRow> {
    return readSession(this.prisma, sessionId);
  }

  private async readLockedNodeSelection(
    sessionId: string,
    ownerNodeId?: string | null,
  ): Promise<{ type: AgentType; model?: AgentModelRef } | null> {
    return readLockedNodeSelection(this.graph, sessionId, ownerNodeId);
  }

  private async readRelatedSkills(
    selectedSkill: WorkflowSkill | undefined,
    thread: ReturnType<typeof rowToThread>,
  ): Promise<WorkflowSkill[]> {
    const ids = uniqText([
      ...(selectedSkill?.recommendedFollowups.map((item) => item.id) ?? []),
      ...(thread.metadata?.architect?.candidates.map((item) => item.id) ?? []),
    ]).filter((id) => id !== selectedSkill?.id);
    const skills: WorkflowSkill[] = [];
    for (const id of ids) {
      try {
        skills.push(await (this.skillsService ?? noopSkills).getSkill(id));
      } catch {}
    }
    return skills;
  }

  private decorateConciergeTurn(input: {
    session: SessionRow;
    thread: ThreadRow & {
      scope: WorkflowCopilotScope;
      agentType: AgentType;
    };
    snapshot: GraphNode[];
    selectedSkill?: WorkflowSkill;
    relatedSkills: WorkflowSkill[];
    history: MessageRow[];
    turn: RunTurnResult & { ok: true };
  }): RunTurnResult {
    if (!canAutoBuildArchitecture(input.snapshot)) {
      return input.turn;
    }
    const goal = input.history
      .slice()
      .reverse()
      .find((message) => message.role === 'user')
      ?.content.trim()
      || input.selectedSkill?.summary
      || 'Create a modular workflow';
    const parsed = input.turn.turn.architecture
      ? workflowArchitectureSpecSchema.safeParse(input.turn.turn.architecture)
      : null;
    const built = buildWorkflowArchitectureOps({
      goal,
      ...(parsed?.success ? { spec: parsed.data } : {}),
      selectedSkill: input.selectedSkill,
      relatedSkills: input.relatedSkills,
      sessionId: input.session.id,
      agentType: input.thread.agentType,
      model: readModelRef(input.thread.modelProviderId, input.thread.modelId),
    });
    return {
      ...input.turn,
      turn: {
        ...input.turn.turn,
        architecture: built.spec,
        ops: built.ops,
        summary: uniqText([...input.turn.turn.summary, ...built.summary]),
        warnings: uniqText([...input.turn.turn.warnings, ...built.warnings]),
      },
    };
  }

  private async runThread(
    session: SessionRow,
    thread: ThreadRow & {
      scope: WorkflowCopilotScope;
      agentType: AgentType;
    },
    history: MessageRow[],
    signal: AbortSignal,
    onProgress?: (progress: RunThreadProgress) => Promise<void>,
  ): Promise<RunTurnResult> {
    // Only forward an absolute cwd to the daemon when the session has an
    // explicit workspace configured (workspaceParentDirectory + name). The API
    // typically runs inside Docker, so its `process.cwd()` (e.g. /repo/apps/api)
    // is meaningless to the host-native daemon and would crash with ENOENT
    // on `mkdir`. When undefined, the daemon falls back to a sane per-session
    // path under its own workspaceRoot.
    const sessionWorkspace = readSessionWorkspace(process.cwd(), session)?.workingDirectory;
    const workingDirectory = sessionWorkspace ?? `<daemon workspace for session ${session.id}>`;
    const snapshot = await this.graph.loadSnapshot(session.id);
    const flow = workflowFromSnapshot(snapshot);
    const scope = thread.scope;
    const mode = readMode(thread.mode);
    const scopeIds = scopeNodeIds(snapshot, scope);
    const scopeNodes = scopeIds.map((id) => snapshot.nodes.find((node) => node.id === id)).filter(isDefined);
    const recall = await (this.recallService ?? noopRecall).forWorkflowCopilot(
      session.id,
      scopeIds,
      thread.id,
    );
    const threadDto = rowToThread(thread);
    const toolset = threadDto.metadata?.toolset
      ?? (threadDto.metadata?.role ? resolveAgentToolset(threadDto.metadata.role) : 'orchestrator');
    const availableSkills =
      threadDto.metadata?.role === 'concierge'
        ? await (this.skillsService ?? noopSkills).listSkills(['workflow_template'])
        : [];
    let selectedSkill: WorkflowSkill | undefined;
    let selectedSkillPrompt: string | undefined;
    if (threadDto.metadata?.skill?.id) {
      try {
        selectedSkill = await (this.skillsService ?? noopSkills).getSkill(threadDto.metadata.skill.id);
        selectedSkillPrompt =
          (await (this.skillsService ?? noopSkills).getSkillPrompt(selectedSkill))?.trim().slice(0, 6000)
          || undefined;
      } catch {
        selectedSkill = undefined;
        selectedSkillPrompt = undefined;
      }
    }
    const relatedSkills = await this.readRelatedSkills(selectedSkill, threadDto);
    // Feed the merged agent catalog to the prompt so the LLM binds
    // model.providerID / model.modelID to real (catalog-listed) pairs instead
    // of copy-pasting free-form user text (e.g. "minimax 2.7 high speed").
    const availableModels = await this.agents.listCatalogForPrompt().catch(() => null);
    const promptText = buildPrompt({
      sessionId: session.id,
      workingDirectory,
      flow,
      scope,
      scopeNodes,
      thread: threadDto,
      history: history.map((message) => rowToMessage(message, mode)),
      recall,
      toolset,
      availableSkills,
      availableModels,
      selectedSkill,
      selectedSkillPrompt,
    });
    const model = readModelRef(thread.modelProviderId, thread.modelId);
    let rawOutput = '';
    let snapshotOutput = '';
    // Reasoning stream accumulator. Stays empty for agents/models that don't
    // emit a separate reasoning channel; sent through `onProgress` so the
    // copilot UI can render a live "Thinking…" panel during streaming.
    let thinkingOutput = '';
    let externalSessionId: string | undefined;
    let runtimeError: string | undefined;

    const last = history.length > 0 ? history[history.length - 1] : null;
    let parts: AgentPromptPart[] | undefined;
    if (
      last?.role === 'user' &&
      thread.agentType === 'opencode' &&
      last.attachments != null
    ) {
      const parsed = z.array(workflowCopilotAttachmentSchema).safeParse(last.attachments);
      if (parsed.success && parsed.data.length > 0) {
        parts = [
          { type: 'text', text: promptText },
          ...parsed.data.map((a) => ({
            type: 'file' as const,
            mime: a.mime,
            url: a.data,
            filename: workflowCopilotAttachmentDisplayName(a),
          })),
        ];
      }
    }

    // Delegate the agent run to the native daemon. The API container does not
    // ship agent CLI binaries; the daemon owns runAgentStream + spawn. We
    // enqueue a workflow_copilot_run job and drain DaemonMessage events the
    // daemon streams back through DaemonDispatchService.
    let copilotJobId: string | undefined;
    const onAbort = () => {
      if (copilotJobId) {
        void this.dispatch.cancelCopilotRun(copilotJobId).catch(() => {});
      }
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const enqueued = await this.dispatch.enqueueCopilotRun({
        sessionId: session.id,
        threadId: thread.id,
        type: thread.agentType,
        ...(model ? { model } : {}),
        ...(sessionWorkspace ? { cwd: sessionWorkspace } : {}),
        promptText,
        ...(parts ? { parts } : {}),
        ...(thread.externalSessionId ? { externalSessionId: thread.externalSessionId } : {}),
        ...(toolset ? { toolset } : {}),
        ...(recall ? { recall } : {}),
        role: 'workflow_copilot',
        wakeReason: 'manual',
        startedAtIso: new Date().toISOString(),
        connection: { port: getEnv().OPENCODE_PORT, hostname: getEnv().OPENCODE_HOST },
      });
      copilotJobId = enqueued.jobId;

      for await (const event of enqueued.channel.events()) {
        if (event.kind === 'fail') {
          runtimeError = runtimeError ?? event.error;
          rawOutput = rawOutput || event.error;
          if (onProgress) {
            await onProgress({ rawOutput, snapshotOutput, thinkingOutput, externalSessionId });
          }
          break;
        }
        if (event.kind === 'complete') {
          break;
        }
        const message = event.message;
        if (message.type === 'session') {
          const payload = message.payload as { externalSessionId?: string } | undefined;
          if (payload?.externalSessionId) {
            externalSessionId = payload.externalSessionId;
            if (onProgress) {
              await onProgress({ rawOutput, snapshotOutput, thinkingOutput, externalSessionId });
            }
          }
          continue;
        }
        if (message.type === 'snapshot') {
          const payload = message.payload as { output?: string } | undefined;
          if (typeof payload?.output === 'string') {
            snapshotOutput = payload.output;
            if (onProgress) {
              await onProgress({ rawOutput, snapshotOutput, thinkingOutput, externalSessionId });
            }
          }
          continue;
        }
        if (message.type === 'thinking') {
          const payload = message.payload as { chunk?: string } | undefined;
          if (typeof payload?.chunk === 'string' && payload.chunk.length > 0) {
            thinkingOutput += payload.chunk;
            if (onProgress) {
              await onProgress({ rawOutput, snapshotOutput, thinkingOutput, externalSessionId });
            }
          }
          continue;
        }
        if (message.type === 'stdout' || message.type === 'stderr') {
          const payload = message.payload as { chunk?: string } | undefined;
          if (typeof payload?.chunk === 'string') {
            rawOutput += payload.chunk;
            if (onProgress) {
              await onProgress({ rawOutput, snapshotOutput, thinkingOutput, externalSessionId });
            }
          }
          continue;
        }
        if (message.type === 'error') {
          const payload = message.payload as { message?: string } | undefined;
          const errMsg = payload?.message ?? 'unknown error';
          runtimeError = runtimeError ?? errMsg;
          rawOutput = rawOutput || errMsg;
          if (onProgress) {
            await onProgress({ rawOutput, snapshotOutput, thinkingOutput, externalSessionId });
          }
        }
      }
    } catch (errorValue) {
      return {
        ok: false,
        rawOutput,
        error: signal.aborted
          ? WORKFLOW_COPILOT_STOPPED
          : errorValue instanceof Error
            ? errorValue.message
            : String(errorValue),
        externalSessionId,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    const result = finalizeWorkflowCopilotRun({
      rawOutput,
      snapshotOutput,
      error: runtimeError,
      stopped: signal.aborted,
      externalSessionId,
    });
    if (!result.ok || threadDto.metadata?.role !== 'concierge' || mode === 'ask') {
      return result;
    }
    return this.decorateConciergeTurn({
      session,
      thread,
      snapshot: snapshot.nodes,
      selectedSkill,
      relatedSkills,
      history,
      turn: result,
    });
  }
}




