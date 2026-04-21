'use client';

import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type OnSelectionChangeFunc,
  type OnConnectEnd,
  type OnConnectStart,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type { GraphNode } from '@cepage/shared-core';
import { useWorkspaceStore } from '@cepage/state';
import { AgentOutputNode } from './AgentOutputNode';
import { readMergeTargets, readSelectedBranch } from './branch-helpers';
import { arrangeCanvasNodes } from './canvas-layout';
import { CanvasContextMenu } from './CanvasContextMenu';
import { CanvasWorkspacePanel } from './CanvasWorkspacePanel';
import { EditableTextNode } from './EditableTextNode';
import {
  centerNodePosition,
  clampSidebarWidth,
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  getClientPosition,
  isPaneTarget,
} from './canvas-workspace-geometry';
import { readRawNode, mergeFlowEdges, mergeFlowNodes } from './canvas-workspace-merge';
import type { MenuMode, MenuState, SidebarTab } from './canvas-workspace-types';
import { WorkspaceRightSidebar } from './WorkspaceRightSidebar';
import { FileSummaryNode } from './FileSummaryNode';
import { InputNode } from './InputNode';
import { RuntimeRunNode } from './RuntimeRunNode';
import { RuntimeTargetNode } from './RuntimeTargetNode';
import { formatStatusLine } from './formatWorkspace';
import { useI18n } from './I18nProvider';
import { NewSessionFromSkillDialog } from './NewSessionFromSkillDialog';
import { SessionWorkspaceDialog } from './SessionWorkspaceDialog';
import { useCanvasMenuSections } from './useCanvasMenuSections';
import { useResolvedFlowColorMode } from './useResolvedFlowColorMode';
import { buildWorkspaceContentTabs } from './WorkspaceContentTabsPanel';
import { WorkflowCopilotNode } from './WorkflowCopilotNode';
import { WorkspaceFileNode } from './WorkspaceFileNode';

const NODE_TYPES = {
  editableText: EditableTextNode,
  agentOutput: AgentOutputNode,
  inputNode: InputNode,
  workspaceFile: WorkspaceFileNode,
  fileSummary: FileSummaryNode,
  workflowCopilot: WorkflowCopilotNode,
  runtimeTarget: RuntimeTargetNode,
  runtimeRun: RuntimeRunNode,
};
const DEFAULT_BRANCH_COLOR = '#ff8a65';

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function CanvasWorkspace() {
  return (
    <ReactFlowProvider>
      <CanvasWorkspaceInner />
    </ReactFlowProvider>
  );
}

function CanvasWorkspaceInner() {
  const { t, locale } = useI18n();
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const sessionWorkspace = useWorkspaceStore((s) => s.sessionWorkspace);
  const storeNodes = useWorkspaceStore((s) => s.nodes);
  const storeEdges = useWorkspaceStore((s) => s.edges);
  const branches = useWorkspaceStore((s) => s.branches);
  const liveRuns = useWorkspaceStore((s) => s.liveRuns);
  const activeRuns = useWorkspaceStore((s) => s.activeRuns);
  const activeControllers = useWorkspaceStore((s) => s.activeControllers);
  const timeline = useWorkspaceStore((s) => s.timeline);
  const timelineLoading = useWorkspaceStore((s) => s.timelineLoading);
  const timelineHasMore = useWorkspaceStore((s) => s.timelineHasMore);
  const selected = useWorkspaceStore((s) => s.selected);
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const status = useWorkspaceStore((s) => s.status);
  const workspaceDialogOpen = useWorkspaceStore((s) => s.workspaceDialogOpen);
  const workspaceParentDirectoryDraft = useWorkspaceStore((s) => s.workspaceParentDirectoryDraft);
  const workspaceDirectoryNameDraft = useWorkspaceStore((s) => s.workspaceDirectoryNameDraft);
  const pendingSpawn = useWorkspaceStore((s) => s.pendingSpawn);
  const setLocale = useWorkspaceStore((s) => s.setLocale);
  const themeMode = useWorkspaceStore((s) => s.themeMode);
  const themeCepage = useWorkspaceStore((s) => s.themeCepage);
  const setThemeMode = useWorkspaceStore((s) => s.setThemeMode);
  const setThemeCepage = useWorkspaceStore((s) => s.setThemeCepage);
  const flowColorMode = useResolvedFlowColorMode(themeMode);
  const bootstrap = useWorkspaceStore((s) => s.bootstrapNewSession);
  const connectSel = useWorkspaceStore((s) => s.connectSelection);
  const spawn = useWorkspaceStore((s) => s.spawnSelection);
  const createNodeAt = useWorkspaceStore((s) => s.createNodeAt);
  const connectNodes = useWorkspaceStore((s) => s.connectNodes);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const removeEdge = useWorkspaceStore((s) => s.removeEdge);
  const openSessionWorkspaceDialog = useWorkspaceStore((s) => s.openSessionWorkspaceDialog);
  const closeSessionWorkspaceDialog = useWorkspaceStore((s) => s.closeSessionWorkspaceDialog);
  const updateSessionWorkspaceDraft = useWorkspaceStore((s) => s.updateSessionWorkspaceDraft);
  const saveSessionWorkspace = useWorkspaceStore((s) => s.saveSessionWorkspace);
  const browseSessionWorkspaceParentDirectory = useWorkspaceStore(
    (s) => s.browseSessionWorkspaceParentDirectory,
  );
  const openSessionWorkspaceDirectory = useWorkspaceStore((s) => s.openSessionWorkspaceDirectory);
  const setSelectedIds = useWorkspaceStore((s) => s.setSelectedIds);
  const setSelected = useWorkspaceStore((s) => s.setSelected);
  const onPersistMove = useWorkspaceStore((s) => s.onNodesChange);
  const exportWorkflow = useWorkspaceStore((s) => s.exportWorkflow);
  const copyWorkflowExport = useWorkspaceStore((s) => s.copyWorkflowExport);
  const importWorkflow = useWorkspaceStore((s) => s.importWorkflow);
  const createBranchFromNode = useWorkspaceStore((s) => s.createBranchFromNode);
  const mergeBranch = useWorkspaceStore((s) => s.mergeBranch);
  const abandonBranch = useWorkspaceStore((s) => s.abandonBranch);
  const loadMoreTimeline = useWorkspaceStore((s) => s.loadMoreTimeline);

  const statusText = useMemo(() => formatStatusLine(status, t), [status, t]);

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      for (const c of changes) {
        if (c.type === 'remove') {
          void removeNode(c.id);
        }
      }
    },
    [onNodesChange, removeNode],
  );
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [tab, setTab] = useState<SidebarTab>('chat');
  const [branchName, setBranchName] = useState('');
  const [branchColor, setBranchColor] = useState(DEFAULT_BRANCH_COLOR);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState('');
  const [arranging, setArranging] = useState(false);
  const prefsPanelOpen = useWorkspaceStore((s) => s.prefsPanelOpen);
  const setPrefsPanelOpen = useWorkspaceStore((s) => s.setPrefsPanelOpen);
  const pendingSourceRef = useRef<string | null>(null);
  const primaryRef = useRef<string | null>(selected);
  const selectionRef = useRef('');
  const fileRef = useRef<HTMLInputElement>(null);
  const didConnectRef = useRef(false);
  const { fitView, screenToFlowPosition, setCenter } = useReactFlow();

  useEffect(() => {
    setNodes((current) => mergeFlowNodes(current, storeNodes));
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges((current) => mergeFlowEdges(current, storeEdges));
  }, [storeEdges, setEdges]);

  useEffect(() => {
    primaryRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const handleResize = () => {
      setSidebarWidth((current) => clampSidebarWidth(current));
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!sidebarResizing) return;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    const handleMove = (event: MouseEvent) => {
      setSidebarWidth(clampSidebarWidth(window.innerWidth - event.clientX));
    };
    const handleUp = () => {
      setSidebarResizing(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('blur', handleUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('blur', handleUp);
    };
  }, [sidebarResizing]);

  useEffect(() => {
    const ids = new Set(selectedIds);
    setNodes((current) => {
      let dirty = false;
      const next = current.map((node) => {
        const selected = ids.has(node.id);
        if (node.selected === selected) {
          return node;
        }
        dirty = true;
        return { ...node, selected };
      });
      return dirty ? next : current;
    });
  }, [selectedIds, setNodes]);

  const openMenu = useCallback(
    (mode: MenuMode, position: { x: number; y: number }, sourceNodeId: string | null = null) => {
      const flowPosition = screenToFlowPosition(position);
      setMenuState({
        mode,
        x: position.x,
        y: position.y,
        flowPosition: { x: flowPosition.x, y: flowPosition.y },
        sourceNodeId,
      });
    },
    [screenToFlowPosition],
  );

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  const handleNodeDragStop = (_e: unknown, node: { id: string; position: { x: number; y: number } }) => {
    void onPersistMove([{ id: node.id, position: node.position }]);
  };

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      didConnectRef.current = true;
      void connectNodes(connection.source, connection.target);
    },
    [connectNodes],
  );

  const handleConnectStart: OnConnectStart = useCallback((_event, params) => {
    pendingSourceRef.current = params.handleType === 'source' ? params.nodeId : null;
    didConnectRef.current = false;
  }, []);

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      const sourceNodeId = pendingSourceRef.current;
      pendingSourceRef.current = null;

      const didConnect = didConnectRef.current;
      didConnectRef.current = false;

      if (!sourceNodeId || didConnect || connectionState.toNode || !isPaneTarget(event.target)) {
        return;
      }

      const clientPosition = getClientPosition(event);
      if (!clientPosition) return;

      openMenu('edge-drop', clientPosition, sourceNodeId);
    },
    [openMenu],
  );

  const handleEdgesChange = (changes: EdgeChange<Edge>[]) => {
    onEdgesChange(changes);
    for (const change of changes) {
      if (change.type === 'remove') {
        void removeEdge(change.id);
      }
    }
  };

  const handleSelectionChange = useCallback<OnSelectionChangeFunc<FlowNode, Edge>>(
    ({ nodes: next }) => {
      const ids = next.map((node) => node.id);
      const primary = ids.includes(primaryRef.current ?? '')
        ? primaryRef.current
        : (next[next.length - 1]?.id ?? null);
      setSelectedIds(ids, primary);
    },
    [setSelectedIds],
  );

  const handlePaneClick = useCallback(
    (event: ReactMouseEvent) => {
      primaryRef.current = null;
      setSelected(null);

      if (event.detail !== 2) {
        return;
      }

      event.preventDefault();
      openMenu('canvas', { x: event.clientX, y: event.clientY });
    },
    [openMenu, setSelected],
  );

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      primaryRef.current = null;
      setSelected(null);
      openMenu('canvas', { x: event.clientX, y: event.clientY });
    },
    [openMenu, setSelected],
  );

  const handleCreateNode = useCallback(
    async (type: GraphNode['type']) => {
      const current = menuState;
      if (!current) return;

      closeMenu();

      const nodeId = await createNodeAt({
        type,
        position: centerNodePosition(current.flowPosition),
      });
      if (!nodeId) return;

      primaryRef.current = nodeId;
      setSelected(nodeId);

      if (current.sourceNodeId) {
        await connectNodes(current.sourceNodeId, nodeId);
      }
    },
    [closeMenu, connectNodes, createNodeAt, menuState, setSelected],
  );

  const handleCreateHumanMessage = useCallback(() => {
    void handleCreateNode('human_message');
  }, [handleCreateNode]);

  const handleCreateNote = useCallback(() => {
    void handleCreateNode('note');
  }, [handleCreateNode]);

  const handleCreateInput = useCallback(() => {
    void handleCreateNode('input');
  }, [handleCreateNode]);

  const handleCreateAgentStep = useCallback(() => {
    void handleCreateNode('agent_step');
  }, [handleCreateNode]);

  const handleCreateLoop = useCallback(() => {
    void handleCreateNode('loop');
  }, [handleCreateNode]);

  const handleCreateManagedFlow = useCallback(() => {
    void handleCreateNode('managed_flow');
  }, [handleCreateNode]);

  const handleCreateSubgraph = useCallback(() => {
    void handleCreateNode('sub_graph');
  }, [handleCreateNode]);

  const handleCreateDecision = useCallback(() => {
    void handleCreateNode('decision');
  }, [handleCreateNode]);

  const handleCreateWorkspaceFile = useCallback(() => {
    void handleCreateNode('workspace_file');
  }, [handleCreateNode]);

  const handleCreateWorkflowCopilot = useCallback(() => {
    void handleCreateNode('workflow_copilot');
  }, [handleCreateNode]);

  const handleCreateFileSummary = useCallback(() => {
    void handleCreateNode('file_summary');
  }, [handleCreateNode]);

  const handleBootstrap = useCallback(() => {
    closeMenu();
    void bootstrap();
  }, [bootstrap, closeMenu]);

  const handleWorkflowLibrary = useCallback(() => {
    closeMenu();
    window.location.assign('/workflows');
  }, [closeMenu]);

  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const handleNewSessionFromSkill = useCallback(() => {
    closeMenu();
    setSkillPickerOpen(true);
  }, [closeMenu]);

  const handleConnectSelection = useCallback(() => {
    closeMenu();
    void connectSel();
  }, [closeMenu, connectSel]);

  const handleSpawn = useCallback(() => {
    closeMenu();
    void spawn();
  }, [closeMenu, spawn]);

  const handleOpenWorkspaceDialog = useCallback(() => {
    void openSessionWorkspaceDialog();
  }, [openSessionWorkspaceDialog]);

  const handleConfigureWorkspace = useCallback(() => {
    closeMenu();
    void openSessionWorkspaceDialog();
  }, [closeMenu, openSessionWorkspaceDialog]);

  const handleExportWorkflow = useCallback(() => {
    closeMenu();
    void exportWorkflow();
  }, [closeMenu, exportWorkflow]);

  const handleCopyWorkflowExport = useCallback(() => {
    closeMenu();
    void copyWorkflowExport();
  }, [closeMenu, copyWorkflowExport]);

  const handleImportWorkflow = useCallback(() => {
    closeMenu();
    fileRef.current?.click();
  }, [closeMenu]);

  const handleWorkflowFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = '';
      if (!file) return;
      if (!window.confirm(t('ui.menu.importWorkflowConfirm', { name: file.name }))) {
        return;
      }
      void importWorkflow(file);
    },
    [importWorkflow, t],
  );

  const handleWorkspaceParentDirectoryChange = useCallback(
    (value: string) => {
      updateSessionWorkspaceDraft({ parentDirectory: value });
    },
    [updateSessionWorkspaceDraft],
  );

  const handleWorkspaceDirectoryNameChange = useCallback(
    (value: string) => {
      updateSessionWorkspaceDraft({ directoryName: value });
    },
    [updateSessionWorkspaceDraft],
  );

  const handleWorkspaceSave = useCallback(() => {
    void saveSessionWorkspace();
  }, [saveSessionWorkspace]);

  const handleChooseWorkspaceParentDirectory = useCallback(() => {
    void browseSessionWorkspaceParentDirectory();
  }, [browseSessionWorkspaceParentDirectory]);

  const handleOpenWorkspaceDirectory = useCallback(() => {
    void openSessionWorkspaceDirectory();
  }, [openSessionWorkspaceDirectory]);

  const handleArrangeGraph = useCallback(() => {
    if (arranging) {
      return;
    }

    const current = new Map(nodes.map((node) => [node.id, node.position]));
    const changes = arrangeCanvasNodes(nodes, edges).filter((change) => {
      const position = current.get(change.id);
      if (!position) {
        return false;
      }
      return position.x !== change.position.x || position.y !== change.position.y;
    });
    if (changes.length === 0) {
      return;
    }

    const byId = new Map(changes.map((change) => [change.id, change.position]));
    setArranging(true);
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const position = byId.get(node.id);
        if (!position) {
          return node;
        }
        return { ...node, position };
      }),
    );

    window.requestAnimationFrame(() => {
      void fitView({ padding: 0.18 });
    });

    void onPersistMove(changes).finally(() => {
      setArranging(false);
    });
  }, [arranging, edges, fitView, nodes, onPersistMove, setNodes]);

  const handleSidebarResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setSidebarWidth(clampSidebarWidth(window.innerWidth - event.clientX));
    setSidebarResizing(true);
  }, []);

  const hasSession = Boolean(sessionId);
  const hasNodes = storeNodes.length > 0;
  const canArrange = nodes.length > 1;
  const hasHumanNode = storeNodes.some((node) => readRawNode(node).type === 'human_message');
  const contentTabs = useMemo(() => buildWorkspaceContentTabs(storeNodes, selectedIds), [selectedIds, storeNodes]);
  const selectedRawNode = useMemo(() => {
    const selectedNode = storeNodes.find((node) => node.id === selected);
    return selectedNode ? readRawNode(selectedNode) : null;
  }, [selected, storeNodes]);
  const selectedBranch = useMemo(() => readSelectedBranch(branches, branchId), [branchId, branches]);
  const mergeTargets = useMemo(() => readMergeTargets(branches, branchId), [branchId, branches]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = storeNodes.find((entry) => entry.id === nodeId);
      if (!node) return;
      const raw = readRawNode(node);
      primaryRef.current = nodeId;
      setSelected(nodeId);
      void setCenter(raw.position.x + raw.dimensions.width / 2, raw.position.y + raw.dimensions.height / 2, {
        zoom: 0.95,
        duration: 240,
      });
    },
    [setCenter, setSelected, storeNodes],
  );

  useEffect(() => {
    if (!branchId) return;
    if (branches.some((entry) => entry.id === branchId)) return;
    setBranchId(null);
    setTargetId('');
  }, [branchId, branches]);

  useEffect(() => {
    if (!branchId) return;
    if (mergeTargets.some((entry) => entry.id === targetId)) return;
    setTargetId(mergeTargets[0]?.id ?? '');
  }, [branchId, mergeTargets, targetId]);

  useEffect(() => {
    const next = selectedIds.join('\0');
    if (selectionRef.current === next) return;
    selectionRef.current = next;
    if (contentTabs.length > 0) {
      setTab('content');
    }
  }, [contentTabs.length, selectedIds]);

  const handleCreateBranch = useCallback(() => {
    if (!selectedRawNode) return;
    void createBranchFromNode(selectedRawNode.id, {
      name: branchName || undefined,
      color: branchColor || undefined,
    });
    setBranchName('');
  }, [branchColor, branchName, createBranchFromNode, selectedRawNode]);

  const handleMergeBranch = useCallback(() => {
    if (!selectedBranch || !targetId) return;
    void mergeBranch(selectedBranch.id, targetId);
  }, [mergeBranch, selectedBranch, targetId]);

  const handleAbandonBranch = useCallback(() => {
    if (!selectedBranch) return;
    void abandonBranch(selectedBranch.id);
  }, [abandonBranch, selectedBranch]);

  const menuSections = useCanvasMenuSections({
    t,
    menuState,
    hasSession,
    hasNodes,
    hasHumanNode,
    selected,
    selectedCount: selectedIds.length,
    sessionWorkspace,
    onBootstrap: handleBootstrap,
    onNewSessionFromSkill: handleNewSessionFromSkill,
    onWorkflowLibrary: handleWorkflowLibrary,
    onConnectSelection: handleConnectSelection,
    onSpawn: handleSpawn,
    onConfigureWorkspace: handleConfigureWorkspace,
    onExportWorkflow: handleExportWorkflow,
    onCopyWorkflowExport: handleCopyWorkflowExport,
    onImportWorkflow: handleImportWorkflow,
    onCreateHumanMessage: handleCreateHumanMessage,
    onCreateNote: handleCreateNote,
    onCreateInput: handleCreateInput,
    onCreateAgentStep: handleCreateAgentStep,
    onCreateLoop: handleCreateLoop,
    onCreateManagedFlow: handleCreateManagedFlow,
    onCreateSubgraph: handleCreateSubgraph,
    onCreateDecision: handleCreateDecision,
    onCreateWorkspaceFile: handleCreateWorkspaceFile,
    onCreateFileSummary: handleCreateFileSummary,
    onCreateWorkflowCopilot: handleCreateWorkflowCopilot,
  });

  const menuTitle =
    menuState?.mode === 'edge-drop' ? t('ui.menu.edgeTitle') : t('ui.menu.canvasTitle');
  const menuSubtitle =
    menuState?.mode === 'edge-drop'
      ? t('ui.menu.edgeSubtitleSource', {
          id: menuState.sourceNodeId ? shortId(menuState.sourceNodeId) : '',
        })
      : hasSession
      ? t('ui.menu.canvasSubtitleSession')
      : t('ui.menu.canvasSubtitleNoSession');

  const sidebarSize = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        background: 'var(--z-bg-canvas)',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          colorMode={flowColorMode}
          fitView
          minZoom={0.01}
          zoomOnDoubleClick={false}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onNodeDragStop={handleNodeDragStop}
          onSelectionChange={handleSelectionChange}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          onNodeClick={(_, node) => {
            primaryRef.current = node.id;
          }}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
        >
          <CanvasWorkspacePanel
            t={t}
            locale={locale}
            sessionId={sessionId}
            sessionWorkspace={sessionWorkspace}
            statusText={statusText}
            themeMode={themeMode}
            themeCepage={themeCepage}
            prefsPanelOpen={prefsPanelOpen}
            canArrange={canArrange}
            arranging={arranging}
            onArrange={handleArrangeGraph}
            onOpenWorkspaceDialog={handleOpenWorkspaceDialog}
            onOpenWorkspaceDirectory={handleOpenWorkspaceDirectory}
            onPrefsPanelOpenChange={setPrefsPanelOpen}
            onLocaleChange={setLocale}
            onThemeModeChange={setThemeMode}
            onThemeCepageChange={setThemeCepage}
          />
          <MiniMap />
          <Controls position="bottom-left" />
          <Background gap={16} color="var(--z-flow-dot)" />
        </ReactFlow>

        {menuState ? (
          <CanvasContextMenu
            x={menuState.x}
            y={menuState.y}
            title={menuTitle}
            subtitle={menuSubtitle}
            sections={menuSections}
            onClose={closeMenu}
          />
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleWorkflowFileChange}
          style={{ display: 'none' }}
        />

        <SessionWorkspaceDialog
          open={workspaceDialogOpen}
          sessionId={sessionId}
          workspace={sessionWorkspace}
          parentDirectory={workspaceParentDirectoryDraft}
          directoryName={workspaceDirectoryNameDraft}
          pendingRun={pendingSpawn !== null}
          onParentDirectoryChange={handleWorkspaceParentDirectoryChange}
          onDirectoryNameChange={handleWorkspaceDirectoryNameChange}
          onChooseParentDirectory={handleChooseWorkspaceParentDirectory}
          onClose={closeSessionWorkspaceDialog}
          onSave={handleWorkspaceSave}
        />

        <NewSessionFromSkillDialog
          open={skillPickerOpen}
          onClose={() => setSkillPickerOpen(false)}
          onCreated={(result) => {
            setSkillPickerOpen(false);
            if (typeof window !== 'undefined') {
              window.location.assign(`/?session=${encodeURIComponent(result.sessionId)}`);
            }
          }}
        />
      </div>

      <WorkspaceRightSidebar
        t={t}
        sessionId={sessionId}
        sidebarCollapsed={sidebarCollapsed}
        sidebarSize={sidebarSize}
        sidebarResizing={sidebarResizing}
        tab={tab}
        contentTabs={contentTabs}
        branches={branches}
        selectedRawNode={selectedRawNode}
        selectedNodeId={selected}
        branchName={branchName}
        branchColor={branchColor}
        branchId={branchId}
        targetId={targetId}
        selectedBranch={selectedBranch}
        mergeTargets={mergeTargets}
        activeRuns={activeRuns}
        activeControllers={activeControllers}
        liveRuns={liveRuns}
        nodes={storeNodes}
        timeline={timeline}
        timelineLoading={timelineLoading}
        timelineHasMore={timelineHasMore}
        onResizeStart={handleSidebarResizeStart}
        onCollapseChange={setSidebarCollapsed}
        onTabChange={setTab}
        onBranchNameChange={setBranchName}
        onBranchColorChange={setBranchColor}
        onBranchSelect={(nextBranchId, headNodeId) => {
          setBranchId(nextBranchId);
          focusNode(headNodeId);
        }}
        onCreateBranch={handleCreateBranch}
        onTargetChange={setTargetId}
        onMergeBranch={handleMergeBranch}
        onAbandonBranch={handleAbandonBranch}
        onLoadMoreTimeline={() => {
          void loadMoreTimeline();
        }}
        onFocusNode={focusNode}
        onSelectNode={setSelected}
      />
    </div>
  );
}
