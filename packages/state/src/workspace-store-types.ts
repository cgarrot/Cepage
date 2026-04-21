import type { Edge, Node } from '@xyflow/react';
import type {
  AgentCatalog,
  AgentRun,
  Branch,
  GraphNode,
  SessionWorkspace,
  WorkflowCopilotAttachment,
  WorkflowCopilotCheckpoint,
  WorkflowCopilotEnsureThread,
  WorkflowCopilotMessage,
  WorkflowCopilotMode,
  WorkflowCopilotScope,
  WorkflowCopilotThread,
  WorkflowCopilotThreadPatch,
  WorkflowControllerState,
  WorkflowExecution,
  WorkflowManagedFlowState,
} from '@cepage/shared-core';
import type { Socket } from 'socket.io-client';
import type { WorkflowControllerIndex } from './live';
import type { LiveRunDescriptor, StatusDescriptor, ActivityLine } from './workspace-types';
import type { AgentRunSelection } from './workspace-agent-selection';
import type { InputTemplateStartOptions, InputTemplateStartState } from './workflow-input-start';
import type { WorkflowManagedFlowIndex } from './workflow-managed-flow';
import type { WorkspaceTabsBySession } from './workspace-tabs';

export type AgentRunIndex = Record<string, AgentRun>;
export type WorkflowExecutionIndex = Record<string, WorkflowExecution>;

export type CreateNodeAtInput = {
  type: GraphNode['type'];
  position: { x: number; y: number };
  content?: GraphNode['content'];
};

export type InputStartOptions = InputTemplateStartOptions;

export type PendingSpawn =
  | {
      kind: 'spawn';
      seedNodeIds: string[];
      triggerNodeId: string | null;
      selection?: AgentRunSelection;
    }
  | {
      kind: 'controller_start';
      nodeId: string;
    }
  | {
      kind: 'input_start';
      nodeId: string;
      selection?: AgentRunSelection;
      options?: InputStartOptions;
    };

export type WorkspaceState = {
  locale: import('@cepage/i18n').Locale;
  themeMode: import('./theme').ThemeMode;
  themeCepage: import('./theme').ThemeCepage;
  sessionId: string | null;
  sessionWorkspace: SessionWorkspace | null;
  agentCatalog: AgentCatalog['providers'];
  agentCatalogLoading: boolean;
  lastRunSelection: AgentRunSelection | null;
  lastEventId: number;
  nodes: Node[];
  edges: Edge[];
  branches: Branch[];
  agentRuns: AgentRunIndex;
  workflowExecutions: WorkflowExecutionIndex;
  workflowControllers: WorkflowControllerIndex;
  workflowFlows: WorkflowManagedFlowIndex;
  liveRuns: LiveRunDescriptor[];
  activeRuns: LiveRunDescriptor[];
  activeControllers: WorkflowControllerState[];
  activeFlows: WorkflowManagedFlowState[];
  activity: ActivityLine[];
  timeline: ActivityLine[];
  timelineLoading: boolean;
  timelineCursor: string | null;
  timelineHasMore: boolean;
  selected: string | null;
  selectedIds: string[];
  socket: Socket | null;
  activeSpawnRequestId: string | null;
  pendingSpawn: PendingSpawn | null;
  workspaceDialogOpen: boolean;
  workspaceParentDirectoryDraft: string;
  workspaceDirectoryNameDraft: string;
  status: StatusDescriptor | null;
  workflowCopilotThread: WorkflowCopilotThread | null;
  workflowCopilotMessages: WorkflowCopilotMessage[];
  workflowCopilotCheckpoints: WorkflowCopilotCheckpoint[];
  workflowCopilotLoading: boolean;
  workflowCopilotSending: boolean;
  workflowCopilotStopping: boolean;
  workflowCopilotApplyingMessageId: string | null;
  workflowCopilotRestoringCheckpointId: string | null;
  workflowCopilotContextAccepted: boolean;
  workflowCopilotDrafts: Record<string, string>;
  workspaceTabs: WorkspaceTabsBySession;
  setLocale: (locale: import('@cepage/i18n').Locale) => void;
  setThemeMode: (mode: import('./theme').ThemeMode) => void;
  setThemeCepage: (cepage: import('./theme').ThemeCepage) => void;
  setLastRunSelection: (selection: AgentRunSelection | null) => void;
  prefsPanelOpen: boolean;
  setPrefsPanelOpen: (open: boolean) => void;
  connectRealtime: () => void;
  bootstrapNewSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  exportWorkflow: () => Promise<boolean>;
  copyWorkflowExport: () => Promise<boolean>;
  importWorkflow: (file: File) => Promise<boolean>;
  createNodeAt: (input: CreateNodeAtInput) => Promise<string | null>;
  openSessionWorkspaceDialog: () => Promise<void>;
  closeSessionWorkspaceDialog: () => void;
  updateSessionWorkspaceDraft: (patch: {
    parentDirectory?: string;
    directoryName?: string;
  }) => void;
  saveSessionWorkspace: () => Promise<boolean>;
  browseSessionWorkspaceParentDirectory: () => Promise<void>;
  openSessionWorkspaceDirectory: () => Promise<void>;
  refreshAgentCatalog: () => Promise<AgentCatalog['providers']>;
  addHumanMessage: (text: string) => Promise<void>;
  createBranchFromNode: (nodeId: string, input?: { name?: string; color?: string }) => Promise<void>;
  mergeBranch: (sourceBranchId: string, targetBranchId: string) => Promise<void>;
  abandonBranch: (branchId: string) => Promise<void>;
  loadMoreTimeline: () => Promise<void>;
  connectNodes: (sourceId: string, targetId: string) => Promise<void>;
  removeNode: (nodeId: string) => Promise<void>;
  removeEdge: (edgeId: string) => Promise<void>;
  connectSelection: () => Promise<void>;
  spawnSelection: (selection?: AgentRunSelection | null) => Promise<void>;
  runFromNode: (
    nodeId: string,
    selection?: AgentRunSelection | null,
    options?: InputStartOptions,
  ) => Promise<void>;
  getInputStartState: (nodeId: string) => InputTemplateStartState | null;
  startInputNode: (
    nodeId: string,
    selection?: AgentRunSelection | null,
    options?: InputStartOptions,
  ) => Promise<void>;
  cancelFlow: (flowId: string) => Promise<void>;
  ensureWorkflowCopilotThread: (input: WorkflowCopilotEnsureThread) => Promise<void>;
  patchWorkflowCopilotThread: (patch: WorkflowCopilotThreadPatch) => Promise<void>;
  sendWorkflowCopilotMessage: (content: string, input?: {
    scope?: WorkflowCopilotScope;
    mode?: WorkflowCopilotMode;
    selection?: AgentRunSelection | null;
    autoApply?: boolean;
    autoRun?: boolean;
    attachments?: WorkflowCopilotAttachment[];
  }) => Promise<void>;
  stopWorkflowCopilot: () => Promise<void>;
  applyWorkflowCopilotMessage: (messageId: string) => Promise<void>;
  restoreWorkflowCopilotCheckpoint: (checkpointId: string) => Promise<void>;
  updateFileSummarySelection: (nodeId: string, selection: AgentRunSelection) => Promise<void>;
  uploadFilesToNode: (nodeId: string, files: File[]) => Promise<void>;
  summarizeFileNode: (nodeId: string, selection?: AgentRunSelection | null) => Promise<void>;
  patchNodeData: (
    nodeId: string,
    patch: Partial<Pick<GraphNode, 'content' | 'metadata' | 'status' | 'position' | 'branches'>>,
  ) => Promise<void>;
  updateNodeText: (nodeId: string, text: string) => Promise<void>;
  onNodesChange: (changes: { id: string; position?: { x: number; y: number } }[]) => Promise<void>;
  setSelectedIds: (ids: ReadonlyArray<string>, primaryId?: string | null) => void;
  setSelected: (id: string | null) => void;
  acceptWorkflowCopilotContext: () => void;
  setWorkflowCopilotDraft: (key: string | null, value: string) => void;
  openWorkspaceFile: (input: { path: string; title?: string }) => string | null;
  closeWorkspaceFile: (tabId: string) => void;
  setActiveWorkspaceTab: (tabId: string) => void;
};
