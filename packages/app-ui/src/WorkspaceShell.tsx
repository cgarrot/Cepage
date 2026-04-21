'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '@cepage/state';
import { Button } from '@cepage/ui-kit';
import { CanvasWorkspace } from './CanvasWorkspace';
import { ChatShell } from './chat-shell';
import { useI18n } from './I18nProvider';

type WorkspaceView = 'simple' | 'studio';
type WorkspaceOpenStudioInput = {
  selectedNodeId?: string;
};

function readWorkspaceView(): WorkspaceView {
  if (typeof window === 'undefined') return 'simple';
  const view = new URLSearchParams(window.location.search).get('view');
  return view === 'studio' ? 'studio' : 'simple';
}

function readWorkspaceSelectedNode(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('selected');
  return id?.trim() || null;
}

function writeWorkspaceView(view: WorkspaceView, selectedNodeId?: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (view === 'studio') {
    url.searchParams.set('view', 'studio');
  } else {
    url.searchParams.delete('view');
  }
  if (selectedNodeId?.trim()) {
    url.searchParams.set('selected', selectedNodeId.trim());
  } else {
    url.searchParams.delete('selected');
  }
  window.history.replaceState({}, '', url);
}

export function WorkspaceShell() {
  const { t } = useI18n();
  const [view, setView] = useState<WorkspaceView>('simple');
  const selected = useWorkspaceStore((s) => s.selected);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const setSelected = useWorkspaceStore((s) => s.setSelected);

  useEffect(() => {
    const sync = () => {
      setView(readWorkspaceView());
    };

    sync();
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
    };
  }, []);

  useEffect(() => {
    if (view !== 'simple' || !selected) return;
    const node = nodes.find((entry) => entry.id === selected);
    const raw =
      node?.data && typeof node.data === 'object'
        ? (node.data as { raw?: { type?: string } }).raw
        : undefined;
    if (raw?.type === 'workflow_copilot') {
      setSelected(null);
    }
  }, [nodes, selected, setSelected, view]);

  useEffect(() => {
    if (view !== 'studio') return;
    const targetId = readWorkspaceSelectedNode();
    if (!targetId) return;
    if (!nodes.some((entry) => entry.id === targetId)) return;
    if (selected !== targetId) {
      setSelected(targetId);
    }
    writeWorkspaceView('studio');
  }, [nodes, selected, setSelected, view]);

  const openSimple = useCallback(() => {
    writeWorkspaceView('simple');
    setView('simple');
  }, []);

  const openStudio = useCallback((input?: WorkspaceOpenStudioInput) => {
    writeWorkspaceView('studio', input?.selectedNodeId);
    setView('studio');
  }, []);

  if (view === 'simple') {
    return <ChatShell onOpenStudio={openStudio} />;
  }

  return (
    <div style={studioShellStyle}>
      <div style={studioToggleStyle}>
        <Button
          onClick={openSimple}
          style={{
            border: '1px solid var(--z-border)',
            background: 'var(--z-bg-panel)',
            color: 'var(--z-fg)',
            boxShadow: 'var(--z-bg-panel-shadow)',
          }}
        >
          {t('ui.simple.backToSimple')}
        </Button>
      </div>
      <CanvasWorkspace />
    </div>
  );
}

const studioShellStyle = {
  position: 'relative' as const,
  minHeight: '100vh',
};

const studioToggleStyle = {
  position: 'absolute' as const,
  top: 16,
  right: 16,
  zIndex: 10,
};
