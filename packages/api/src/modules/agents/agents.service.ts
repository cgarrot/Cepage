import { BadRequestException, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { getEnv } from '@cepage/config';
import {
  applyNodeAgentSelection,
  inputNodeStartResultSchema,
  ok,
  readWorkflowInputContent,
  resolveAgentToolset,
  workflowRunResultSchema,
  type AgentCatalog,
  type AgentDelegationContext,
  type AgentModelRef,
  type AgentKernelRecallEntry,
  type AgentPromptPart,
  type AgentRerunRequest,
  type AgentRuntime,
  type AgentToolsetId,
  type AgentType,
  type Creator,
  type GraphNode,
  type GraphSnapshot,
  type InputNodeStartResult,
  type WorkflowInputPart,
  type WorkflowRunResult,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import { GraphService } from '../graph/graph.service';
import { CollaborationBusService } from '../collaboration/collaboration-bus.service';
import { ActivityService } from '../activity/activity.service';
import type { AgentRun, WakeReason } from '@cepage/shared-core';
import { RunArtifactsService } from './run-artifacts.service';
import { RuntimeService } from '../runtime/runtime.service';
import type {
  AgentRunFallbackEntry,
  AgentRunJobPayload,
} from '../execution/execution-job-payload';
import { AgentPolicyService } from '../agent-policy/agent-policy.service';
import { BudgetPolicyService } from '../execution/budget-policy.service';
import { DaemonRegistryService } from '../execution/daemon/daemon-registry.service';
import { LeaseService } from '../execution/lease.service';
import { RunSupervisorService } from '../execution/run-supervisor.service';
import { WorktreeService } from '../execution/worktree.service';
import { WorkflowManagedFlowNotifierService } from './workflow-managed-flow-notifier.service';
import { importAgentCore } from './agent-core.runtime';
import { buildPrompt as buildAgentPrompt } from './agents-prompt.util';
import { AgentRecallService } from './agent-recall.service';
import type {
  AgentSpawnInput,
  SpawnResponse,
  WorkflowBoundInput,
  WorkflowRunFile,
} from './agents.types';
import {
  clearRunMessages,
  loadRunState,
  resolveRerunSelection,
} from './agents-run-state';
import {
  runExecutionStream,
  runGraphStream,
} from './agents-stream-pipeline';
import {
  parseInputNodeStartBody,
  parseWorkflowRunBody,
} from './agents-request-parse';
import {
  ACTIVE_RUN_STATUSES,
  assertDirectWorkflowRunAllowed,
  assertNoUnusedWorkflowFiles,
  buildWorkflowFileMap,
  collectConnectedNodeIds,
  componentWorkflowInputTemplates,
  componentWorkflowSeedNodeIds,
  findConnectedStepNode,
  findInputTemplate,
  findLatestWorkflowBound,
  inputFilePath,
  looksLikeWorkflowSeed,
  resolveNodeSelection,
  uniqIds,
} from './workflow-inputs.util';
import {
  createWorkflowExecution,
  findActiveExecution,
  findLatestExecution,
} from './workflow-execution.repository';
import {
  createWorkflowBoundInput,
  createWorkflowBoundInputFromSources,
  materializeWorkflowInputs,
} from './workflow-input-materializer';

const noopRecall = {
  forAgentRun: async () => [],
} satisfies Pick<AgentRecallService, 'forAgentRun'>;

@Injectable()
export class AgentsService {
  private readonly abortByRun = new Map<string, AbortController>();
  private readonly runJobByRun = new Map<string, Promise<void>>();
  private readonly inFlightSpawnByRequestId = new Map<string, Promise<SpawnResponse>>();
  private readonly inFlightRerunByRunId = new Map<string, Promise<SpawnResponse>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly collaboration: CollaborationBusService,
    private readonly activity: ActivityService,
    private readonly artifacts: RunArtifactsService,
    private readonly runtime: RuntimeService,
    @Optional()
    private readonly recallService?: AgentRecallService,
    @Optional()
    @Inject(forwardRef(() => WorkflowManagedFlowNotifierService))
    private readonly flowNotifier?: WorkflowManagedFlowNotifierService,
    @Optional()
    private readonly supervisor?: RunSupervisorService,
    @Optional()
    private readonly leases?: LeaseService,
    @Optional()
    private readonly budgets?: BudgetPolicyService,
    @Optional()
    private readonly worktrees?: WorktreeService,
    // Optional so existing test setups that build AgentsService manually keep
    // working — when missing, the catalog endpoint falls back to a clear
    // "daemon offline" placeholder instead of crashing.
    @Optional()
    private readonly daemonRegistry?: DaemonRegistryService,
    // Optional (AgentPolicyModule imports AgentsModule so we go through
    // forwardRef to avoid a circular DI). When missing, fallback chains are
    // not computed — the run goes with just the primary model.
    @Optional()
    @Inject(forwardRef(() => AgentPolicyService))
    private readonly agentPolicy?: AgentPolicyService,
  ) {}

  private agentCreator(runId: string, agentType: AgentType): Creator {
    return { type: 'agent', agentType, agentId: runId };
  }

  private rerunKey(sessionId: string, runId: string): string {
    return `${sessionId}:${runId}`;
  }

  private async ensureAdapterAvailable(type: AgentType): Promise<void> {
    const { getAgentAdapter } = await importAgentCore();
    if (!getAgentAdapter(type)) {
      throw new NotFoundException('AGENT_ADAPTER_UNAVAILABLE');
    }
  }

  async catalog(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    // Source of truth: the native daemon, which has the agent CLIs installed
    // locally. The API container intentionally does NOT ship `opencode` /
    // `cursor-agent` binaries, so trying to spawn them here would yield a
    // misleading `spawn opencode ENOENT` in the UI. The daemon pushes its
    // freshly-discovered providers via /register and /heartbeat metadata.
    const merged = (await this.daemonRegistry?.getMergedCatalog()) ?? null;
    if (merged && merged.providers.length > 0) {
      return ok(merged);
    }
    return ok(this.buildDaemonOfflineCatalog());
  }

  /**
   * Internal accessor for the merged agent catalog, used by the workflow
   * copilot prompt builder to constrain the LLM's (providerID, modelID)
   * binding to real catalog entries. Unlike `catalog()`, this skips the
   * session existence check and returns `null` (not the placeholder) when
   * no daemon has advertised a catalog yet — callers render a dedicated
   * "daemon offline" warning inside the prompt instead of a fake catalog.
   */
  async listCatalogForPrompt(): Promise<AgentCatalog | null> {
    const merged = (await this.daemonRegistry?.getMergedCatalog()) ?? null;
    if (!merged || merged.providers.length === 0) return null;
    return merged;
  }

  /**
   * Preflight + build the fallback chain for an agent run.
   *
   * - Derives an ordered chain of `(agentType, providerID, modelID)` triplets
   *   starting with the caller's primary and extended with sibling models
   *   pulled from AgentPolicy (by `fallbackTag` when provided). This requires
   *   `AgentPolicyService` — when it's not wired (tests that build the
   *   service bare), we return only the primary.
   * - Consults the merged catalog and picks the first entry that is actually
   *   live (provider present, `availability !== 'unavailable'`, and the model
   *   appears in the provider's model list). Entries earlier in the chain that
   *   are known-unavailable are skipped but kept in the chain tail so a later
   *   runtime failure can still fall back to a sibling.
   * - When nothing in the chain is live (or no catalog is published), keep the
   *   primary as `selected` — the daemon will fail later, which is fine: the
   *   chain is preserved so the reactive `failJob` path can still try the
   *   next entry.
   *
   * Returns `{ selected, chain, index }` where:
   *   - `selected` is the binding to actually use for this spawn
   *   - `chain` is the full ordered list (includes `selected` at position `index`)
   *   - `index` is the zero-based position of `selected` in `chain`
   *
   * When no model is provided at all (primary has `type` only), fallback is
   * disabled (empty chain, index 0, selected = undefined model) — the run
   * uses whichever default the daemon picks for that agent type.
   */
  async resolveRunFallback(input: {
    agentType: AgentType;
    model?: AgentModelRef;
    fallbackTag?: string;
  }): Promise<{
    selected: AgentModelRef | undefined;
    chain: AgentRunFallbackEntry[];
    index: number;
  }> {
    if (!input.model) {
      return { selected: undefined, chain: [], index: 0 };
    }
    const primary: AgentRunFallbackEntry = {
      agentType: input.agentType,
      providerID: input.model.providerID,
      modelID: input.model.modelID,
    };
    let chain: AgentRunFallbackEntry[] = [primary];
    if (this.agentPolicy) {
      try {
        chain = await this.agentPolicy.resolveFallbackChain(primary, input.fallbackTag);
      } catch {
        chain = [primary];
      }
    }
    const catalog = await this.listCatalogForPrompt().catch(() => null);
    if (!catalog) {
      return {
        selected: { providerID: primary.providerID, modelID: primary.modelID },
        chain,
        index: 0,
      };
    }
    for (let i = 0; i < chain.length; i += 1) {
      if (this.isBindingLive(catalog, chain[i])) {
        const entry = chain[i];
        return {
          selected: { providerID: entry.providerID, modelID: entry.modelID },
          chain,
          index: i,
        };
      }
    }
    return {
      selected: { providerID: primary.providerID, modelID: primary.modelID },
      chain,
      index: 0,
    };
  }

  private isBindingLive(catalog: AgentCatalog, binding: AgentRunFallbackEntry): boolean {
    // The merged daemon catalog uses two possible shapes:
    //   (1) "denormalized" — one top-level entry per upstream provider, where
    //       provider.providerID === model.providerID (e.g. opencode-go, zai-coding-plan).
    //       This is what the fallback unit tests double.
    //   (2) "aggregated"   — one top-level entry per agentType (opencode,
    //       cursor_agent), with mixed-provider models inside models[] where
    //       each model carries its own upstream providerID (google, zai-coding-plan, …).
    //       This is what the real daemon publishes today.
    // In both shapes, the canonical identity of a binding is
    // (agentType, model.providerID, model.modelID) — the top-level providerID is
    // sometimes just an alias of agentType. We therefore iterate every provider
    // of the requested agentType, skip unavailable ones, and consider the
    // binding live when any ready provider advertises a model with the matching
    // (providerID, modelID) pair. If a ready provider has no models listed
    // (daemon still enumerating), we accept the binding optimistically — that
    // preserves the prior lenience for partially-populated catalogs.
    const candidates = catalog.providers.filter((p) => p.agentType === binding.agentType);
    if (candidates.length === 0) return false;
    for (const provider of candidates) {
      if (provider.availability === 'unavailable') continue;
      const models = provider.models ?? [];
      if (models.length === 0) return true;
      if (
        models.some(
          (m) => m.providerID === binding.providerID && m.modelID === binding.modelID,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Placeholder catalog returned when no daemon is running (or none have
   * reported a catalog yet). The UI keys off `availability: 'unavailable'`
   * + `unavailableReason` to render the "Provider unavailable" message; we
   * return one entry per known agent type so the menu still shows the agent
   * names and a clear next-step instead of being empty.
   */
  private buildDaemonOfflineCatalog(): AgentCatalog {
    const fetchedAt = new Date().toISOString();
    const reason = 'DAEMON_OFFLINE';
    return {
      providers: [
        {
          agentType: 'opencode',
          providerID: 'opencode',
          label: 'OpenCode',
          availability: 'unavailable',
          unavailableReason: reason,
          models: [],
        },
        {
          agentType: 'cursor_agent',
          providerID: 'cursor_agent',
          label: 'Cursor Agent',
          availability: 'unavailable',
          unavailableReason: reason,
          models: [],
        },
      ],
      fetchedAt,
    };
  }

  private resolveWorkingDirectory(
    session: {
      id: string;
      workspaceParentDirectory: string | null;
      workspaceDirectoryName: string | null;
    },
    workingDirectory?: string | null,
    runtimeCwd?: string | null,
  ): string {
    const storedWorkspace = readSessionWorkspace(process.cwd(), session);
    return path.resolve(
      process.cwd(),
      workingDirectory ?? storedWorkspace?.workingDirectory ?? runtimeCwd ?? getEnv().AGENT_WORKING_DIRECTORY,
    );
  }

  private async writeInputAsset(
    cwd: string,
    sessionId: string,
    nodeId: string,
    part: Extract<WorkflowInputPart, { type: 'file' | 'image' }>,
    buffer: Buffer,
  ): Promise<void> {
    const filepath = inputFilePath(cwd, sessionId, nodeId, part);
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, buffer);
  }

  private workflowInputDeps() {
    return {
      graph: this.graph,
      writeInputAsset: this.writeInputAsset.bind(this),
    };
  }

  private async loadRunState(sessionId: string, agentRunId: string) {
    return loadRunState(this.prisma, this.graph, sessionId, agentRunId);
  }

  private streamDeps() {
    return {
      prisma: this.prisma,
      graph: this.graph,
      activity: this.activity,
      artifacts: this.artifacts,
      runtime: this.runtime,
      emitAgentStatus: this.emitAgentStatus.bind(this),
      emitOutputChunk: this.emitOutputChunk.bind(this),
    };
  }

  private async buildPromptParts(
    type: AgentType,
    cwd: string,
    sessionId: string,
    nodes: GraphNode[],
    seedNodeIds: string[],
    promptText: string,
  ): Promise<AgentPromptPart[]> {
    const parts: AgentPromptPart[] = [{ type: 'text', text: promptText }];
    if (type !== 'opencode') {
      return parts;
    }
    for (const id of seedNodeIds) {
      const node = nodes.find((entry) => entry.id === id);
      if (!node || node.type !== 'input') continue;
      const content = readWorkflowInputContent(node.content);
      if (!content || content.mode !== 'bound') continue;
      for (const part of content.parts) {
        if (part.type === 'text') continue;
        if ((part.transferMode ?? 'reference') !== 'context') continue;
        const buffer = await fs.readFile(inputFilePath(cwd, sessionId, node.id, part));
        parts.push({
          type: 'file',
          mime: part.file.mimeType,
          filename: part.file.name,
          url: `data:${part.file.mimeType};base64,${buffer.toString('base64')}`,
        });
      }
    }
    return parts;
  }

  private buildPrompt(...args: Parameters<typeof buildAgentPrompt>): string {
    return buildAgentPrompt(...args);
  }

  private async readDelegation(parentRunId?: string | null): Promise<AgentDelegationContext | undefined> {
    const id = parentRunId?.trim();
    if (!id) return undefined;
    let depth = 0;
    let current: string | null = id;
    while (current && depth < 8) {
      depth += 1;
      const next: { parentRunId: string | null } | null = await this.prisma.agentRun.findUnique({
        where: { id: current },
        select: { parentRunId: true },
      });
      current = next?.parentRunId ?? null;
    }
    return {
      parentRunId: id,
      depth,
      allowed: depth < 3,
    };
  }

  private async readKernel(
    sessionId: string,
    role: string,
    seedNodeIds: string[],
    runId?: string,
    parentRunId?: string | null,
  ): Promise<{
    toolset: AgentToolsetId;
    recall: AgentKernelRecallEntry[];
    delegation?: AgentDelegationContext;
  }> {
    return {
      toolset: resolveAgentToolset(role),
      recall: await (this.recallService ?? noopRecall).forAgentRun(sessionId, seedNodeIds, runId),
      delegation: await this.readDelegation(parentRunId),
    };
  }

  private assertPromptPartsSupported(type: AgentType, parts: AgentPromptPart[]): void {
    if (type === 'opencode') return;
    if (parts.some((part) => part.type === 'file')) {
      throw new BadRequestException(`AGENT_ADAPTER_MULTIMODAL_UNSUPPORTED:${type}`);
    }
  }

  private resolveWorkflowSeedNodeIds(snapshot: GraphSnapshot, triggerNodeId?: string | null): string[] {
    if (triggerNodeId) {
      return collectConnectedNodeIds(triggerNodeId, snapshot.edges);
    }
    const roots = snapshot.nodes.filter(looksLikeWorkflowSeed).map((node) => node.id);
    if (roots.length === 0) return [];
    return uniqIds(roots.flatMap((id) => collectConnectedNodeIds(id, snapshot.edges)));
  }

  private emitAgentStatus(
    sessionId: string,
    runId: string,
    eventId: number,
    payload: AgentRun,
  ): void {
    this.collaboration.emitSession(sessionId, {
      type: 'agent.status',
      eventId,
      sessionId,
      runId,
      actor: { type: 'agent', id: runId },
      timestamp: new Date().toISOString(),
      payload,
    });
    this.flowNotifier?.notifyAgentStatus(sessionId, payload);
  }

  private spawnRequestKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }

  private async findExistingSpawn(sessionId: string, requestId: string): Promise<SpawnResponse | null> {
    const run = await this.prisma.agentRun.findFirst({
      where: { sessionId, requestId },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    });
    if (!run) {
      return null;
    }

    return ok({
      agentRunId: run.id,
      rootNodeId: run.stepNodeId ?? run.triggerNodeId ?? run.rootNodeId ?? run.id,
      status: run.status as AgentRun['status'],
      wakeReason: run.wakeReason as WakeReason,
    });
  }

  private buildBootingRun(input: {
    runId: string;
    sessionId: string;
    executionId?: string;
    requestId?: string;
    parentRunId?: string;
    type: AgentType;
    role: string;
    wakeReason: WakeReason;
    startedAt: string;
    seedNodeIds: string[];
    rootNodeId?: string;
    triggerNodeId?: string | null;
    stepNodeId?: string | null;
    cwd: string;
    model?: AgentModelRef;
    externalSessionId?: string;
  }): AgentRun {
    return {
      id: input.runId,
      sessionId: input.sessionId,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      type: input.type,
      role: input.role,
      runtime: { kind: 'local_process', cwd: input.cwd },
      wakeReason: input.wakeReason,
      status: 'booting',
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
      seedNodeIds: input.seedNodeIds,
      ...(input.rootNodeId ? { rootNodeId: input.rootNodeId } : {}),
      ...(input.triggerNodeId ? { triggerNodeId: input.triggerNodeId } : {}),
      ...(input.stepNodeId ? { stepNodeId: input.stepNodeId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
      outputText: '',
      isStreaming: true,
    };
  }

  private buildRootContent(input: {
    rootNode: GraphNode;
    type: AgentType;
    model?: AgentModelRef;
    seedNodeIds: string[];
    cwd: string;
    triggerNodeId: string | null;
  }): GraphNode['content'] {
    const content =
      input.rootNode.content && typeof input.rootNode.content === 'object' && !Array.isArray(input.rootNode.content)
        ? (input.rootNode.content as Record<string, unknown>)
        : {};
    const cfg =
      content.config && typeof content.config === 'object' && !Array.isArray(content.config)
        ? (content.config as Record<string, unknown>)
        : {};
    return applyNodeAgentSelection('agent_spawn', {
      ...content,
      config: {
        ...cfg,
        workingDirectory: input.cwd,
        contextNodeIds: input.seedNodeIds,
        triggerNodeId: input.triggerNodeId ?? undefined,
      },
    }, {
      mode: 'locked',
      selection: {
        type: input.type,
        ...(input.model ? { model: input.model } : {}),
      },
    });
  }

  private async waitForRunStop(runId: string): Promise<void> {
    const ac = this.abortByRun.get(runId);
    ac?.abort();
    const job = this.runJobByRun.get(runId);
    if (!job) {
      if (this.supervisor) {
        for (let count = 0; count < 40; count += 1) {
          const row = await this.prisma.agentRun.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (!row || !ACTIVE_RUN_STATUSES.has(row.status as AgentRun['status'])) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      return;
    }
    try {
      await job;
    } catch {
      // The existing run already reports its own failure state.
    }
  }

  async executeQueuedRun(payload: AgentRunJobPayload, workerId?: string): Promise<Record<string, unknown>> {
    const ac = new AbortController();
    this.abortByRun.set(payload.runId, ac);
    const timer = setInterval(() => {
      void this.prisma.agentRun.findUnique({
        where: { id: payload.runId },
        select: { status: true },
      }).then((row) => {
        if (!row) return;
        if (row.status === 'cancelled' || row.status === 'failed') {
          ac.abort();
        }
      }).catch(() => {
        // Best-effort cancellation polling should not break the worker loop.
      });
    }, 1_000);
    try {
      if (this.budgets) {
        const budget = await this.budgets.reserve({
          sessionId: payload.sessionId,
          scopeKind: payload.mode === 'execution' ? 'execution' : 'run',
          scopeId: payload.executionId ?? payload.runId,
          sourceNodeId: payload.triggerNodeId ?? payload.rootNodeId ?? payload.outputNodeId,
          runId: payload.runId,
          requestId: payload.requestId,
          workerId,
        });
        if (!budget.ok) {
          throw new Error('BUDGET_EXHAUSTED');
        }
      }
      if (this.worktrees) {
        await this.worktrees.allocate({
          sessionId: payload.sessionId,
          runId: payload.runId,
          executionId: payload.executionId,
          cwd: payload.cwd,
        });
      }
      if (this.leases) {
        const lease = await this.leases.acquire({
          sessionId: payload.sessionId,
          resourceKind: 'workspace',
          resourceKey: payload.cwd,
          holderKind: payload.mode === 'execution' ? 'workflow_execution' : 'agent_run',
          holderId: payload.executionId ?? payload.runId,
          workerId,
          runId: payload.runId,
          executionId: payload.executionId,
          requestId: payload.requestId,
          sourceNodeId: payload.triggerNodeId ?? payload.rootNodeId ?? payload.outputNodeId,
        });
        if (!lease.ok) {
          throw new Error(`LEASE_CONFLICT:${lease.holderId}`);
        }
      }
      if (payload.mode === 'execution') {
        await this.runExecutionLoop(
          payload.sessionId,
          payload.executionId ?? '',
          payload.runId,
          payload.ownerNodeId ?? payload.rootNodeId,
          payload.triggerNodeId ?? null,
          payload.stepNodeId ?? null,
          payload.type,
          payload.model,
          payload.seedNodeIds,
          payload.role,
          payload.wakeReason,
          payload.startedAtIso,
          payload.cwd,
          payload.promptText,
          payload.parts,
          payload.externalSessionId,
          payload.toolset,
          payload.recall,
          payload.delegation,
          payload.requestId,
          ac.signal,
        );
        return {
          runId: payload.runId,
          executionId: payload.executionId ?? null,
        };
      }
      await this.runLoop(
        payload.sessionId,
        payload.runId,
        payload.rootNodeId,
        payload.outputNodeId ?? payload.rootNodeId,
        payload.type,
        payload.model,
        payload.seedNodeIds,
        payload.role,
        payload.wakeReason,
        payload.startedAtIso,
        payload.initialEventId ?? 0,
        payload.cwd,
        payload.promptText,
        payload.parts,
        payload.externalSessionId,
        payload.toolset,
        payload.recall,
        payload.delegation,
        payload.errorPosition ?? { x: 0, y: 0 },
        ac.signal,
      );
      return {
        runId: payload.runId,
      };
    } finally {
      clearInterval(timer);
      this.abortByRun.delete(payload.runId);
      await this.leases?.releaseByHolder(payload.executionId ?? payload.runId);
      await this.worktrees?.releaseByRun(payload.runId);
    }
  }

  private startRun(input: {
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
  }): void {
    if (this.supervisor) {
      void this.supervisor.queueAgentRun({
        mode: 'graph',
        sessionId: input.sessionId,
        runId: input.runId,
        rootNodeId: input.rootNodeId,
        outputNodeId: input.outputNodeId,
        type: input.type,
        model: input.model,
        seedNodeIds: input.seedNodeIds,
        role: input.role,
        wakeReason: input.wakeReason,
        startedAtIso: input.startedAtIso,
        initialEventId: input.initialEventId,
        cwd: input.cwd,
        promptText: input.promptText,
        parts: input.parts,
        externalSessionId: input.externalSessionId,
        toolset: input.toolset,
        recall: input.recall,
        delegation: input.delegation,
        errorPosition: input.errorPosition,
      });
      return;
    }
    const ac = new AbortController();
    this.abortByRun.set(input.runId, ac);
    const job = this.runLoop(
      input.sessionId,
      input.runId,
      input.rootNodeId,
      input.outputNodeId,
      input.type,
      input.model,
      input.seedNodeIds,
      input.role,
      input.wakeReason,
      input.startedAtIso,
      input.initialEventId,
      input.cwd,
      input.promptText,
      input.parts,
      input.externalSessionId,
      input.toolset,
      input.recall,
      input.delegation,
      input.errorPosition,
      ac.signal,
    ).finally(() => {
      this.runJobByRun.delete(input.runId);
    });
    this.runJobByRun.set(input.runId, job);
    void job;
  }

  private emitOutputChunk(
    sessionId: string,
    runId: string,
    executionId: string,
    output: string,
    isStreaming: boolean,
  ): void {
    this.collaboration.emitSession(sessionId, {
      type: 'agent.output_chunk',
      eventId: 0,
      sessionId,
      runId,
      actor: { type: 'agent', id: runId },
      timestamp: new Date().toISOString(),
      payload: {
        agentRunId: runId,
        executionId,
        output,
        isStreaming,
      },
    });
  }

  private startExecutionRun(input: {
    sessionId: string;
    executionId: string;
    runId: string;
    ownerNodeId: string;
    triggerNodeId?: string | null;
    stepNodeId?: string | null;
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
    fallbackChain?: AgentRunFallbackEntry[];
    fallbackIndex?: number;
    fallbackTag?: string;
  }): void {
    if (this.supervisor) {
      void this.supervisor.queueAgentRun({
        mode: 'execution',
        sessionId: input.sessionId,
        runId: input.runId,
        executionId: input.executionId,
        rootNodeId: input.ownerNodeId,
        ownerNodeId: input.ownerNodeId,
        triggerNodeId: input.triggerNodeId ?? undefined,
        stepNodeId: input.stepNodeId ?? undefined,
        type: input.type,
        model: input.model,
        seedNodeIds: input.seedNodeIds,
        role: input.role,
        wakeReason: input.wakeReason,
        startedAtIso: input.startedAtIso,
        cwd: input.cwd,
        promptText: input.promptText,
        parts: input.parts,
        externalSessionId: input.externalSessionId,
        toolset: input.toolset,
        recall: input.recall,
        delegation: input.delegation,
        requestId: input.requestId,
        fallbackChain: input.fallbackChain,
        fallbackIndex: input.fallbackIndex,
        fallbackTag: input.fallbackTag,
      });
      return;
    }
    const ac = new AbortController();
    this.abortByRun.set(input.runId, ac);
    const job = this.runExecutionLoop(
      input.sessionId,
      input.executionId,
      input.runId,
      input.ownerNodeId,
      input.triggerNodeId ?? null,
      input.stepNodeId ?? null,
      input.type,
      input.model,
      input.seedNodeIds,
      input.role,
      input.wakeReason,
      input.startedAtIso,
      input.cwd,
      input.promptText,
      input.parts,
      input.externalSessionId,
      input.toolset,
      input.recall,
      input.delegation,
      input.requestId,
      ac.signal,
    ).finally(() => {
      this.runJobByRun.delete(input.runId);
    });
    this.runJobByRun.set(input.runId, job);
    void job;
  }

  private async runExecutionLoop(
    sessionId: string,
    executionId: string,
    runId: string,
    ownerNodeId: string,
    triggerNodeId: string | null,
    stepNodeId: string | null,
    type: AgentType,
    model: AgentModelRef | undefined,
    seedNodeIds: string[],
    role: string,
    wakeReason: WakeReason,
    startedAtIso: string,
    cwd: string,
    promptText: string,
    parts: AgentPromptPart[],
    externalSessionId: string | undefined,
    toolset: AgentToolsetId | undefined,
    recall: AgentKernelRecallEntry[] | undefined,
    delegation: AgentDelegationContext | undefined,
    requestId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await runExecutionStream(this.streamDeps(), {
        sessionId,
        executionId,
        runId,
        ownerNodeId,
        triggerNodeId,
        stepNodeId,
        type,
        model,
        seedNodeIds,
        role,
        wakeReason,
        startedAtIso,
        cwd,
        promptText,
        parts,
        externalSessionId,
        toolset,
        recall,
        delegation,
        requestId,
        signal,
      });
    } finally {
      this.abortByRun.delete(runId);
    }
  }

  async runWorkflow(
    sessionId: string,
    body: unknown,
    files: WorkflowRunFile[] = [],
  ): Promise<WorkflowRunResult> {
    const request = parseWorkflowRunBody(body);
    await this.ensureAdapterAvailable(request.type);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    const snapshot = await this.graph.loadSnapshot(sessionId);
    assertDirectWorkflowRunAllowed(snapshot, {
      triggerNodeId: request.triggerNodeId ?? null,
    });
    const stepNode = findConnectedStepNode(snapshot, request.triggerNodeId ?? null);
    const activeExecution =
      !request.newExecution && request.triggerNodeId
        ? await findActiveExecution(this.prisma, sessionId, request.triggerNodeId, stepNode?.id ?? null)
        : null;
    if (activeExecution?.currentRunId || activeExecution?.latestRunId) {
      const agentRunId = activeExecution.currentRunId ?? activeExecution.latestRunId;
      if (agentRunId) {
        return workflowRunResultSchema.parse({
          executionId: activeExecution.id,
          agentRunId,
          rootNodeId: stepNode?.id ?? request.triggerNodeId ?? agentRunId,
          status: activeExecution.status,
          wakeReason: activeExecution.wakeReason,
          triggerNodeId: request.triggerNodeId ?? undefined,
          stepNodeId: stepNode?.id,
          boundNodeIds: [],
        });
      }
    }
    const executionId = randomUUID();
    const runId = randomUUID();
    const cwd = this.resolveWorkingDirectory(session, request.workingDirectory);
    await fs.mkdir(cwd, { recursive: true });
    const bound = await materializeWorkflowInputs(this.workflowInputDeps(), {
      sessionId,
      cwd,
      executionId,
      snapshot,
      runId,
      request,
      files,
    });
    const seedNodeIds = uniqIds([
      ...this.resolveWorkflowSeedNodeIds(snapshot, request.triggerNodeId ?? null),
      ...bound.map((item) => item.nodeId),
      ...bound.flatMap((item) => item.workspaceFileNodeIds),
    ]);
    assertDirectWorkflowRunAllowed(snapshot, {
      triggerNodeId: request.triggerNodeId ?? null,
      seedNodeIds,
    });
    if (seedNodeIds.length === 0) {
      throw new BadRequestException('WORKFLOW_RUN_NO_CONTEXT');
    }

    const res = await this.createSpawn(
      session,
      {
        requestId: request.requestId,
        type: request.type,
        role: request.role ?? 'builder',
        runtime: {
          kind: 'local_process',
          cwd,
        },
        workingDirectory: cwd,
        triggerNodeId: request.triggerNodeId ?? null,
        wakeReason: request.wakeReason ?? 'external_event',
        seedNodeIds,
        model: request.model,
        newExecution: request.newExecution,
      },
      { runId, executionId, stepNodeId: stepNode?.id ?? null },
    );
    return workflowRunResultSchema.parse({
      executionId,
      ...res.data,
      triggerNodeId: request.triggerNodeId ?? undefined,
      stepNodeId: stepNode?.id,
      boundNodeIds: bound.map((item) => item.nodeId),
    });
  }

  async startInputNode(
    sessionId: string,
    nodeId: string,
    body: unknown,
    files: WorkflowRunFile[] = [],
  ): Promise<InputNodeStartResult> {
    const request = parseInputNodeStartBody(body);
    await this.ensureAdapterAvailable(request.type);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    const snapshot = await this.graph.loadSnapshot(sessionId);
    const target = findInputTemplate(snapshot, nodeId);
    const stepNode = findConnectedStepNode(snapshot, nodeId);
    const activeExecution =
      !request.newExecution
        ? await findActiveExecution(this.prisma, sessionId, nodeId, stepNode?.id ?? null)
        : null;
    if (activeExecution?.currentRunId || activeExecution?.latestRunId) {
      const agentRunId = activeExecution.currentRunId ?? activeExecution.latestRunId;
      if (agentRunId) {
        return inputNodeStartResultSchema.parse({
          executionId: activeExecution.id,
          agentRunId,
          rootNodeId: stepNode?.id ?? nodeId,
          status: activeExecution.status,
          wakeReason: activeExecution.wakeReason,
          triggerNodeId: nodeId,
          stepNodeId: stepNode?.id,
          boundNodeIds: [],
          targetNodeId: nodeId,
          reusedBoundNodeIds: [],
        });
      }
    }
    const latestExecution =
      !request.newExecution
        ? await findLatestExecution(this.prisma, sessionId, nodeId, stepNode?.id ?? null)
        : null;
    const component = new Set(collectConnectedNodeIds(nodeId, snapshot.edges));
    const templates = componentWorkflowInputTemplates(snapshot, component);
    const filesByField = buildWorkflowFileMap(files);
    const executionId = randomUUID();
    const runId = randomUUID();
    const cwd = this.resolveWorkingDirectory(session, request.workingDirectory);
    const wakeReason = request.wakeReason ?? 'external_event';
    await fs.mkdir(cwd, { recursive: true });
    let created: WorkflowBoundInput | null = null;
    let nextIndex = 0;
    if (request.input) {
      created = await createWorkflowBoundInput(this.workflowInputDeps(), {
        sessionId,
        cwd,
        executionId,
        runId,
        requestId: request.requestId,
        wakeReason,
        key: target.key,
        value: request.input,
        triggerNode: target.node,
        templates: [target],
        filesByField,
        index: nextIndex,
        reason: 'input-start',
      });
      nextIndex += 1;
    } else if ((request.sourceNodeIds?.length ?? 0) > 0) {
      created = await createWorkflowBoundInputFromSources(this.workflowInputDeps(), {
        sessionId,
        cwd,
        executionId,
        runId,
        requestId: request.requestId,
        wakeReason,
        snapshot,
        template: target,
        sourceNodeIds: request.sourceNodeIds,
        index: nextIndex,
        reason: 'input-start',
      });
      if (created) {
        nextIndex += 1;
      }
    }
    const createdBoundNodeIds = created ? [created.nodeId] : [];

    const reusedBoundNodeIds: string[] = [];
    const selectedBoundNodeIds: string[] = [];
    for (const template of templates) {
      if (created && template.node.id === target.node.id) {
        selectedBoundNodeIds.push(created.nodeId);
        continue;
      }
      const latest =
        findLatestWorkflowBound(snapshot, template.node.id, latestExecution?.id ?? null) ??
        (latestExecution?.id ? findLatestWorkflowBound(snapshot, template.node.id, null) : null);
      if (!latest) {
        const inferred = await createWorkflowBoundInputFromSources(this.workflowInputDeps(), {
          sessionId,
          cwd,
          executionId,
          runId,
          requestId: request.requestId,
          wakeReason,
          snapshot,
          template,
          index: nextIndex,
          reason: 'input-start',
        });
        if (inferred) {
          if (template.node.id === target.node.id) {
            created = inferred;
          }
          createdBoundNodeIds.push(inferred.nodeId);
          selectedBoundNodeIds.push(inferred.nodeId);
          nextIndex += 1;
          continue;
        }
        if (template.content.required) {
          throw new BadRequestException(`WORKFLOW_INPUT_REQUIRED:${template.key}`);
        }
        continue;
      }
      reusedBoundNodeIds.push(latest.node.id);
      selectedBoundNodeIds.push(latest.node.id);
    }

    assertNoUnusedWorkflowFiles(filesByField);

    const seedNodeIds = uniqIds([
      ...componentWorkflowSeedNodeIds(snapshot, nodeId),
      ...selectedBoundNodeIds,
      ...(created?.workspaceFileNodeIds ?? []),
    ]);
    if (seedNodeIds.length === 0) {
      throw new BadRequestException('WORKFLOW_RUN_NO_CONTEXT');
    }

    const res = await this.createSpawn(
      session,
      {
        requestId: request.requestId,
        type: request.type,
        role: request.role ?? 'builder',
        runtime: {
          kind: 'local_process',
          cwd,
        },
        workingDirectory: cwd,
        triggerNodeId: nodeId,
          wakeReason,
        seedNodeIds,
        model: request.model,
        newExecution: request.newExecution,
      },
      { runId, executionId, stepNodeId: stepNode?.id ?? null },
    );
    return inputNodeStartResultSchema.parse({
      executionId,
      ...res.data,
      boundNodeIds: createdBoundNodeIds,
      triggerNodeId: nodeId,
      stepNodeId: stepNode?.id,
      targetNodeId: nodeId,
      createdBoundNodeId: created?.nodeId,
      reusedBoundNodeIds,
    });
  }

  async spawn(
    sessionId: string,
    body: AgentSpawnInput,
    input: {
      runId?: string;
      executionId?: string;
      stepNodeId?: string | null;
      retryOfRunId?: string | null;
      selection?: { type: AgentType; model?: AgentModelRef };
      allowLoopChildRun?: boolean;
    } = {},
  ) {
    await this.ensureAdapterAvailable(body.type);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    if (!body.parentExecutionId && !input.allowLoopChildRun) {
      const snapshot = await this.graph.loadSnapshot(sessionId);
      assertDirectWorkflowRunAllowed(snapshot, {
        triggerNodeId: body.triggerNodeId ?? null,
        seedNodeIds: body.seedNodeIds,
        allowLoopChildRun: input.allowLoopChildRun,
      });
    }

    if (body.requestId) {
      const existing = await this.findExistingSpawn(sessionId, body.requestId);
      if (existing) return existing;

      const key = this.spawnRequestKey(sessionId, body.requestId);
      const inFlight = this.inFlightSpawnByRequestId.get(key);
      if (inFlight) return inFlight;

      const promise = this.createSpawn(session, body, input).finally(() => {
        this.inFlightSpawnByRequestId.delete(key);
      });
      this.inFlightSpawnByRequestId.set(key, promise);
      return promise;
    }

    return this.createSpawn(session, body, input);
  }

  async rerun(
    sessionId: string,
    agentRunId: string,
    body: AgentRerunRequest = {},
    input: {
      runId?: string;
    } = {},
  ) {
    const key = this.rerunKey(sessionId, agentRunId);
    const inFlight = this.inFlightRerunByRunId.get(key);
    if (inFlight) {
      return inFlight;
    }
    const promise = this.restartRun(sessionId, agentRunId, body, input).finally(() => {
      this.inFlightRerunByRunId.delete(key);
    });
    this.inFlightRerunByRunId.set(key, promise);
    return promise;
  }

  private async createSpawn(
    session: {
      id: string;
      workspaceParentDirectory: string | null;
      workspaceDirectoryName: string | null;
    },
    body: AgentSpawnInput,
    input: {
      runId?: string;
      executionId?: string;
      stepNodeId?: string | null;
      retryOfRunId?: string | null;
      selection?: { type: AgentType; model?: AgentModelRef };
    } = {},
  ): Promise<SpawnResponse> {
    const cwd = this.resolveWorkingDirectory(
      session,
      body.workingDirectory,
      body.runtime.kind === 'local_process' ? body.runtime.cwd : undefined,
    );
    await fs.mkdir(cwd, { recursive: true });

    const snapshot = await this.graph.loadSnapshot(session.id);
    const triggerNode = body.triggerNodeId
      ? snapshot.nodes.find((node) => node.id === body.triggerNodeId) ?? null
      : null;
    const stepNode =
      (input.stepNodeId
        ? snapshot.nodes.find((node) => node.id === input.stepNodeId) ?? null
        : null) ?? findConnectedStepNode(snapshot, body.triggerNodeId ?? null);
    const selection =
      input.selection ??
      resolveNodeSelection(snapshot, body.triggerNodeId ?? stepNode?.id ?? null, {
        type: body.type,
        ...(body.model ? { model: body.model } : {}),
      }) ??
      body;
    await this.ensureAdapterAvailable(selection.type);
    const fallbackTag =
      'fallbackTag' in selection && typeof selection.fallbackTag === 'string'
        ? selection.fallbackTag
        : undefined;
    const fallback = await this.resolveRunFallback({
      agentType: selection.type,
      model: selection.model,
      fallbackTag,
    });
    const resolvedModel = fallback.selected ?? selection.model;
    const activeExecution =
      !body.newExecution && !input.executionId && !input.retryOfRunId
        ? await findActiveExecution(
            this.prisma,
            session.id,
            triggerNode?.id ?? null,
            stepNode?.id ?? null,
            body.parentExecutionId ?? null,
          )
        : null;
    if (activeExecution?.currentRunId || activeExecution?.latestRunId) {
      const agentRunId = activeExecution.currentRunId ?? activeExecution.latestRunId;
      if (agentRunId) {
        return ok({
          agentRunId,
          rootNodeId: stepNode?.id ?? triggerNode?.id ?? agentRunId,
          status: activeExecution.status as AgentRun['status'],
          wakeReason: activeExecution.wakeReason as WakeReason,
        });
      }
    }
    const runId = input.runId ?? randomUUID();
    const kernel = await this.readKernel(
      session.id,
      body.role,
      body.seedNodeIds,
      runId,
      body.parentRunId,
    );
    const promptText = this.buildPrompt(
      snapshot.nodes,
      body.seedNodeIds,
      runId,
      body.managedContract,
      kernel,
    );
    const parts = await this.buildPromptParts(selection.type, cwd, session.id, snapshot.nodes, body.seedNodeIds, promptText);
    this.assertPromptPartsSupported(selection.type, parts);
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    const runtime =
      body.runtime.kind === 'local_process'
        ? ({ kind: 'local_process', cwd } as AgentRuntime)
        : body.runtime;
    let execution =
      (input.executionId
        ? await this.prisma.workflowExecution.findUnique({ where: { id: input.executionId } })
        : null) ?? activeExecution;
    if (!execution) {
      execution = await createWorkflowExecution(this.prisma, {
        sessionId: session.id,
        executionId: input.executionId,
        parentExecutionId: body.parentExecutionId,
        triggerNodeId: triggerNode?.id ?? null,
        stepNodeId: stepNode?.id ?? null,
        requestId: body.requestId,
        type: selection.type,
        role: body.role,
        wakeReason: body.wakeReason,
        runtime,
        seedNodeIds: body.seedNodeIds,
        startedAt,
        model: resolvedModel,
      });
    }
    const ownerNodeId = stepNode?.id ?? triggerNode?.id ?? body.seedNodeIds[0] ?? runId;
    await this.prisma.agentRun.create({
      data: {
        id: runId,
        sessionId: session.id,
        executionId: execution.id,
        requestId: body.requestId,
        agentType: selection.type,
        role: body.role,
        status: 'booting',
        wakeReason: body.wakeReason,
        runtime: runtime as object,
        startedAt,
        seedNodeIds: body.seedNodeIds,
        rootNodeId: ownerNodeId,
        triggerNodeId: triggerNode?.id ?? null,
        stepNodeId: stepNode?.id ?? null,
        retryOfRunId: input.retryOfRunId ?? null,
        parentRunId: body.parentRunId ?? null,
        modelProviderId: resolvedModel?.providerID,
        modelId: resolvedModel?.modelID,
        outputText: '',
        isStreaming: true,
      },
    });

    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        currentRunId: runId,
        latestRunId: runId,
        requestId: body.requestId ?? null,
        agentType: selection.type,
        role: body.role,
        status: 'booting',
        wakeReason: body.wakeReason,
        runtime: runtime as object,
        seedNodeIds: body.seedNodeIds,
        startedAt,
        endedAt: null,
        modelProviderId: resolvedModel?.providerID ?? null,
        modelId: resolvedModel?.modelID ?? null,
      },
    });

    await this.artifacts.initializeRunArtifacts(session.id, execution.id, runId, ownerNodeId, cwd);
    try {
      await this.artifacts.captureRunStart(runId, cwd);
    } catch {
      // Keep the run alive even if artifact diffing cannot snapshot the workspace.
    }

    const runRow = this.buildBootingRun({
      runId,
      sessionId: session.id,
      executionId: execution.id,
      requestId: body.requestId,
      parentRunId: body.parentRunId,
      type: selection.type,
      role: body.role,
      wakeReason: body.wakeReason,
      startedAt: startedAtIso,
      seedNodeIds: body.seedNodeIds,
      rootNodeId: ownerNodeId,
      triggerNodeId: triggerNode?.id ?? null,
      stepNodeId: stepNode?.id ?? null,
      cwd,
      model: resolvedModel,
    });

    this.collaboration.emitSession(session.id, {
      type: 'agent.spawned',
      eventId: 0,
      sessionId: session.id,
      actor: { type: 'agent', id: runId },
      timestamp: new Date().toISOString(),
      payload: runRow,
    });

    this.startExecutionRun({
      sessionId: session.id,
      executionId: execution.id,
      runId,
      ownerNodeId,
      triggerNodeId: triggerNode?.id ?? null,
      stepNodeId: stepNode?.id ?? null,
      type: selection.type,
      model: resolvedModel,
      seedNodeIds: body.seedNodeIds,
      role: body.role,
      wakeReason: body.wakeReason,
      startedAtIso,
      cwd,
      promptText,
      parts,
      toolset: kernel.toolset,
      recall: kernel.recall,
      delegation: kernel.delegation,
      requestId: body.requestId,
      fallbackChain: fallback.chain.length > 0 ? fallback.chain : undefined,
      fallbackIndex: fallback.chain.length > 0 ? fallback.index : undefined,
      fallbackTag,
    });

    return ok({
      agentRunId: runId,
      rootNodeId: ownerNodeId,
      status: 'booting',
      wakeReason: body.wakeReason,
    });
  }

  private async restartRun(
    sessionId: string,
    agentRunId: string,
    body: AgentRerunRequest,
    input: {
      runId?: string;
    } = {},
  ): Promise<SpawnResponse> {
    const state = await this.loadRunState(sessionId, agentRunId);
    const selection = resolveRerunSelection(body, state);
    await this.ensureAdapterAvailable(selection.type);

    if (ACTIVE_RUN_STATUSES.has(state.run.status as AgentRun['status'])) {
      await this.waitForRunStop(agentRunId);
    }

    const hasExecutionModel = Boolean(state.run.executionId || state.run.triggerNodeId || state.run.stepNodeId);
    if (hasExecutionModel) {
      const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }
      const runId = input.runId ?? randomUUID();
      const executionId = body.newExecution ? randomUUID() : state.run.executionId ?? randomUUID();
      const triggerNodeId = state.run.triggerNodeId ?? state.triggerNode?.id ?? null;
      const stepNodeId =
        state.run.stepNodeId ??
        findConnectedStepNode(state.snapshot, triggerNodeId)?.id ??
        null;
      return this.createSpawn(
        session,
        {
          requestId: body.requestId,
          type: selection.type,
          role: state.run.role,
          runtime: {
            kind: 'local_process',
            cwd: state.cwd,
          },
          workingDirectory: state.cwd,
          triggerNodeId: triggerNodeId ?? undefined,
          wakeReason: 'manual',
          seedNodeIds: state.seedNodeIds,
          model: selection.model,
          newExecution: body.newExecution,
        },
        {
          runId,
          executionId,
          stepNodeId,
          retryOfRunId: agentRunId,
          selection,
        },
      );
    }

    if (!state.outputNode) {
      throw new NotFoundException('RUN_OUTPUT_NODE_NOT_FOUND');
    }

    const kernel = await this.readKernel(
      sessionId,
      state.run.role,
      state.seedNodeIds,
      agentRunId,
      state.run.parentRunId,
    );
    const promptText = this.buildPrompt(
      state.snapshot.nodes,
      state.seedNodeIds,
      agentRunId,
      undefined,
      kernel,
    );
    const parts = await this.buildPromptParts(
      selection.type,
      state.cwd,
      sessionId,
      state.snapshot.nodes,
      state.seedNodeIds,
      promptText,
    );
    this.assertPromptPartsSupported(selection.type, parts);

    let lastEventId = await clearRunMessages(this.graph, sessionId, agentRunId);
    await this.runtime.clearAgentRun(sessionId, agentRunId);

    const rootEnv = await this.graph.patchNode(
      sessionId,
      state.rootNode.id,
      {
        content: this.buildRootContent({
          rootNode: state.rootNode,
          type: selection.type,
          model: selection.model,
          seedNodeIds: state.seedNodeIds,
          cwd: state.cwd,
          triggerNodeId: state.triggerNode?.id ?? null,
        }),
        status: 'active',
      },
      this.agentCreator(agentRunId, selection.type),
    );
    lastEventId = rootEnv.eventId;

    const outputEnv = await this.graph.patchNode(
      sessionId,
      state.outputNode.id,
      {
        content: {
          output: '',
          outputType: 'stdout',
          isStreaming: true,
        } as never,
        status: 'active',
      },
      this.agentCreator(agentRunId, selection.type),
    );
    lastEventId = outputEnv.eventId;

    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    const wakeReason: WakeReason = 'manual';

    await this.prisma.agentRun.update({
      where: { id: agentRunId },
      data: {
        agentType: selection.type,
        status: 'booting',
        wakeReason,
        runtime: {
          kind: 'local_process',
          cwd: state.cwd,
        } as object,
        startedAt,
        endedAt: null,
        seedNodeIds: state.seedNodeIds,
        modelProviderId: selection.model?.providerID ?? null,
        modelId: selection.model?.modelID ?? null,
        externalSessionId: null,
      },
    });

    this.emitAgentStatus(
      sessionId,
      agentRunId,
      lastEventId,
      this.buildBootingRun({
        runId: agentRunId,
        sessionId,
        type: selection.type,
        role: state.run.role,
        wakeReason,
        startedAt: startedAtIso,
        seedNodeIds: state.seedNodeIds,
        rootNodeId: state.rootNode.id,
        cwd: state.cwd,
        model: selection.model,
        externalSessionId: state.run.externalSessionId ?? undefined,
      }),
    );

    await this.artifacts.initializeRunArtifacts(sessionId, undefined, agentRunId, state.outputNode.id, state.cwd);
    try {
      await this.artifacts.captureRunStart(agentRunId, state.cwd);
    } catch {
      // Keep the rerun alive even if artifact diffing cannot snapshot the workspace.
    }

    this.startRun({
      sessionId,
      runId: agentRunId,
      rootNodeId: state.rootNode.id,
      outputNodeId: state.outputNode.id,
      type: selection.type,
      model: selection.model,
      seedNodeIds: state.seedNodeIds,
      role: state.run.role,
      wakeReason,
      startedAtIso,
      initialEventId: lastEventId,
      cwd: state.cwd,
      promptText,
      parts,
      externalSessionId: state.run.externalSessionId ?? undefined,
      toolset: kernel.toolset,
      recall: kernel.recall,
      delegation: kernel.delegation,
      errorPosition: state.errorPosition,
    });

    return ok({
      agentRunId,
      rootNodeId: state.rootNode.id,
      status: 'booting',
      wakeReason,
    });
  }

  private async runLoop(
    sessionId: string,
    runId: string,
    rootNodeId: string,
    outputNodeId: string,
    type: AgentType,
    model: AgentModelRef | undefined,
    seedNodeIds: string[],
    role: string,
    wakeReason: WakeReason,
    startedAtIso: string,
    initialEventId: number,
    cwd: string,
    promptText: string,
    parts: AgentPromptPart[],
    externalSessionId: string | undefined,
    toolset: AgentToolsetId | undefined,
    recall: AgentKernelRecallEntry[] | undefined,
    delegation: AgentDelegationContext | undefined,
    errorPosition: GraphNode['position'],
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await runGraphStream(this.streamDeps(), {
        sessionId,
        runId,
        rootNodeId,
        outputNodeId,
        type,
        model,
        seedNodeIds,
        role,
        wakeReason,
        startedAtIso,
        initialEventId,
        cwd,
        promptText,
        parts,
        externalSessionId,
        toolset,
        recall,
        delegation,
        errorPosition,
        signal,
      });
    } finally {
      this.abortByRun.delete(runId);
    }
  }

  async stop(sessionId: string, agentRunId: string) {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: agentRunId, sessionId },
    });
    if (!run) throw new NotFoundException('RUN_NOT_FOUND');
    const ac = this.abortByRun.get(agentRunId);
    ac?.abort();
    await this.prisma.agentRun.update({
      where: { id: agentRunId },
      data: { status: 'cancelled', endedAt: new Date(), isStreaming: false },
    });
    return ok({ stopped: true });
  }
}
