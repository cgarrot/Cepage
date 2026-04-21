'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, type ImperativePanelHandle } from 'react-resizable-panels';
import { useWorkspaceStore } from '@cepage/state';
import { SessionWorkspaceDialog } from '../SessionWorkspaceDialog';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatTranscript } from './ChatTranscript';
import { Resizer } from './Resizer';
import { SessionsSidebar } from './SessionsSidebar';
import { WorkspaceFilesPanel } from './WorkspaceFilesPanel';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { ChatShellProps } from './types';

const FILES_PREF_KEY = 'cepage:chat-shell:files';
const SIDEBAR_PREF_KEY = 'cepage:chat-shell:sidebar';

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {
    /* noop */
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* noop */
  }
}

/**
 * IDE-style three-pane chat: sessions sidebar, central tabbed transcript /
 * file viewer with the composer pinned at the bottom of the chat tab, and a
 * togglable workspace file panel on the right. Panels are resizable through
 * `react-resizable-panels` and remember their layout via `autoSaveId`.
 */
export function ChatShell({ onOpenStudio }: ChatShellProps) {
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const workspaceDialogOpen = useWorkspaceStore((s) => s.workspaceDialogOpen);
  const sessionWorkspace = useWorkspaceStore((s) => s.sessionWorkspace);
  const workspaceParentDirectoryDraft = useWorkspaceStore((s) => s.workspaceParentDirectoryDraft);
  const workspaceDirectoryNameDraft = useWorkspaceStore((s) => s.workspaceDirectoryNameDraft);
  const pendingSpawn = useWorkspaceStore((s) => s.pendingSpawn);
  const openWorkspaceDialog = useWorkspaceStore((s) => s.openSessionWorkspaceDialog);
  const closeWorkspaceDialog = useWorkspaceStore((s) => s.closeSessionWorkspaceDialog);
  const updateWorkspaceDraft = useWorkspaceStore((s) => s.updateSessionWorkspaceDraft);
  const saveWorkspace = useWorkspaceStore((s) => s.saveSessionWorkspace);
  const browseWorkspaceParentDirectory = useWorkspaceStore((s) => s.browseSessionWorkspaceParentDirectory);
  const copilotThread = useWorkspaceStore((s) => s.workflowCopilotThread);
  const copilotLoading = useWorkspaceStore((s) => s.workflowCopilotLoading);
  const ensureCopilotThread = useWorkspaceStore((s) => s.ensureWorkflowCopilotThread);

  const [filesOpen, setFilesOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const filesPanelRef = useRef<ImperativePanelHandle | null>(null);

  useEffect(() => {
    setFilesOpen(readBool(FILES_PREF_KEY, true));
    setSidebarCollapsed(readBool(SIDEBAR_PREF_KEY, false));
  }, []);

  // Ensure the unified Copilot thread is loaded for the current session as
  // soon as the chat opens. Without this, the transcript never receives
  // copilot messages or checkpoints (they are only fetched implicitly when
  // the user sends the first message), so existing conversations resumed
  // from the sidebar would appear empty until a new send was triggered.
  useEffect(() => {
    if (!sessionId) return;
    if (copilotLoading) return;
    if (
      copilotThread &&
      copilotThread.sessionId === sessionId &&
      copilotThread.surface === 'sidebar'
    ) {
      return;
    }
    void ensureCopilotThread({ surface: 'sidebar' });
  }, [
    sessionId,
    copilotThread?.id,
    copilotThread?.sessionId,
    copilotThread?.surface,
    copilotLoading,
    ensureCopilotThread,
  ]);

  // Keep three <Panel> nodes mounted at all times; toggling the files rail uses
  // collapse/expand so persisted layout length always matches panel count (avoids
  // react-resizable-panels "Panel data not found for index 2").
  useEffect(() => {
    const panel = filesPanelRef.current;
    if (!panel) return;
    if (filesOpen) panel.expand(18);
    else panel.collapse();
  }, [filesOpen]);

  const toggleFiles = useCallback(() => {
    setFilesOpen((value) => {
      writeBool(FILES_PREF_KEY, !value);
      return !value;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((value) => {
      writeBool(SIDEBAR_PREF_KEY, !value);
      return !value;
    });
  }, []);

  const onConfigureWorkspace = useCallback(() => {
    void openWorkspaceDialog();
  }, [openWorkspaceDialog]);

  // IDE-style global shortcuts. We intentionally restrict to Cmd/Ctrl+B
  // (sidebar) and Cmd/Ctrl+J (workspace files panel) to mirror VS Code /
  // Cursor and avoid colliding with browser defaults like Cmd/Ctrl+K.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent) => {
      const cmd = event.metaKey || event.ctrlKey;
      if (!cmd) return;
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        toggleFiles();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleFiles, toggleSidebar]);

  const autoSaveId = `cepage-chat-shell-v3:${sidebarCollapsed ? 'narrow' : 'wide'}`;

  const chatColumn = (
    <div style={chatColumnStyle}>
      <ChatHeader
        onOpenStudio={() => onOpenStudio()}
        onConfigureWorkspace={onConfigureWorkspace}
        onToggleFiles={toggleFiles}
        filesOpen={filesOpen}
      />
      <ChatTranscript onOpenStudio={onOpenStudio} />
      <ChatComposer />
    </div>
  );

  return (
    <div style={shellStyle}>
      <PanelGroup direction="horizontal" autoSaveId={autoSaveId} style={{ height: '100vh', width: '100%' }}>
        <Panel
          defaultSize={sidebarCollapsed ? 4 : 18}
          minSize={sidebarCollapsed ? 4 : 12}
          maxSize={sidebarCollapsed ? 6 : 30}
          collapsible
        >
          <SessionsSidebar collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} />
        </Panel>
        <Resizer />
        <Panel defaultSize={filesOpen ? 56 : 82} minSize={30}>
          <WorkspaceTabs chat={chatColumn} onOpenStudio={onOpenStudio} />
        </Panel>
        <Resizer />
        <Panel
          ref={filesPanelRef}
          defaultSize={26}
          minSize={18}
          maxSize={48}
          collapsible
          collapsedSize={0}
        >
          <WorkspaceFilesPanel onOpenStudio={onOpenStudio} onClose={toggleFiles} />
        </Panel>
      </PanelGroup>

      <SessionWorkspaceDialog
        open={workspaceDialogOpen}
        sessionId={sessionId}
        workspace={sessionWorkspace}
        parentDirectory={workspaceParentDirectoryDraft}
        directoryName={workspaceDirectoryNameDraft}
        pendingRun={Boolean(pendingSpawn)}
        onParentDirectoryChange={(value) => updateWorkspaceDraft({ parentDirectory: value })}
        onDirectoryNameChange={(value) => updateWorkspaceDraft({ directoryName: value })}
        onChooseParentDirectory={() => void browseWorkspaceParentDirectory()}
        onClose={closeWorkspaceDialog}
        onSave={() => void saveWorkspace()}
      />
    </div>
  );
}

const shellStyle = {
  display: 'flex',
  alignItems: 'stretch',
  width: '100%',
  minHeight: '100vh',
  maxHeight: '100vh',
  background: 'var(--z-bg-app)',
  color: 'var(--z-fg)',
  overflow: 'hidden',
} as const;

const chatColumnStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column' as const,
  minWidth: 0,
  minHeight: 0,
  background: 'var(--z-bg-app)',
} as const;
