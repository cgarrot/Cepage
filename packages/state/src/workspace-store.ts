import { DEFAULT_LOCALE, detectLocaleFromNav, type Locale } from '@cepage/i18n';
import {
  applyThemeToDocument,
  cepageForEffectiveMode,
  CEPAGE_DEFAULTS,
  DEFAULT_THEME_CEPAGE,
  DEFAULT_THEME_MODE,
  resolveEffectiveThemeMode,
  type ThemeCepage,
  type ThemeMode,
} from './theme';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Edge, Node } from '@xyflow/react';
import type {
  AgentCatalog,
  AgentRun,
  NodeAgentSelection,
  Branch,
  GraphEdge,
  GraphNode,
  SessionWorkspace,
  WorkflowControllerState,
  WorkflowManagedFlowState,
  WorkflowExecution,
  WorkflowCopilotLiveMessagePayload,
  WorkflowCopilotThread,
  WorkflowRunInputValue,
} from '@cepage/shared-core';
import {
  applyNodeAgentSelection,
  formatAgentSelectionLabel,
  parseWorkflowTransfer,
  readFileSummaryContent,
  readWorkflowInputContent,
} from '@cepage/shared-core';
import {
  applyWorkflowCopilotMessage as apiApplyWorkflowCopilotMessage,
  connectSessionSocket,
  ensureWorkflowCopilotThread as apiEnsureWorkflowCopilotThread,
  getAgentCatalog,
  getWorkflowCopilotThread as apiGetWorkflowCopilotThread,
  chooseSessionWorkspaceParentDirectory,
  createEdge,
  createBranch as apiCreateBranch,
  createNode as apiCreateNode,
  createSession,
  getTimeline,
  mergeBranch as apiMergeBranch,
  deleteEdge as apiDeleteEdge,
  deleteNode as apiDeleteNode,
  exportWorkflow as apiExportWorkflow,
  getGraphBundle,
  openSessionWorkspaceDirectory as apiOpenSessionWorkspaceDirectory,
  patchWorkflowCopilotThread as apiPatchWorkflowCopilotThread,
  importWorkflowReplace as apiImportWorkflow,
  patchNode,
  rerunAgent,
  restoreWorkflowCopilotCheckpoint as apiRestoreWorkflowCopilotCheckpoint,
  sendWorkflowCopilotMessage as apiSendWorkflowCopilotMessage,
  runWorkflowFlow as apiRunWorkflowFlow,
  runWorkflowController as apiRunWorkflowController,
  cancelWorkflowFlow as apiCancelWorkflowFlow,
  startInputNode as apiStartInputNode,
  stopWorkflowCopilotThread as apiStopWorkflowCopilotThread,
  summarizeFileNode as apiSummarizeFileNode,
  spawnAgent,
  abandonBranch as apiAbandonBranch,
  uploadFileNodeFiles as apiUploadFileNodeFiles,
  updateSessionWorkspace,
} from '@cepage/client-api';
import { statusFromApiErr, statusFromThrown } from './api-error';
import { copyTextToClipboard } from './clipboard';
import { buildSpawnRequestId, collectConnectedNodeIds } from './graph-context';
import {
  deriveActiveControllers,
  deriveActiveRuns,
  indexControllers,
  upsertController,
} from './live';
import {
  deriveActiveManagedFlows,
  indexManagedFlows,
  upsertManagedFlow,
} from './workflow-managed-flow';
import { deriveLiveRuns } from './live-runs';
import { createInputStartStateCache } from './input-start-cache.js';
import { mergeTimelineHead, mergeTimelinePage } from './timeline';
import {
  createPendingWorkflowCopilotSend,
  dropPendingWorkflowCopilotSend,
  mergeWorkflowCopilotMessages,
  settlePendingWorkflowCopilotSend,
} from './workflow-copilot-state';
import {
  planControllerLaunch,
  planLoopRun,
  planManagedFlowLaunch,
  planNodeRun,
  readNodeSelection,
  resolveNodeSelection,
} from './workspace-run';
import { toFlowNode as mapFlowNode } from './workspace-flow';
import { buildCreateNodeContent, getDefaultCreatePosition } from './workspace-node-create';
import {
  evaluateInputTemplateStartState,
  type InputTemplateStartState,
} from './workflow-input-start';
import { writeWorkflowCopilotDraft } from './workflow-copilot-draft';
import type { AgentRunSelection } from './workspace-agent-selection';
import {
  normalizeSelection,
  resolveSelection,
  selectionFromThread,
} from './workspace-agent-selection';
import {
  clearWorkflowCopilot,
  mergeCopilotMessage,
  mergeCopilotThread,
  mergeResyncedCopilot,
  syncWorkflowCopilot,
} from './workspace-copilot-sync';
import {
  applyDocLang,
  mergePersistedWorkspaceState,
  noopStorage,
  onWorkspaceRehydrate,
  partializeWorkspaceState,
} from './workspace-persist';
import type {
  AgentRunIndex,
  InputStartOptions,
  PendingSpawn,
  WorkflowExecutionIndex,
  WorkspaceState,
} from './workspace-store-types';
import {
  CHAT_TAB_ID,
  closeFileTab,
  openFileTab,
  setActiveTab,
  type WorkspaceTabsBySession,
} from './workspace-tabs';
import type { ActivityLine, LiveRunDescriptor } from './workspace-types';

export type { ActivityLine, LiveRunDescriptor, StatusDescriptor } from './workspace-types';
export type { AgentRunSelection } from './workspace-agent-selection';
export type { InputStartOptions, WorkspaceState } from './workspace-store-types';

const MAX_ACTIVITY = 80;
const BRANCH_COLORS = ['#ff8a65', '#ffd54f', '#4db6ac', '#64b5f6', '#ba68c8', '#f06292'] as const;

function replaceSessionQuery(sessionId: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set('session', sessionId);
  } else {
    url.searchParams.delete('session');
  }
  window.history.replaceState({}, '', url);
}

function workflowFileName(sessionId: string): string {
  return `workflow-${sessionId}.json`;
}

function downloadJson(name: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toFlowNode(n: GraphNode): Node {
  return mapFlowNode(n) as Node;
}

function toFlowEdge(e: GraphEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.relation,
  };
}

function readRawFlowNode(node: Node): GraphNode {
  return (node.data as { raw: GraphNode }).raw;
}

function toGraphEdgeLinks(edges: readonly Edge[]): Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> {
  return edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    relation: (typeof edge.label === 'string' ? edge.label : 'references') as GraphEdge['relation'],
  }));
}

function mergeNodePatch(raw: GraphNode, patch: Partial<GraphNode>): GraphNode {
  const next: GraphNode = {
    ...raw,
    ...patch,
    position: patch.position ?? raw.position,
    dimensions: patch.dimensions ?? raw.dimensions,
    content:
      patch.content !== undefined
        ? { ...raw.content, ...patch.content }
        : raw.content,
    metadata:
      patch.metadata !== undefined
        ? { ...raw.metadata, ...patch.metadata }
        : raw.metadata,
    branches: patch.branches ?? raw.branches,
  };
  return next;
}

function readActivity(msg: {
  timestamp?: string;
  runId?: string;
  wakeReason?: string;
  requestId?: string;
  workerId?: string;
  worktreeId?: string;
  actor?: { type?: string; id?: string };
  payload: {
    id: string;
    summary: string;
    summaryKey?: string;
    summaryParams?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    relatedNodeIds?: string[];
  };
}): ActivityLine {
  return {
    id: msg.payload.id,
    timestamp: msg.timestamp ?? new Date().toISOString(),
    actorType: (msg.actor?.type as ActivityLine['actorType']) ?? 'system',
    actorId: msg.actor?.id ?? 'system',
    runId: msg.runId,
    wakeReason: msg.wakeReason,
    requestId: msg.requestId,
    workerId: msg.workerId,
    worktreeId: msg.worktreeId,
    summary: msg.payload.summary,
    summaryKey: msg.payload.summaryKey,
    summaryParams: msg.payload.summaryParams,
    metadata: msg.payload.metadata,
    relatedNodeIds: msg.payload.relatedNodeIds,
  };
}

function nextBranchName(rows: readonly Branch[]): string {
  let n = rows.length + 1;
  let name = `Branch ${n}`;
  const seen = new Set(rows.map((row) => row.name));
  while (seen.has(name)) {
    n += 1;
    name = `Branch ${n}`;
  }
  return name;
}

function nextBranchColor(rows: readonly Branch[]): string {
  return BRANCH_COLORS[rows.length % BRANCH_COLORS.length];
}

function trim(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function buildInlineInputValue(text: string | undefined): WorkflowRunInputValue | undefined {
  const value = trim(text);
  if (!value) {
    return undefined;
  }
  return {
    parts: [{ type: 'text', text: value }],
  };
}

function readInputSourceNodeIds(
  state: InputTemplateStartState,
  options: InputStartOptions | undefined,
): string[] {
  const target = state.target;
  if (!target) {
    return [];
  }
  const explicit = uniqIds(options?.sourceNodeIds ?? []).filter((nodeId) =>
    target.candidates.some((candidate) => candidate.sourceNodeId === nodeId),
  );
  if (explicit.length > 0) {
    return explicit;
  }
  if (target.bound || target.candidates.length !== 1) {
    return [];
  }
  const candidate = target.candidates[0];
  return candidate ? [candidate.sourceNodeId] : [];
}

function buildNodeTextContent(raw: GraphNode, text: string): GraphNode['content'] {
  if (raw.type === 'agent_output') {
    return {
      ...raw.content,
      output: text,
      outputType: (raw.content as { outputType?: string }).outputType ?? 'stdout',
      isStreaming: false,
    };
  }

  if (raw.type === 'agent_status') {
    return { ...raw.content, message: text };
  }

  if (raw.type === 'file_summary') {
    const content = readFileSummaryContent(raw.content);
    return {
      ...(content?.files ? { files: content.files.map((item) => ({ ...item, file: { ...item.file } })) } : {}),
      ...(content?.agentType ? { agentType: content.agentType } : {}),
      ...(content?.model ? { model: { ...content.model } } : {}),
      ...(content?.agentSelection ? { agentSelection: content.agentSelection } : {}),
      summary: text,
      summaryUpdatedAt: new Date().toISOString(),
      ...(content?.generatedSummary !== undefined ? { generatedSummary: content.generatedSummary } : {}),
      ...(content?.generatedSummaryUpdatedAt
        ? { generatedSummaryUpdatedAt: content.generatedSummaryUpdatedAt }
        : {}),
      summarySource: 'user',
      ...(content?.status ? { status: content.status } : {}),
      ...(content?.error ? { error: content.error } : {}),
    };
  }

  return { ...raw.content, text };
}

function patchNodeSelectionContent(raw: GraphNode, value: NodeAgentSelection): GraphNode['content'] {
  return applyNodeAgentSelection(raw.type, raw.content, value);
}

function indexRuns(runs: readonly AgentRun[]): AgentRunIndex {
  return Object.fromEntries(runs.map((run) => [run.id, run]));
}

function indexExecutions(executions: readonly WorkflowExecution[]): WorkflowExecutionIndex {
  return Object.fromEntries(executions.map((execution) => [execution.id, execution]));
}

function upsertExecutionFromRun(
  executions: WorkflowExecutionIndex,
  run: AgentRun,
): WorkflowExecutionIndex {
  if (!run.executionId) {
    return executions;
  }
  const prev = executions[run.executionId];
  return {
    ...executions,
    [run.executionId]: {
      id: run.executionId,
      sessionId: run.sessionId,
      ...(run.triggerNodeId ?? prev?.triggerNodeId ? { triggerNodeId: run.triggerNodeId ?? prev?.triggerNodeId } : {}),
      ...(run.stepNodeId ?? prev?.stepNodeId ? { stepNodeId: run.stepNodeId ?? prev?.stepNodeId } : {}),
      currentRunId: run.id,
      latestRunId: run.id,
      type: run.type,
      role: run.role,
      runtime: run.runtime,
      wakeReason: run.wakeReason,
      status: run.status,
      startedAt: prev?.startedAt ?? run.startedAt,
      ...(run.endedAt ? { endedAt: run.endedAt } : {}),
      createdAt: prev?.createdAt ?? run.startedAt,
      updatedAt: run.updatedAt ?? run.endedAt ?? run.startedAt,
      seedNodeIds: run.seedNodeIds,
      ...(run.model ? { model: run.model } : prev?.model ? { model: prev.model } : {}),
    },
  };
}

function toWorkspaceDraft(workspace: SessionWorkspace | null): {
  parentDirectory: string;
  directoryName: string;
} {
  return {
    parentDirectory: workspace?.parentDirectory ?? '',
    directoryName: workspace?.directoryName ?? '',
  };
}

function uniqIds(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function sameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a);
  return ids.size === b.length && b.every((id) => ids.has(id));
}

function pickSelected(
  ids: ReadonlyArray<string>,
  current: string | null,
  primary: string | null = null,
): string | null {
  if (ids.length === 0) return null;
  if (primary && ids.includes(primary)) return primary;
  if (current && ids.includes(current)) return current;
  return ids[0] ?? null;
}

function selectionPatch(
  state: Pick<WorkspaceState, 'selected' | 'selectedIds' | 'workflowCopilotContextAccepted'>,
  ids: ReadonlyArray<string>,
  primary: string | null = null,
): Partial<Pick<WorkspaceState, 'selected' | 'selectedIds' | 'workflowCopilotContextAccepted'>> {
  const nextIds = uniqIds(ids);
  const nextSelected = pickSelected(nextIds, state.selected, primary);
  if (sameIds(state.selectedIds, nextIds) && state.selected === nextSelected) {
    return {};
  }
  return {
    selected: nextSelected,
    selectedIds: nextIds,
    workflowCopilotContextAccepted: false,
  };
}

function deriveStoreLiveRuns(
  nodes: readonly Node[],
  edges: readonly Edge[],
  agentRuns: AgentRunIndex,
  workflowExecutions: WorkflowExecutionIndex,
  sessionWorkspace: SessionWorkspace | null,
): LiveRunDescriptor[] {
  return deriveLiveRuns(
    nodes.map(readRawFlowNode),
    toGraphEdgeLinks(edges),
    agentRuns,
    workflowExecutions,
    sessionWorkspace,
  );
}

function nextLiveRuns(state: WorkspaceState, patch: Partial<WorkspaceState>): LiveRunDescriptor[] {
  const sessionWorkspace = Object.prototype.hasOwnProperty.call(patch, 'sessionWorkspace')
    ? (patch.sessionWorkspace ?? null)
    : state.sessionWorkspace;
  return deriveStoreLiveRuns(
    patch.nodes ?? state.nodes,
    patch.edges ?? state.edges,
    patch.agentRuns ?? state.agentRuns,
    patch.workflowExecutions ?? state.workflowExecutions,
    sessionWorkspace,
  );
}

function withLiveRuns(state: WorkspaceState, patch: Partial<WorkspaceState>): Partial<WorkspaceState> {
  const liveRuns = nextLiveRuns(state, patch);
  return {
    ...patch,
    liveRuns,
    activeRuns: deriveActiveRuns(liveRuns),
    activeControllers: deriveActiveControllers(patch.workflowControllers ?? state.workflowControllers),
    activeFlows: deriveActiveManagedFlows(patch.workflowFlows ?? state.workflowFlows),
  };
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const openWorkspaceDialog = (pendingSpawn: PendingSpawn | null = null): void => {
        const draft = toWorkspaceDraft(get().sessionWorkspace);
        set({
          workspaceDialogOpen: true,
          workspaceParentDirectoryDraft: draft.parentDirectory,
          workspaceDirectoryNameDraft: draft.directoryName,
          pendingSpawn,
          status: pendingSpawn
            ? { key: 'status.choose_workspace_before_run' }
            : { key: 'status.configure_workspace' },
        });
      };

      const refreshAgentCatalog = async (): Promise<AgentCatalog['providers']> => {
        const sessionId = get().sessionId;
        if (!sessionId) {
          set({ status: { key: 'status.no_active_session' } });
          return [];
        }
        set({ agentCatalogLoading: true });
        try {
          const res = await getAgentCatalog(sessionId);
          if (!res.success) {
            set({ agentCatalogLoading: false, status: statusFromApiErr(res.error) });
            return get().agentCatalog;
          }
          const providers = res.data.providers ?? [];
          const nextSelection =
            providers.length > 0
              ? resolveSelection(providers, get().lastRunSelection, get().lastRunSelection)
              : get().lastRunSelection;
          set({
            agentCatalog: providers,
            agentCatalogLoading: false,
            lastRunSelection: nextSelection,
          });
          return providers;
        } catch (errorValue) {
          set({ agentCatalogLoading: false, status: statusFromThrown(errorValue) });
          return get().agentCatalog;
        }
      };

      const resyncCopilot = async (sessionId: string) => {
        const thread = get().workflowCopilotThread;
        if (!thread || thread.sessionId !== sessionId) {
          return;
        }
        try {
          const res = await apiGetWorkflowCopilotThread(sessionId, thread.id);
          if (!res.success) {
            set({ status: statusFromApiErr(res.error) });
            return;
          }
          set((s) => {
            const patch = mergeResyncedCopilot(s, res.data);
            return patch ?? {};
          });
        } catch (errorValue) {
          set({ status: statusFromThrown(errorValue) });
        }
      };

      const readConnectedStepSelection = (nodeId: string | null): AgentRunSelection | null => {
        const nodes = get().nodes.map(readRawFlowNode);
        return resolveNodeSelection(nodeId, nodes, toGraphEdgeLinks(get().edges));
      };

      const readConnectedLoopRun = (nodeId: string | null) => {
        const nodes = get().nodes.map(readRawFlowNode);
        return planLoopRun(nodeId, nodes, toGraphEdgeLinks(get().edges));
      };

      const readInputStartState = createInputStartStateCache();
      const getInputStartState = (nodeId: string): InputTemplateStartState | null =>
        readInputStartState(nodeId, get().nodes, get().edges);

      const startInputWithNode = async (
        nodeId: string,
        selection?: AgentRunSelection | null,
        options?: InputStartOptions,
      ): Promise<void> => {
        const sessionId = get().sessionId;
        if (!sessionId) {
          set({ status: { key: 'status.no_active_session' } });
          return;
        }

        const start = getInputStartState(nodeId);
        if (!start) {
          return;
        }
        const sourceNodeIds = readInputSourceNodeIds(start, options);
        const evaluation = evaluateInputTemplateStartState(start, {
          inlineText: options?.inlineText,
          sourceNodeIds,
        });
        if (!evaluation.ready) {
          const label = evaluation.missing[0]?.label ?? 'Input';
          set({
            status: {
              key: 'status.input_start_blocked',
              params: { label },
              fallback: `Start blocked. Missing required input: ${label}.`,
            },
          });
          return;
        }

        const workspace = get().sessionWorkspace;
        const catalog = get().agentCatalog.length > 0 ? get().agentCatalog : await refreshAgentCatalog();
        const graphSelection = readConnectedStepSelection(nodeId);
        const resolvedSelection =
          catalog.length > 0
            ? resolveSelection(catalog, selection ?? graphSelection, graphSelection ?? get().lastRunSelection)
            : normalizeSelection(selection ?? graphSelection ?? get().lastRunSelection);
        set({ lastRunSelection: resolvedSelection });
        if (!workspace) {
          openWorkspaceDialog({
            kind: 'input_start',
            nodeId,
            selection: resolvedSelection,
            options,
          });
          return;
        }
        const inlineInput = buildInlineInputValue(options?.inlineText);
        const inputVariant = [
          inlineInput ? JSON.stringify(inlineInput) : '',
          sourceNodeIds.join(','),
        ].join('|');

        const requestId = buildSpawnRequestId(
          sessionId,
          uniqIds([nodeId, ...start.bound.map((item) => item.boundNodeId)]),
          {
            triggerNodeId: nodeId,
            workingDirectory: workspace.workingDirectory,
            type: resolvedSelection.type,
            providerID: resolvedSelection.model?.providerID,
            modelID: resolvedSelection.model?.modelID,
            variant: inputVariant || undefined,
          },
        );
        if (get().activeSpawnRequestId === requestId) {
          set({ status: { key: 'status.spawn_in_progress' } });
          return;
        }

        const selectionLabel = formatAgentSelectionLabel(
          resolvedSelection.type,
          resolvedSelection.model,
        );
        set({
          activeSpawnRequestId: requestId,
          status: {
            key: 'status.input_starting',
            params: { label: selectionLabel },
            fallback: `Starting ${selectionLabel}…`,
          },
        });
        try {
          const res = await apiStartInputNode(sessionId, nodeId, {
            requestId,
            type: resolvedSelection.type,
            role: 'builder',
            workingDirectory: workspace.workingDirectory,
            wakeReason: 'human_prompt',
            model: resolvedSelection.model,
            ...(inlineInput ? { input: inlineInput } : {}),
            ...(sourceNodeIds.length > 0 ? { sourceNodeIds } : {}),
          });
          if (!res.success) {
            set({ status: statusFromApiErr(res.error) });
            return;
          }
          set({
            status: {
              key: 'status.input_started',
              params: { id: res.data.agentRunId },
              fallback: `Input run: ${res.data.agentRunId}`,
            },
            lastRunSelection: resolvedSelection,
          });
        } catch (errorValue) {
          set({ status: statusFromThrown(errorValue) });
        } finally {
          set((s) => (s.activeSpawnRequestId === requestId ? { activeSpawnRequestId: null } : {}));
        }
      };

      const startControllerNode = async (nodeId: string): Promise<void> => {
        const sessionId = get().sessionId;
        if (!sessionId) {
          set({ status: { key: 'status.no_active_session' } });
          return;
        }

        const node = get().nodes.find((entry) => entry.id === nodeId);
        const raw = node ? readRawFlowNode(node) : null;
        if (!raw || raw.type !== 'loop') {
          return;
        }
        const launch = planControllerLaunch(raw);

        const workspace = get().sessionWorkspace;
        if (!workspace) {
          openWorkspaceDialog({ kind: 'controller_start', nodeId });
          return;
        }

        const requestId = `workflow-controller:${sessionId}:${nodeId}:${workspace.workingDirectory}`;
        if (get().activeSpawnRequestId === requestId) {
          set({ status: { key: 'status.spawn_in_progress' } });
          return;
        }

        set({
          activeSpawnRequestId: requestId,
          status: {
            key:
              launch === 'restart'
                ? 'status.workflow_controller_restarting'
                : launch === 'resume'
                  ? 'status.workflow_controller_resuming'
                  : 'status.workflow_controller_starting',
          },
        });
        try {
          const res = await apiRunWorkflowController(sessionId, nodeId, {
            requestId,
            workingDirectory: workspace.workingDirectory,
            forceRestart: launch === 'restart',
          });
          if (!res.success) {
            set({ status: statusFromApiErr(res.error) });
            return;
          }
          const resolvedLaunch = res.data.launchMode ?? launch;
          set({
            status: {
              key:
                resolvedLaunch === 'restart'
                  ? 'status.workflow_controller_restarted'
                  : resolvedLaunch === 'resume'
                    ? 'status.workflow_controller_resumed'
                    : 'status.workflow_controller_started',
              params: { id: res.data.controllerId },
            },
          });
        } catch (errorValue) {
          set({ status: statusFromThrown(errorValue) });
        } finally {
          set((s) => (s.activeSpawnRequestId === requestId ? { activeSpawnRequestId: null } : {}));
        }
      };

      const startFlowNode = async (nodeId: string): Promise<void> => {
        const sessionId = get().sessionId;
        if (!sessionId) {
          set({ status: { key: 'status.no_active_session' } });
          return;
        }

        const node = get().nodes.find((entry) => entry.id === nodeId);
        const raw = node ? readRawFlowNode(node) : null;
        if (!raw || raw.type !== 'managed_flow') {
          return;
        }
        const launch = planManagedFlowLaunch(raw);
        const workspace = get().sessionWorkspace;
        if (!workspace) {
          openWorkspaceDialog({ kind: 'controller_start', nodeId });
          return;
        }

        const requestId = `workflow-flow:${sessionId}:${nodeId}:${workspace.workingDirectory}`;
        if (get().activeSpawnRequestId === requestId) {
          set({ status: { key: 'status.spawn_in_progress' } });
          return;
        }

        set({
          activeSpawnRequestId: requestId,
          status: {
            key:
              launch === 'restart'
                ? 'status.workflow_flow_restarting'
                : launch === 'resume'
                  ? 'status.workflow_flow_resuming'
                  : 'status.workflow_flow_starting',
          },
        });
        try {
          const res = await apiRunWorkflowFlow(sessionId, nodeId, {
            requestId,
            workingDirectory: workspace.workingDirectory,
            forceRestart: launch === 'restart',
          });
          if (!res.success) {
            set({ status: statusFromApiErr(res.error) });
            return;
          }
          const resolvedLaunch = res.data.launchMode ?? launch;
          set({
            status: {
              key:
                resolvedLaunch === 'restart'
                  ? 'status.workflow_flow_restarted'
                  : resolvedLaunch === 'resume'
                    ? 'status.workflow_flow_resumed'
                    : 'status.workflow_flow_started',
              params: { id: res.data.flowId },
            },
          });
        } catch (errorValue) {
          set({ status: statusFromThrown(errorValue) });
        } finally {
          set((s) => (s.activeSpawnRequestId === requestId ? { activeSpawnRequestId: null } : {}));
        }
      };

      const spawnWithSeedIds = async (
        seedNodeIds: ReadonlyArray<string>,
        triggerNodeId: string | null = null,
        selection?: AgentRunSelection | null,
      ): Promise<void> => {
        const sessionId = get().sessionId;
        if (!sessionId) {
          set({ status: { key: 'status.no_active_session' } });
          return;
        }

        const normalizedSeedIds = uniqIds(seedNodeIds);
        if (normalizedSeedIds.length === 0) {
          set({ status: { key: 'status.no_context_nodes' } });
          return;
        }

        const workspace = get().sessionWorkspace;
        const catalog = get().agentCatalog.length > 0 ? get().agentCatalog : await refreshAgentCatalog();
        const graphSelection = readConnectedStepSelection(triggerNodeId);
        const resolvedSelection =
          catalog.length > 0
            ? resolveSelection(catalog, selection ?? graphSelection, graphSelection ?? get().lastRunSelection)
            : normalizeSelection(selection ?? graphSelection ?? get().lastRunSelection);
        set({ lastRunSelection: resolvedSelection });
        const selectionLabel = formatAgentSelectionLabel(
          resolvedSelection.type,
          resolvedSelection.model,
        );
        if (!workspace) {
          openWorkspaceDialog({
            kind: 'spawn',
            seedNodeIds: normalizedSeedIds,
            triggerNodeId,
            selection: resolvedSelection,
          });
          return;
        }

        const requestId = buildSpawnRequestId(sessionId, normalizedSeedIds, {
          triggerNodeId,
          workingDirectory: workspace.workingDirectory,
          type: resolvedSelection.type,
          providerID: resolvedSelection.model?.providerID,
          modelID: resolvedSelection.model?.modelID,
        });
        if (get().activeSpawnRequestId === requestId) {
          set({ status: { key: 'status.spawn_in_progress' } });
          return;
        }

        set({
          activeSpawnRequestId: requestId,
          status: { key: 'status.spawning_agent', params: { label: selectionLabel } },
        });
        try {
          const res = await spawnAgent(sessionId, {
            requestId,
            type: resolvedSelection.type,
            role: 'builder',
            runtime: { kind: 'local_process', cwd: workspace.workingDirectory },
            workingDirectory: workspace.workingDirectory,
            triggerNodeId,
            wakeReason: 'human_prompt',
            seedNodeIds: normalizedSeedIds,
            model: resolvedSelection.model,
          });
          if (!res.success) {
            set({ status: statusFromApiErr(res.error) });
            return;
          }
          set({
            status: { key: 'status.spawn', params: { id: res.data.agentRunId } },
            lastRunSelection: resolvedSelection,
          });
        } catch (errorValue) {
          set({ status: statusFromThrown(errorValue) });
        } finally {
          set((s) => (s.activeSpawnRequestId === requestId ? { activeSpawnRequestId: null } : {}));
        }
      };

      const rerunWithRunId = async (
        runId: string,
        node: GraphNode,
        selection?: AgentRunSelection | null,
        fallback?: AgentRunSelection | null,
      ): Promise<void> => {
        const sessionId = get().sessionId;
        if (!sessionId) {
          set({ status: { key: 'status.no_active_session' } });
          return;
        }
        const catalog = get().agentCatalog.length > 0 ? get().agentCatalog : await refreshAgentCatalog();
        const fallbackSelection =
          resolveNodeSelection(node.id, get().nodes.map(readRawFlowNode), toGraphEdgeLinks(get().edges), fallback) ??
          get().lastRunSelection ??
          fallback ??
          readNodeSelection(node);
        const resolvedSelection =
          catalog.length > 0
            ? resolveSelection(catalog, selection, fallbackSelection)
            : normalizeSelection(selection ?? fallbackSelection);
        set({ lastRunSelection: resolvedSelection });
        const selectionLabel = formatAgentSelectionLabel(
          resolvedSelection.type,
          resolvedSelection.model,
        );
        set({
          status: { key: 'status.spawning_agent', params: { label: selectionLabel } },
        });
        try {
          const res = await rerunAgent(sessionId, runId, {
            type: resolvedSelection.type,
            model: resolvedSelection.model,
          });
          if (!res.success) {
            set({ status: statusFromApiErr(res.error) });
            return;
          }
          set({
            status: { key: 'status.spawn', params: { id: res.data.agentRunId } },
            lastRunSelection: resolvedSelection,
          });
        } catch (errorValue) {
          set({ status: statusFromThrown(errorValue) });
        }
      };

      return {
        locale: typeof window !== 'undefined' ? detectLocaleFromNav() : DEFAULT_LOCALE,
        themeMode: DEFAULT_THEME_MODE,
        themeCepage: DEFAULT_THEME_CEPAGE,
        prefsPanelOpen: true,
        sessionId: null,
        sessionWorkspace: null,
        agentCatalog: [],
        agentCatalogLoading: false,
        lastRunSelection: null,
        lastEventId: 0,
        nodes: [],
        edges: [],
        branches: [],
        agentRuns: {},
        workflowExecutions: {},
        workflowControllers: {},
        workflowFlows: {},
        liveRuns: [],
        activeRuns: [],
        activeControllers: [],
        activeFlows: [],
        activity: [],
        timeline: [],
        timelineLoading: false,
        timelineCursor: null,
        timelineHasMore: false,
        selected: null,
        selectedIds: [],
        socket: null,
        activeSpawnRequestId: null,
        pendingSpawn: null,
        workspaceDialogOpen: false,
        workspaceParentDirectoryDraft: '',
        workspaceDirectoryNameDraft: '',
        status: null,
        workflowCopilotThread: null,
        workflowCopilotMessages: [],
        workflowCopilotCheckpoints: [],
        workflowCopilotLoading: false,
        workflowCopilotSending: false,
        workflowCopilotStopping: false,
        workflowCopilotApplyingMessageId: null,
        workflowCopilotRestoringCheckpointId: null,
        workflowCopilotContextAccepted: false,
        workflowCopilotDrafts: {},
        workspaceTabs: {} as WorkspaceTabsBySession,
        setLocale: (locale: Locale) => {
          set({ locale });
          applyDocLang(locale);
        },
        setThemeMode: (themeMode: ThemeMode) => {
          const effective = resolveEffectiveThemeMode(themeMode);
          const themeCepage = cepageForEffectiveMode(effective);
          set({ themeMode, themeCepage });
          applyThemeToDocument(themeMode, themeCepage);
        },
        setThemeCepage: (themeCepage: ThemeCepage) => {
          const themeMode: ThemeMode = CEPAGE_DEFAULTS[themeCepage].mode;
          set({ themeMode, themeCepage });
          applyThemeToDocument(themeMode, themeCepage);
        },
        setLastRunSelection: (selection) =>
          set({ lastRunSelection: selection ? normalizeSelection(selection) : null }),
        setPrefsPanelOpen: (open: boolean) => set({ prefsPanelOpen: open }),
        setSelectedIds: (ids, primaryId = null) => set((s) => selectionPatch(s, ids, primaryId)),
        setSelected: (id) => set((s) => selectionPatch(s, id ? [id] : [], id)),
        acceptWorkflowCopilotContext: () =>
          set((s) =>
            s.selectedIds.length > 0 && !s.workflowCopilotContextAccepted
              ? { workflowCopilotContextAccepted: true }
              : {},
          ),
        setWorkflowCopilotDraft: (key, value) => {
          const current = get().workflowCopilotDrafts;
          const next = writeWorkflowCopilotDraft(current, key, value);
          if (next === current) {
            return;
          }
          set({ workflowCopilotDrafts: next });
        },
        openWorkspaceFile: (input) => {
          const sessionId = get().sessionId;
          if (!sessionId) return null;
          const { next, tabId } = openFileTab(get().workspaceTabs, sessionId, input);
          if (next === get().workspaceTabs) {
            return tabId;
          }
          set({ workspaceTabs: next });
          return tabId;
        },
        closeWorkspaceFile: (tabId) => {
          const sessionId = get().sessionId;
          if (!sessionId) return;
          const next = closeFileTab(get().workspaceTabs, sessionId, tabId);
          if (next === get().workspaceTabs) return;
          set({ workspaceTabs: next });
        },
        setActiveWorkspaceTab: (tabId) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            return;
          }
          const next = setActiveTab(get().workspaceTabs, sessionId, tabId || CHAT_TAB_ID);
          if (next === get().workspaceTabs) return;
          set({ workspaceTabs: next });
        },
        openSessionWorkspaceDialog: async () => {
          if (!get().sessionId) {
            await get().bootstrapNewSession();
            if (!get().sessionId) {
              return;
            }
          }
          openWorkspaceDialog();
        },
        closeSessionWorkspaceDialog: () =>
          set({
            workspaceDialogOpen: false,
            pendingSpawn: null,
          }),
        updateSessionWorkspaceDraft: (patch) =>
          set((s) => ({
            workspaceParentDirectoryDraft:
              patch.parentDirectory ?? s.workspaceParentDirectoryDraft,
            workspaceDirectoryNameDraft:
              patch.directoryName ?? s.workspaceDirectoryNameDraft,
          })),
        saveSessionWorkspace: async () => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return false;
          }

          const parentDirectory = get().workspaceParentDirectoryDraft.trim();
          const directoryName = get().workspaceDirectoryNameDraft.trim();
          if (!parentDirectory) {
            set({ status: { key: 'status.choose_parent_first' } });
            return false;
          }

          try {
            const res = await updateSessionWorkspace(sessionId, {
              parentDirectory,
              directoryName: directoryName || undefined,
            });
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return false;
            }

            const workspace = res.data.workspace;
            const pendingSpawn = get().pendingSpawn;
            const draft = toWorkspaceDraft(workspace);
            set((s) =>
              withLiveRuns(s, {
                sessionWorkspace: workspace,
                agentCatalog: [],
                agentCatalogLoading: false,
                workspaceDialogOpen: false,
                workspaceParentDirectoryDraft: draft.parentDirectory,
                workspaceDirectoryNameDraft: draft.directoryName,
                pendingSpawn: null,
                status: workspace
                  ? { key: 'status.workspace_path', params: { path: workspace.workingDirectory } }
                  : { key: 'status.session_workspace_updated' },
              }),
            );

            if (pendingSpawn && workspace) {
              if (pendingSpawn.kind === 'spawn') {
                await spawnWithSeedIds(
                  pendingSpawn.seedNodeIds,
                  pendingSpawn.triggerNodeId,
                  pendingSpawn.selection,
                );
              }
              if (pendingSpawn.kind === 'controller_start') {
                await startControllerNode(pendingSpawn.nodeId);
              }
              if (pendingSpawn.kind === 'input_start') {
                await startInputWithNode(pendingSpawn.nodeId, pendingSpawn.selection, pendingSpawn.options);
              }
            }

            return true;
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
            return false;
          }
        },
        browseSessionWorkspaceParentDirectory: async () => {
          const defaultPath = get().workspaceParentDirectoryDraft.trim() || undefined;
          try {
            const res = await chooseSessionWorkspaceParentDirectory(defaultPath);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            if (!res.data.supported) {
              set({ status: { key: 'status.native_picker_unavailable' } });
              return;
            }
            if (res.data.cancelled || !res.data.path) {
              return;
            }
            get().updateSessionWorkspaceDraft({ parentDirectory: res.data.path });
            set({
              status: {
                key: 'status.workspace_parent',
                params: { path: res.data.path },
              },
            });
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },
        openSessionWorkspaceDirectory: async () => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }

          if (!get().sessionWorkspace) {
            set({ status: { key: 'status.configure_workspace' } });
            return;
          }

          try {
            const res = await apiOpenSessionWorkspaceDirectory(sessionId);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            if (!res.data.supported) {
              set({ status: { key: 'status.file_explorer_unavailable' } });
              return;
            }
            set({
              status: {
                key: 'status.workspace_opened',
                params: { path: res.data.path },
              },
            });
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },
        refreshAgentCatalog,

        connectRealtime: () => {
          const sessionId = get().sessionId;
          if (!sessionId) return;
          const existing = get().socket;
          existing?.disconnect();
          const socket = connectSessionSocket(sessionId, get().lastEventId);
          set({ socket, status: { key: 'status.live' } });
          let joined = false;

          socket.on('connect', () => {
            const state = get();
            if (state.socket !== socket || state.sessionId !== sessionId) {
              return;
            }
            if (!joined) {
              joined = true;
              return;
            }
            void (async () => {
              await state.loadSession(sessionId);
              await resyncCopilot(sessionId);
            })();
          });

          socket.on('connect_error', (errorValue) => {
            set({
              status: {
                key: 'status.socket_error',
                params: { detail: errorValue instanceof Error ? errorValue.message : String(errorValue) },
              },
            });
          });
          socket.on('disconnect', (reason) => {
            set({
              status: {
                key: 'status.socket_disconnected',
                params: { reason: String(reason) },
              },
            });
          });

          const bumpEvent = (msg: Record<string, unknown>): Partial<WorkspaceState> => {
            const eid = msg.eventId as number | undefined;
            return eid != null && eid > 0 ? { lastEventId: Math.max(get().lastEventId, eid) } : {};
          };

          socket.on('event', (msg: Record<string, unknown>) => {
            const type = msg.type as string;

            if (type === 'graph.node_added') {
              const payload = msg.payload as GraphNode;
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  nodes: [...s.nodes.filter((n) => n.id !== payload.id), toFlowNode(payload)],
                }),
              );
              return;
            }

            if (type === 'graph.node_updated') {
              const p = msg.payload as { nodeId: string; patch: Partial<GraphNode> };
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  nodes: s.nodes.map((n) => {
                    if (n.id !== p.nodeId) return n;
                    const raw = (n.data as { raw: GraphNode }).raw;
                    return toFlowNode(mergeNodePatch(raw, p.patch));
                  }),
                }),
              );
              return;
            }

            if (type === 'graph.node_removed') {
              const p = msg.payload as { nodeId: string };
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  nodes: s.nodes.filter((n) => n.id !== p.nodeId),
                  edges: s.edges.filter((e) => e.source !== p.nodeId && e.target !== p.nodeId),
                }),
              );
              return;
            }

            if (type === 'graph.edge_added') {
              const payload = msg.payload as GraphEdge;
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  edges: [...s.edges.filter((e) => e.id !== payload.id), toFlowEdge(payload)],
                }),
              );
              return;
            }

            if (type === 'graph.edge_removed') {
              const p = msg.payload as { edgeId: string };
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  edges: s.edges.filter((e) => e.id !== p.edgeId),
                }),
              );
              return;
            }

            if (type === 'graph.branch_created') {
              const branch = msg.payload as Branch;
              set((s) => ({
                ...bumpEvent(msg),
                branches: [...s.branches.filter((b) => b.id !== branch.id), branch],
              }));
              return;
            }

            if (type === 'graph.branch_merged') {
              const p = msg.payload as { sourceBranchId: string; targetBranchId: string };
              set((s) => ({
                ...bumpEvent(msg),
                branches: s.branches.map((b) =>
                  b.id === p.sourceBranchId
                    ? { ...b, status: 'merged' as const, mergedIntoBranchId: p.targetBranchId }
                    : b,
                ),
              }));
              return;
            }

            if (type === 'graph.branch_abandoned') {
              const p = msg.payload as { branchId: string };
              set((s) => ({
                ...bumpEvent(msg),
                branches: s.branches.map((b) =>
                  b.id === p.branchId ? { ...b, status: 'abandoned' as const } : b,
                ),
              }));
              return;
            }

            if (type === 'activity.logged') {
              const row = readActivity({
                timestamp: msg.timestamp as string | undefined,
                runId: msg.runId as string | undefined,
                actor: msg.actor as { type?: string; id?: string } | undefined,
                payload: msg.payload as {
                  id: string;
                  summary: string;
                  summaryKey?: string;
                  summaryParams?: Record<string, unknown>;
                  relatedNodeIds?: string[];
                },
              });
              set((s) => ({
                ...bumpEvent(msg),
                activity: mergeTimelineHead(s.activity, row, MAX_ACTIVITY),
                timeline: mergeTimelineHead(s.timeline, row, Math.max(s.timeline.length + 1, MAX_ACTIVITY)),
              }));
              return;
            }

            if (type === 'workflow.controller_updated') {
              const payload = msg.payload as WorkflowControllerState;
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  workflowControllers: payload.id ? upsertController(s.workflowControllers, payload) : s.workflowControllers,
                }),
              );
              return;
            }

            if (type === 'workflow.flow_updated') {
              const payload = msg.payload as WorkflowManagedFlowState;
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  workflowFlows: payload.id ? upsertManagedFlow(s.workflowFlows, payload) : s.workflowFlows,
                }),
              );
              return;
            }

            if (type === 'workflow.copilot_thread_updated') {
              const patch = mergeCopilotThread(
                get().workflowCopilotThread,
                msg.payload as WorkflowCopilotThread,
              );
              if (patch) {
                set(patch);
              }
              return;
            }

            if (type === 'workflow.copilot_message_updated') {
              set((s) => mergeCopilotMessage(s, msg.payload as WorkflowCopilotLiveMessagePayload) ?? {});
              return;
            }

            if (type === 'system.resync_required') {
              const sid = (msg.sessionId as string) ?? get().sessionId;
              if (sid) {
                void (async () => {
                  await get().loadSession(sid);
                  await resyncCopilot(sid);
                })();
              }
              return;
            }

            if (type === 'agent.spawned') {
              const payload = msg.payload as AgentRun;
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  agentRuns: payload.id ? { ...s.agentRuns, [payload.id]: payload } : s.agentRuns,
                  workflowExecutions: payload.id ? upsertExecutionFromRun(s.workflowExecutions, payload) : s.workflowExecutions,
                  status: payload.id
                    ? { key: 'status.spawn', params: { id: payload.id } }
                    : s.status,
                }),
              );
              return;
            }

            if (type === 'agent.status') {
              const payload = msg.payload as AgentRun;
              set((s) =>
                withLiveRuns(s, {
                  ...bumpEvent(msg),
                  agentRuns: payload.id ? { ...s.agentRuns, [payload.id]: payload } : s.agentRuns,
                  workflowExecutions: payload.id ? upsertExecutionFromRun(s.workflowExecutions, payload) : s.workflowExecutions,
                  status: payload.status
                    ? { key: 'status.run', params: { status: payload.status } }
                    : s.status,
                }),
              );
              return;
            }

            if (type === 'agent.output_chunk') {
              const payload = msg.payload as {
                agentRunId?: string;
                executionId?: string;
                output?: string;
                isStreaming?: boolean;
              };
              const runId = payload.agentRunId;
              if (!runId) {
                return;
              }
              set((s) => {
                const current = s.agentRuns[runId];
                if (!current) {
                  return s;
                }
                const nextRun: AgentRun = {
                  ...current,
                  ...(payload.executionId ? { executionId: payload.executionId } : {}),
                  ...(payload.output !== undefined ? { outputText: payload.output } : {}),
                  ...(payload.isStreaming != null ? { isStreaming: payload.isStreaming } : {}),
                  updatedAt: new Date().toISOString(),
                };
                return withLiveRuns(s, {
                  agentRuns: {
                    ...s.agentRuns,
                    [nextRun.id]: nextRun,
                  },
                  workflowExecutions: upsertExecutionFromRun(s.workflowExecutions, nextRun),
                });
              });
            }
          });

        },

        bootstrapNewSession: async () => {
          try {
            const res = await createSession('Workspace ' + new Date().toISOString().slice(0, 16));
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            replaceSessionQuery(res.data.id);
            const workspaceDraft = toWorkspaceDraft(res.data.workspace);
            set((s) =>
              withLiveRuns(s, {
                sessionId: res.data.id,
                sessionWorkspace: res.data.workspace,
                agentCatalog: [],
                agentCatalogLoading: false,
                lastEventId: 0,
                nodes: [],
                edges: [],
                branches: [],
                agentRuns: {},
                workflowExecutions: {},
                workflowControllers: {},
                workflowFlows: {},
                activity: [],
                timeline: [],
                timelineLoading: false,
                timelineCursor: null,
                timelineHasMore: false,
                selected: null,
                selectedIds: [],
                pendingSpawn: null,
                workspaceDialogOpen: false,
                workspaceParentDirectoryDraft: workspaceDraft.parentDirectory,
                workspaceDirectoryNameDraft: workspaceDraft.directoryName,
                workflowCopilotContextAccepted: false,
                ...clearWorkflowCopilot(),
              }),
            );
            get().connectRealtime();
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        loadSession: async (sessionId: string) => {
          try {
            const res = await getGraphBundle(sessionId);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            replaceSessionQuery(sessionId);
            const branches = (res.data.branches ?? []) as Branch[];
            const workspaceDraft = toWorkspaceDraft(res.data.session.workspace);
            const activity = (res.data.activity ?? []).map((row) => ({ ...row })) as ActivityLine[];
            set((s) =>
              withLiveRuns(s, {
                sessionId,
                sessionWorkspace: res.data.session.workspace,
                agentCatalog: [],
                agentCatalogLoading: false,
                lastEventId: res.data.lastEventId,
                nodes: res.data.nodes.map(toFlowNode),
                edges: res.data.edges.map(toFlowEdge),
                branches,
                agentRuns: indexRuns(res.data.agentRuns ?? []),
                workflowExecutions: indexExecutions(res.data.workflowExecutions ?? []),
                workflowControllers: indexControllers(res.data.workflowControllers ?? []),
                workflowFlows: indexManagedFlows(res.data.workflowFlows ?? []),
                activity,
                timeline: activity,
                timelineLoading: false,
                timelineCursor: res.data.activityNextCursor,
                timelineHasMore: res.data.activityHasMore,
                selected: null,
                selectedIds: [],
                pendingSpawn: null,
                workspaceDialogOpen: false,
                workspaceParentDirectoryDraft: workspaceDraft.parentDirectory,
                workspaceDirectoryNameDraft: workspaceDraft.directoryName,
                workflowCopilotContextAccepted: false,
                ...(s.sessionId === sessionId ? {} : clearWorkflowCopilot()),
              }),
            );
            get().connectRealtime();
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        exportWorkflow: async () => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return false;
          }

          try {
            const res = await apiExportWorkflow(sessionId);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return false;
            }
            downloadJson(workflowFileName(sessionId), res.data);
            set({ status: { key: 'status.workflow_exported' } });
            return true;
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
            return false;
          }
        },

        copyWorkflowExport: async () => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return false;
          }

          try {
            const res = await apiExportWorkflow(sessionId);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return false;
            }
            const text = JSON.stringify(res.data, null, 2);
            const ok = await copyTextToClipboard(text);
            if (!ok) {
              set({ status: { key: 'status.clipboard_copy_failed' } });
              return false;
            }
            set({ status: { key: 'status.workflow_export_copied' } });
            return true;
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
            return false;
          }
        },

        importWorkflow: async (file) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return false;
          }

          let value: unknown;
          try {
            value = JSON.parse(await file.text()) as unknown;
          } catch {
            set({ status: { key: 'status.workflow_invalid_json' } });
            return false;
          }

          const parsed = parseWorkflowTransfer(value);
          if (!parsed.success) {
            const detail = parsed.errors.join('; ');
            set({
              status: {
                key: 'errors.codes.VALIDATION_FAILED',
                params: { detail },
                fallback: detail,
              },
            });
            return false;
          }

          try {
            const res = await apiImportWorkflow(sessionId, parsed.data);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return false;
            }
            await get().loadSession(sessionId);
            set({ status: { key: 'status.workflow_imported' } });
            return true;
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
            return false;
          }
        },

        ensureWorkflowCopilotThread: async (input) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          set({ workflowCopilotLoading: true });
          try {
            const res = await apiEnsureWorkflowCopilotThread(sessionId, input);
            if (!res.success) {
              set({
                workflowCopilotLoading: false,
                status: statusFromApiErr(res.error),
              });
              return;
            }
            set(syncWorkflowCopilot(res.data));
          } catch (errorValue) {
            set({
              workflowCopilotLoading: false,
              status: statusFromThrown(errorValue),
            });
          }
        },

        patchWorkflowCopilotThread: async (patch) => {
          const sessionId = get().sessionId;
          const thread = get().workflowCopilotThread;
          if (!sessionId || !thread) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          const nextSelection =
            patch.agentType || patch.model
              ? normalizeSelection({
                  type: patch.agentType ?? thread.agentType,
                  model: patch.model ?? thread.model,
                })
              : selectionFromThread(thread);
          set({
            workflowCopilotLoading: true,
            ...(nextSelection ? { lastRunSelection: nextSelection } : {}),
          });
          try {
            const res = await apiPatchWorkflowCopilotThread(sessionId, thread.id, patch);
            if (!res.success) {
              set({
                workflowCopilotLoading: false,
                status: statusFromApiErr(res.error),
              });
              return;
            }
            set(syncWorkflowCopilot(res.data));
          } catch (errorValue) {
            set({
              workflowCopilotLoading: false,
              status: statusFromThrown(errorValue),
            });
          }
        },

        sendWorkflowCopilotMessage: async (content, input) => {
          const sessionId = get().sessionId;
          const thread = get().workflowCopilotThread;
          if (!sessionId || !thread) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (get().workflowCopilotSending || get().workflowCopilotStopping) {
            return;
          }
          const catalog = get().agentCatalog.length > 0 ? get().agentCatalog : await refreshAgentCatalog();
          const selection =
            catalog.length > 0
              ? resolveSelection(catalog, input?.selection ?? selectionFromThread(thread), get().lastRunSelection)
              : normalizeSelection(input?.selection ?? selectionFromThread(thread) ?? get().lastRunSelection);
          const pending = createPendingWorkflowCopilotSend({
            threadId: thread.id,
            content,
            ...(input?.attachments?.length ? { attachments: input.attachments } : {}),
            scope: input?.scope ?? thread.scope,
            selection,
          });
          set({
            workflowCopilotSending: true,
            workflowCopilotStopping: false,
            workflowCopilotMessages: mergeWorkflowCopilotMessages(get().workflowCopilotMessages, pending.messages),
            ...(selection ? { lastRunSelection: selection } : {}),
          });
          try {
            const res = await apiSendWorkflowCopilotMessage(sessionId, thread.id, {
              content,
              ...(input?.attachments?.length ? { attachments: input.attachments } : {}),
              scope: input?.scope,
              mode: input?.mode ?? thread.mode,
              agentType: selection?.type,
              model: selection?.model,
              autoApply: input?.autoApply,
              autoRun: input?.autoRun,
            });
            if (!res.success) {
              set({
                workflowCopilotSending: false,
                workflowCopilotStopping: false,
                workflowCopilotMessages: dropPendingWorkflowCopilotSend(get().workflowCopilotMessages, pending),
                status: statusFromApiErr(res.error),
              });
              return;
            }
            const messages = settlePendingWorkflowCopilotSend({
              current: get().workflowCopilotMessages,
              pending,
              next: [res.data.userMessage, res.data.assistantMessage],
            });
            const nextSelection = selectionFromThread(res.data.thread);
            const fsId = res.data.fileSummaryNodeId?.trim();
            set((s) => ({
              workflowCopilotThread: res.data.thread,
              workflowCopilotMessages: messages,
              workflowCopilotCheckpoints: res.data.checkpoints,
              workflowCopilotSending: false,
              workflowCopilotStopping: false,
              ...(nextSelection ? { lastRunSelection: nextSelection } : {}),
              ...(fsId ? selectionPatch(s, [fsId], fsId) : {}),
            }));
          } catch (errorValue) {
            set({
              workflowCopilotSending: false,
              workflowCopilotStopping: false,
              workflowCopilotMessages: dropPendingWorkflowCopilotSend(get().workflowCopilotMessages, pending),
              status: statusFromThrown(errorValue),
            });
          }
        },

        stopWorkflowCopilot: async () => {
          const sessionId = get().sessionId;
          const thread = get().workflowCopilotThread;
          if (!sessionId || !thread) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (!get().workflowCopilotSending || get().workflowCopilotStopping) {
            return;
          }
          set({ workflowCopilotStopping: true });
          try {
            const res = await apiStopWorkflowCopilotThread(sessionId, thread.id);
            if (!res.success) {
              set({
                workflowCopilotStopping: false,
                status: statusFromApiErr(res.error),
              });
            }
          } catch (errorValue) {
            set({
              workflowCopilotStopping: false,
              status: statusFromThrown(errorValue),
            });
          }
        },

        applyWorkflowCopilotMessage: async (messageId) => {
          const sessionId = get().sessionId;
          const thread = get().workflowCopilotThread;
          if (!sessionId || !thread) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          set({ workflowCopilotApplyingMessageId: messageId });
          try {
            const res = await apiApplyWorkflowCopilotMessage(sessionId, thread.id, messageId);
            if (!res.success) {
              set({
                workflowCopilotApplyingMessageId: null,
                status: statusFromApiErr(res.error),
              });
              return;
            }
            const messages = mergeWorkflowCopilotMessages(get().workflowCopilotMessages, [
              res.data.message,
            ]);
            const nextSelection = selectionFromThread(res.data.thread);
            set({
              workflowCopilotThread: res.data.thread,
              workflowCopilotMessages: messages,
              workflowCopilotCheckpoints: res.data.checkpoints,
              workflowCopilotApplyingMessageId: null,
              ...(nextSelection ? { lastRunSelection: nextSelection } : {}),
            });
          } catch (errorValue) {
            set({
              workflowCopilotApplyingMessageId: null,
              status: statusFromThrown(errorValue),
            });
          }
        },

        restoreWorkflowCopilotCheckpoint: async (checkpointId) => {
          const sessionId = get().sessionId;
          const thread = get().workflowCopilotThread;
          if (!sessionId || !thread) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          set({ workflowCopilotRestoringCheckpointId: checkpointId });
          try {
            const res = await apiRestoreWorkflowCopilotCheckpoint(sessionId, thread.id, checkpointId);
            if (!res.success) {
              set({
                workflowCopilotRestoringCheckpointId: null,
                status: statusFromApiErr(res.error),
              });
              return;
            }
            const bundle = {
              thread: res.data.thread,
              messages: res.data.messages,
              checkpoints: res.data.checkpoints,
            };
            await get().loadSession(sessionId);
            set(syncWorkflowCopilot(bundle));
          } catch (errorValue) {
            set({
              workflowCopilotRestoringCheckpointId: null,
              status: statusFromThrown(errorValue),
            });
          }
        },

        updateFileSummarySelection: async (nodeId, selection) => {
          const node = get().nodes.find((entry) => entry.id === nodeId);
          if (!node) {
            return;
          }
          const raw = readRawFlowNode(node);
          const next = patchNodeSelectionContent(raw, {
            mode: 'locked',
            selection: normalizeSelection(selection),
          });
          await get().patchNodeData(nodeId, { content: next });
        },

        uploadFilesToNode: async (nodeId, files) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (files.length === 0) {
            return;
          }
          const current = get().nodes.find((node) => node.id === nodeId);
          if (!current) {
            return;
          }
          const name = files.length === 1 ? files[0].name : `${files.length} files`;
          set({
            status: {
              key: 'status.file_uploading',
              params: { name },
              fallback: `Uploading ${name}…`,
            },
          });
          try {
            const res = await apiUploadFileNodeFiles(sessionId, nodeId, files);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            set((s) =>
              withLiveRuns(s, {
                nodes: s.nodes.map((node) => {
                  if (node.id !== nodeId) return node;
                  const currentRaw = (node.data as { raw: GraphNode }).raw;
                  return toFlowNode(mergeNodePatch(currentRaw, res.data.patch as Partial<GraphNode>));
                }),
                lastEventId: Math.max(s.lastEventId, res.data.eventId),
                status: {
                  key: 'status.file_uploaded',
                  params: { name },
                  fallback: `Uploaded ${name}.`,
                },
              }),
            );
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        summarizeFileNode: async (nodeId, selection = null) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          const node = get().nodes.find((entry) => entry.id === nodeId);
          if (!node) {
            return;
          }
          const raw = readRawFlowNode(node);
          if (raw.type !== 'file_summary') {
            return;
          }
          const nodeSelection =
            resolveNodeSelection(nodeId, get().nodes.map(readRawFlowNode), toGraphEdgeLinks(get().edges)) ??
            get().lastRunSelection;
          if (!selection && !nodeSelection) {
            set({
              status: {
                key: 'errors.codes.FILE_NODE_SELECTION_REQUIRED',
                fallback: 'Choose a provider and model on this node first.',
              },
            });
            return;
          }
          const catalog = get().agentCatalog.length > 0 ? get().agentCatalog : await refreshAgentCatalog();
          const resolvedSelection =
            catalog.length > 0
              ? resolveSelection(catalog, selection ?? nodeSelection, nodeSelection)
              : normalizeSelection(selection ?? nodeSelection);
          const label = formatAgentSelectionLabel(
            resolvedSelection.type,
            resolvedSelection.model,
          );
          set({
            lastRunSelection: resolvedSelection,
            status: {
              key: 'status.file_summarizing',
              params: { label },
              fallback: `Summarizing with ${label}…`,
            },
          });
          try {
            const res = await apiSummarizeFileNode(sessionId, nodeId, {
              type: resolvedSelection.type,
              model: resolvedSelection.model,
            });
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            set((s) =>
              withLiveRuns(s, {
                nodes: s.nodes.map((entry) => {
                  if (entry.id !== nodeId) return entry;
                  const currentRaw = (entry.data as { raw: GraphNode }).raw;
                  return toFlowNode(mergeNodePatch(currentRaw, res.data.patch as Partial<GraphNode>));
                }),
                lastEventId: Math.max(s.lastEventId, res.data.eventId),
                status: {
                  key: 'status.file_summarized',
                  params: { label },
                  fallback: `Summary ready from ${label}.`,
                },
              }),
            );
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        createNodeAt: async ({ type, position, content }) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return null;
          }

          try {
            const res = await apiCreateNode(sessionId, {
              type,
              content: content ?? buildCreateNodeContent(type),
              position,
            });
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return null;
            }

            const node = toFlowNode(res.data.node);
            set((s) =>
              withLiveRuns(s, {
                nodes: [...s.nodes.filter((n) => n.id !== res.data.node.id), node],
                lastEventId: res.data.eventId,
              }),
            );
            return node.id;
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
            return null;
          }
        },

        addHumanMessage: async (text: string) => {
          await get().createNodeAt({
            type: 'human_message',
            content: buildCreateNodeContent('human_message', text),
            position: getDefaultCreatePosition(get().nodes),
          });
        },

        createBranchFromNode: async (nodeId, input) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          const node = get().nodes.find((entry) => entry.id === nodeId);
          if (!node) {
            return;
          }
          const name = input?.name?.trim() || nextBranchName(get().branches);
          const color = input?.color?.trim() || nextBranchColor(get().branches);
          try {
            const res = await apiCreateBranch(sessionId, {
              requestId: `branch-${nodeId}-${Date.now()}`,
              name,
              color,
              fromNodeId: nodeId,
            });
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            set({
              branches: [...get().branches.filter((entry) => entry.id !== res.data.branch.id), res.data.branch],
              lastEventId: Math.max(get().lastEventId, res.data.eventId),
              status: { key: 'status.saved', fallback: `Created branch ${name}.` },
            });
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        mergeBranch: async (sourceBranchId, targetBranchId) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (!sourceBranchId || !targetBranchId || sourceBranchId === targetBranchId) {
            return;
          }
          try {
            const res = await apiMergeBranch(sessionId, sourceBranchId, {
              requestId: `branch-merge-${sourceBranchId}-${targetBranchId}`,
              targetBranchId,
            });
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            set({
              branches: get().branches.map((row) =>
                row.id === sourceBranchId ? { ...row, status: 'merged', mergedIntoBranchId: targetBranchId } : row,
              ),
              lastEventId: Math.max(get().lastEventId, res.data.eventId),
              status: { key: 'status.saved', fallback: 'Merged branch.' },
            });
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        abandonBranch: async (branchId) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (!branchId) {
            return;
          }
          try {
            const res = await apiAbandonBranch(sessionId, branchId);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            set({
              branches: get().branches.map((row) =>
                row.id === branchId ? { ...row, status: 'abandoned' } : row,
              ),
              lastEventId: Math.max(get().lastEventId, res.data.eventId),
              status: { key: 'status.saved', fallback: 'Abandoned branch.' },
            });
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        loadMoreTimeline: async () => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (get().timelineLoading || !get().timelineHasMore) {
            return;
          }
          set({ timelineLoading: true });
          try {
            const res = await getTimeline(sessionId, {
              before: get().timelineCursor ?? undefined,
            });
            if (!res.success) {
              set({
                timelineLoading: false,
                status: statusFromApiErr(res.error),
              });
              return;
            }
            set((s) => ({
              timeline: mergeTimelinePage(s.timeline, res.data.items),
              timelineLoading: false,
              timelineCursor: res.data.nextCursor,
              timelineHasMore: res.data.nextCursor !== null,
            }));
          } catch (errorValue) {
            set({
              timelineLoading: false,
              status: statusFromThrown(errorValue),
            });
          }
        },

        connectNodes: async (sourceId: string, targetId: string) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          if (!sourceId || !targetId || sourceId === targetId) return;
          const duplicate = get().edges.some(
            (edge) => edge.source === sourceId && edge.target === targetId && edge.label === 'references',
          );
          if (duplicate) return;

          try {
            const res = await createEdge(sessionId, {
              requestId: `edge-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              relation: 'references',
              direction: 'source_to_target',
            });
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            const edge = toFlowEdge(res.data.edge);
            set((s) => ({
              edges: [...s.edges.filter((e) => e.id !== res.data.edge.id), edge],
              lastEventId: res.data.eventId,
              status: { key: 'status.linked' },
            }));
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        removeEdge: async (edgeId: string) => {
          const sessionId = get().sessionId;
          if (!sessionId) return;
          const previousEdges = get().edges;
          set((s) =>
            withLiveRuns(s, { edges: s.edges.filter((edge) => edge.id !== edgeId) }),
          );

          try {
            const res = await apiDeleteEdge(sessionId, edgeId);
            if (!res.success) {
              set((s) =>
                withLiveRuns(s, { edges: previousEdges, status: statusFromApiErr(res.error) }),
              );
              return;
            }
            set({ lastEventId: res.data.eventId });
          } catch (errorValue) {
              set((s) =>
                withLiveRuns(s, { edges: previousEdges, status: statusFromThrown(errorValue) }),
              );
          }
        },

        removeNode: async (nodeId: string) => {
          const sessionId = get().sessionId;
          if (!sessionId) return;
          const previousNodes = get().nodes;
          const previousEdges = get().edges;
          const previousSelected = get().selected;
          const previousSelectedIds = get().selectedIds;
          const previousContextAccepted = get().workflowCopilotContextAccepted;
          set((s) =>
            withLiveRuns(s, {
              nodes: s.nodes.filter((n) => n.id !== nodeId),
              edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
              ...selectionPatch(s, s.selectedIds.filter((id) => id !== nodeId)),
            }),
          );

          try {
            const res = await apiDeleteNode(sessionId, nodeId);
            if (!res.success) {
              set((s) =>
                withLiveRuns(s, {
                  nodes: previousNodes,
                  edges: previousEdges,
                  selected: previousSelected,
                  selectedIds: previousSelectedIds,
                  workflowCopilotContextAccepted: previousContextAccepted,
                  status: statusFromApiErr(res.error),
                }),
              );
              return;
            }
            set({ lastEventId: res.data.eventId });
          } catch (errorValue) {
            set((s) =>
              withLiveRuns(s, {
                nodes: previousNodes,
                edges: previousEdges,
                selected: previousSelected,
                selectedIds: previousSelectedIds,
                workflowCopilotContextAccepted: previousContextAccepted,
                status: statusFromThrown(errorValue),
              }),
            );
          }
        },

        connectSelection: async () => {
          const ids = get().selectedIds;
          if (ids.length === 0) {
            set({ status: { key: 'status.select_node' } });
            return;
          }
          const humans = get().nodes.filter(
            (n) => (n.data as { raw: GraphNode }).raw.type === 'human_message',
          );
          const human = humans[humans.length - 1];
          if (!human) {
            set({ status: { key: 'status.create_human_first' } });
            return;
          }
          for (const id of ids) {
            if (id === human.id) continue;
            await get().connectNodes(human.id, id);
          }
        },

        spawnSelection: async (selection = null) => {
          const ids = get().selectedIds;
          const selected = pickSelected(ids, get().selected);
          const selectedNode = selected ? get().nodes.find((entry) => entry.id === selected) : null;
          const selectedRaw = selectedNode ? readRawFlowNode(selectedNode) : null;
          if (selectedRaw?.type === 'managed_flow') {
            await startFlowNode(selectedRaw.id);
            return;
          }
          const loop = readConnectedLoopRun(selected);
          if (loop?.mode === 'ambiguous') {
            set({ status: { key: 'errors.codes.WORKFLOW_LOOP_AMBIGUOUS' } });
            return;
          }
          if (loop?.mode === 'controller') {
            await startControllerNode(loop.nodeId);
            return;
          }
          const seedIds = ids.length > 0
            ? uniqIds(ids.flatMap((id) => collectConnectedNodeIds(id, get().edges)))
            : get()
                .nodes.filter((n) =>
                  ['human_message', 'note'].includes((n.data as { raw: GraphNode }).raw.type) ||
                  (((n.data as { raw: GraphNode }).raw.type === 'input') &&
                    readWorkflowInputContent((n.data as { raw: GraphNode }).raw.content)?.mode === 'template'),
                )
                .map((n) => n.id);
          await spawnWithSeedIds(seedIds, selected, selection);
        },

        getInputStartState: (nodeId: string) => getInputStartState(nodeId),

        startInputNode: async (nodeId: string, selection = null, options) => {
          await startInputWithNode(nodeId, selection, options);
        },

        cancelFlow: async (flowId) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }
          try {
            const res = await apiCancelWorkflowFlow(sessionId, flowId);
            if (!res.success) {
              set({ status: statusFromApiErr(res.error) });
              return;
            }
            set((s) =>
              withLiveRuns(s, {
                workflowFlows: upsertManagedFlow(s.workflowFlows, res.data),
                status: { key: 'status.workflow_flow_cancelled', params: { id: flowId } },
              }),
            );
          } catch (errorValue) {
            set({ status: statusFromThrown(errorValue) });
          }
        },

        runFromNode: async (nodeId: string, selection = null, options) => {
          const node = get().nodes.find((entry) => entry.id === nodeId);
          if (!node) {
            return;
          }
          const raw = readRawFlowNode(node);
          if (raw.type === 'managed_flow') {
            await startFlowNode(nodeId);
            return;
          }
          if (raw.type === 'loop') {
            await startControllerNode(nodeId);
            return;
          }
          const plan = planNodeRun(raw, get().liveRuns, toGraphEdgeLinks(get().edges));
          if (plan.mode === 'open') {
            set({
              selected: nodeId,
              selectedIds: [nodeId],
              status: { key: 'status.run', params: { status: raw.status } },
            });
            return;
          }
          if (plan.mode === 'rerun') {
            await rerunWithRunId(plan.runId, raw, selection, plan.selection);
            return;
          }
          if (raw.type !== 'input') {
            const loop = readConnectedLoopRun(nodeId);
            if (loop?.mode === 'ambiguous') {
              set({ status: { key: 'errors.codes.WORKFLOW_LOOP_AMBIGUOUS' } });
              return;
            }
            if (loop?.mode === 'controller') {
              await startControllerNode(loop.nodeId);
              return;
            }
          }
          if (raw.type === 'input') {
            await startInputWithNode(nodeId, selection ?? plan.selection ?? null, options);
            return;
          }
          const seedIds = collectConnectedNodeIds(nodeId, get().edges);
          await spawnWithSeedIds(seedIds, nodeId, selection ?? plan.selection ?? null);
        },

        patchNodeData: async (nodeId, patch) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }

          const current = get().nodes.find((node) => node.id === nodeId);
          if (!current) return;
          const previousNode = current;

          set((s) =>
            withLiveRuns(s, {
              nodes: s.nodes.map((node) => {
                if (node.id !== nodeId) return node;
                const currentRaw = (node.data as { raw: GraphNode }).raw;
                return toFlowNode(mergeNodePatch(currentRaw, patch));
              }),
            }),
          );

          try {
            const res = await patchNode(sessionId, nodeId, patch);
            if (!res.success) {
              set((s) =>
                withLiveRuns(s, {
                  nodes: s.nodes.map((node) => (node.id === nodeId ? previousNode : node)),
                  status: statusFromApiErr(res.error),
                }),
              );
              return;
            }

            set({ lastEventId: res.data.eventId, status: { key: 'status.saved' } });
          } catch (errorValue) {
            set((s) =>
              withLiveRuns(s, {
                nodes: s.nodes.map((node) => (node.id === nodeId ? previousNode : node)),
                status: statusFromThrown(errorValue),
              }),
            );
          }
        },

        updateNodeText: async (nodeId, text) => {
          const sessionId = get().sessionId;
          if (!sessionId) {
            set({ status: { key: 'status.no_active_session' } });
            return;
          }

          const current = get().nodes.find((node) => node.id === nodeId);
          if (!current) return;
          const previousNode = current;

          const raw = (current.data as { raw: GraphNode }).raw;
          const content = buildNodeTextContent(raw, text);

          set((s) =>
            withLiveRuns(s, {
              nodes: s.nodes.map((node) => {
                if (node.id !== nodeId) return node;
                const currentRaw = (node.data as { raw: GraphNode }).raw;
                return toFlowNode(mergeNodePatch(currentRaw, { content }));
              }),
            }),
          );

          try {
            const res = await patchNode(sessionId, nodeId, { content });
            if (!res.success) {
              set((s) =>
                withLiveRuns(s, {
                  nodes: s.nodes.map((node) => (node.id === nodeId ? previousNode : node)),
                  status: statusFromApiErr(res.error),
                }),
              );
              return;
            }

            set({ lastEventId: res.data.eventId, status: { key: 'status.saved' } });
          } catch (errorValue) {
            set((s) =>
              withLiveRuns(s, {
                nodes: s.nodes.map((node) => (node.id === nodeId ? previousNode : node)),
                status: statusFromThrown(errorValue),
              }),
            );
          }
        },

        onNodesChange: async (changes) => {
          const sessionId = get().sessionId;
          if (!sessionId) return;
          for (const c of changes) {
            const nextPosition = c.position;
            if (!nextPosition) continue;
            const previousNode = get().nodes.find((n) => n.id === c.id);
            if (!previousNode) continue;

            set((s) => ({
              nodes: s.nodes.map((n) => (n.id === c.id ? { ...n, position: nextPosition } : n)),
            }));

            try {
              const res = await patchNode(sessionId, c.id, { position: nextPosition });
              if (!res.success) {
                set((s) => ({
                  nodes: s.nodes.map((n) => (n.id === c.id ? previousNode : n)),
                  status: statusFromApiErr(res.error),
                }));
                continue;
              }
              set((s) => ({ lastEventId: Math.max(s.lastEventId, res.data.eventId) }));
            } catch (errorValue) {
              set((s) => ({
                nodes: s.nodes.map((n) => (n.id === c.id ? previousNode : n)),
                status: statusFromThrown(errorValue),
              }));
            }
          }
        },
      };
    },
    {
      name: 'cepage-workspace-v1',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : noopStorage(),
      ),
      partialize: partializeWorkspaceState,
      merge: mergePersistedWorkspaceState,
      onRehydrateStorage: onWorkspaceRehydrate,
    },
  ),
);
