import { useMemo } from 'react';
import type { SessionWorkspace } from '@cepage/shared-core';
import { type CanvasContextMenuSection } from './CanvasContextMenu';
import type { MenuState } from './canvas-workspace-types';
import { useI18n } from './I18nProvider';

type UseCanvasMenuSectionsProps = {
  t: ReturnType<typeof useI18n>['t'];
  menuState: MenuState | null;
  hasSession: boolean;
  hasNodes: boolean;
  hasHumanNode: boolean;
  selected: string | null;
  selectedCount: number;
  sessionWorkspace: SessionWorkspace | null;
  onBootstrap: () => void;
  onNewSessionFromSkill: () => void;
  onWorkflowLibrary: () => void;
  onConnectSelection: () => void;
  onSpawn: () => void;
  onConfigureWorkspace: () => void;
  onExportWorkflow: () => void;
  onCopyWorkflowExport: () => void;
  onImportWorkflow: () => void;
  onCreateHumanMessage: () => void;
  onCreateNote: () => void;
  onCreateInput: () => void;
  onCreateAgentStep: () => void;
  onCreateLoop: () => void;
  onCreateManagedFlow: () => void;
  onCreateSubgraph: () => void;
  onCreateDecision: () => void;
  onCreateWorkspaceFile: () => void;
  onCreateFileSummary: () => void;
  onCreateWorkflowCopilot: () => void;
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function useCanvasMenuSections({
  t,
  menuState,
  hasSession,
  hasNodes,
  hasHumanNode,
  selected,
  selectedCount,
  sessionWorkspace,
  onBootstrap,
  onNewSessionFromSkill,
  onWorkflowLibrary,
  onConnectSelection,
  onSpawn,
  onConfigureWorkspace,
  onExportWorkflow,
  onCopyWorkflowExport,
  onImportWorkflow,
  onCreateHumanMessage,
  onCreateNote,
  onCreateInput,
  onCreateAgentStep,
  onCreateLoop,
  onCreateManagedFlow,
  onCreateSubgraph,
  onCreateDecision,
  onCreateWorkspaceFile,
  onCreateFileSummary,
  onCreateWorkflowCopilot,
}: UseCanvasMenuSectionsProps): CanvasContextMenuSection[] {
  return useMemo<CanvasContextMenuSection[]>(() => {
    if (!menuState) return [];

    const createItems = [
      {
        id: 'create-human-message',
        label: t('ui.menu.humanMessage'),
        description:
          menuState.mode === 'edge-drop' ? t('ui.menu.humanMessageDescEdge') : t('ui.menu.humanMessageDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateHumanMessage,
      },
      {
        id: 'create-note',
        label: t('ui.menu.note'),
        description:
          menuState.mode === 'edge-drop' ? t('ui.menu.noteDescEdge') : t('ui.menu.noteDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateNote,
      },
      {
        id: 'create-input',
        label: t('ui.menu.input'),
        description:
          menuState.mode === 'edge-drop' ? t('ui.menu.inputDescEdge') : t('ui.menu.inputDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateInput,
      },
      {
        id: 'create-agent-step',
        label: t('ui.menu.agentStep'),
        description:
          menuState.mode === 'edge-drop'
            ? t('ui.menu.agentStepDescEdge')
            : t('ui.menu.agentStepDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateAgentStep,
      },
      {
        id: 'create-loop',
        label: t('ui.menu.loop'),
        description:
          menuState.mode === 'edge-drop' ? t('ui.menu.loopDescEdge') : t('ui.menu.loopDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateLoop,
      },
      {
        id: 'create-managed-flow',
        label: t('ui.menu.managedFlow'),
        description:
          menuState.mode === 'edge-drop'
            ? t('ui.menu.managedFlowDescEdge')
            : t('ui.menu.managedFlowDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateManagedFlow,
      },
      {
        id: 'create-sub-graph',
        label: t('ui.menu.subGraph'),
        description:
          menuState.mode === 'edge-drop' ? t('ui.menu.subGraphDescEdge') : t('ui.menu.subGraphDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateSubgraph,
      },
      {
        id: 'create-decision',
        label: t('ui.menu.validator'),
        description:
          menuState.mode === 'edge-drop' ? t('ui.menu.validatorDescEdge') : t('ui.menu.validatorDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateDecision,
      },
      {
        id: 'create-workspace-file',
        label: t('ui.menu.workspaceFile'),
        description:
          menuState.mode === 'edge-drop'
            ? t('ui.menu.workspaceFileDescEdge')
            : t('ui.menu.workspaceFileDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateWorkspaceFile,
      },
      {
        id: 'create-file-summary',
        label: t('ui.menu.fileSummary'),
        description:
          menuState.mode === 'edge-drop'
            ? t('ui.menu.fileSummaryDescEdge')
            : t('ui.menu.fileSummaryDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateFileSummary,
      },
      {
        id: 'create-workflow-copilot',
        label: t('ui.menu.workflowCopilot'),
        description:
          menuState.mode === 'edge-drop'
            ? t('ui.menu.workflowCopilotDescEdge')
            : t('ui.menu.workflowCopilotDescCanvas'),
        disabled: !hasSession,
        onSelect: onCreateWorkflowCopilot,
      },
    ];

    if (menuState.mode === 'edge-drop') {
      return [
        {
          id: 'create-linked',
          label: t('ui.menu.createLinked'),
          items: createItems,
        },
      ];
    }

    return [
      {
        id: 'create-here',
        label: t('ui.menu.createHere'),
        items: createItems,
      },
      {
        id: 'canvas-actions',
        label: t('ui.menu.actions'),
        items: [
          {
            id: 'new-session',
            label: t('ui.menu.newSession'),
            description: t('ui.menu.newSessionDesc'),
            onSelect: onBootstrap,
          },
          {
            id: 'new-session-from-skill',
            label: t('ui.library.newFromSkill'),
            description: t('ui.skillPicker.desc'),
            onSelect: onNewSessionFromSkill,
          },
          {
            id: 'workflow-library',
            label: t('ui.menu.workflowLibrary'),
            description: t('ui.menu.workflowLibraryDesc'),
            onSelect: onWorkflowLibrary,
          },
          {
            id: 'link-selection',
            label: t('ui.menu.linkSelection'),
            description: selectedCount > 1
              ? t('ui.menu.linkSelectionDescMany', { count: selectedCount })
              : selected
                ? t('ui.menu.linkSelectionDesc', { id: shortId(selected) })
                : t('ui.menu.linkSelectionDescNoSelect'),
            disabled: !hasSession || selectedCount === 0 || !hasHumanNode,
            onSelect: onConnectSelection,
          },
          {
            id: 'spawn-opencode',
            label: t('ui.menu.spawnOpenCode'),
            description: t('ui.menu.spawnOpenCodeDesc'),
            disabled: !hasSession || !hasNodes,
            onSelect: onSpawn,
          },
          {
            id: 'configure-workspace',
            label: sessionWorkspace ? t('ui.menu.editSessionWorkspace') : t('ui.menu.configureWorkspace'),
            description: sessionWorkspace
              ? sessionWorkspace.workingDirectory
              : t('ui.menu.workspacePickerDesc'),
            onSelect: onConfigureWorkspace,
          },
          {
            id: 'export-workflow',
            label: t('ui.menu.exportWorkflow'),
            description: t('ui.menu.exportWorkflowDesc'),
            disabled: !hasSession,
            onSelect: onExportWorkflow,
          },
          {
            id: 'copy-workflow',
            label: t('ui.menu.copyWorkflow'),
            description: t('ui.menu.copyWorkflowDesc'),
            disabled: !hasSession,
            onSelect: onCopyWorkflowExport,
          },
          {
            id: 'import-workflow',
            label: t('ui.menu.importWorkflow'),
            description: t('ui.menu.importWorkflowDesc'),
            disabled: !hasSession,
            onSelect: onImportWorkflow,
          },
        ],
      },
    ];
  }, [
    hasHumanNode,
    hasNodes,
    hasSession,
    menuState,
    onBootstrap,
    onConfigureWorkspace,
    onConnectSelection,
    onCopyWorkflowExport,
    onCreateAgentStep,
    onCreateDecision,
    onCreateFileSummary,
    onCreateHumanMessage,
    onCreateInput,
    onCreateLoop,
    onCreateManagedFlow,
    onCreateNote,
    onCreateSubgraph,
    onCreateWorkflowCopilot,
    onCreateWorkspaceFile,
    onExportWorkflow,
    onImportWorkflow,
    onSpawn,
    onWorkflowLibrary,
    selected,
    selectedCount,
    sessionWorkspace,
    t,
  ]);
}
