'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  IconButton,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconSearch,
  IconX,
  Tooltip,
} from '@cepage/ui-kit';
import {
  selectWorkspaceFilesView,
  useWorkspaceStore,
  type WorkspaceFileEntry,
  type WorkspaceFileTreeNode,
} from '@cepage/state';
import { useI18n } from '../I18nProvider';
import { toRawGraphNodes, type ChatShellOpenStudioInput } from './types';

type WorkspaceFilesPanelProps = {
  onOpenStudio: (input?: ChatShellOpenStudioInput) => void;
  onClose?: () => void;
};

/**
 * Right rail listing every workspace file the agents declared so far.
 * Files are grouped by folder; clicking a file opens it as a new tab in the
 * main chat area through the workspace store.
 */
export function WorkspaceFilesPanel({ onClose }: WorkspaceFilesPanelProps) {
  const { t } = useI18n();
  const storeNodes = useWorkspaceStore((s) => s.nodes);
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile);
  const tabs = useWorkspaceStore((s) =>
    sessionId ? s.workspaceTabs[sessionId] ?? null : null,
  );
  const rawNodes = useMemo(() => toRawGraphNodes(storeNodes), [storeNodes]);
  const view = useMemo(() => selectWorkspaceFilesView(rawNodes), [rawNodes]);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return view.entries;
    return view.entries.filter(
      (entry) =>
        entry.path.toLowerCase().includes(q) || entry.title.toLowerCase().includes(q),
    );
  }, [filter, view.entries]);

  const tree = useMemo(() => {
    if (!filter.trim()) return view.tree;
    return null;
  }, [filter, view.tree]);

  const onPick = useCallback(
    (file: WorkspaceFileEntry) => {
      openWorkspaceFile({ path: file.path, title: file.title });
    },
    [openWorkspaceFile],
  );

  const activeId = tabs?.activeId ?? null;

  return (
    <aside style={shellStyle}>
      <header style={headerStyle}>
        <div style={titleStyle}>{t('ui.files.title')}</div>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <Badge tone="info" outline>
            {t('ui.files.count', { count: String(view.entries.length) })}
          </Badge>
          {onClose ? (
            <Tooltip label={t('ui.chat.filesHide')} side="bottom">
              <IconButton size={26} label={t('ui.chat.filesHide')} onClick={onClose}>
                <IconX size={14} />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <div style={searchStyle}>
        <IconSearch size={12} color="var(--z-fg-muted)" />
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('ui.files.searchPlaceholder')}
          style={searchInputStyle}
          aria-label={t('ui.files.searchPlaceholder')}
        />
      </div>

      {view.entries.length === 0 ? (
        <div style={emptyStyle}>{t('ui.files.empty')}</div>
      ) : tree ? (
        <div style={listStyle}>
          {tree.map((node) => (
            <FileTreeBranch
              key={node.path}
              node={node}
              activeId={activeId}
              onSelect={onPick}
            />
          ))}
        </div>
      ) : (
        <div style={listStyle}>
          {filtered.length === 0 ? (
            <div style={emptyStyle}>{t('ui.files.noMatch')}</div>
          ) : (
            filtered.map((entry) => (
              <FlatFileRow
                key={entry.id}
                entry={entry}
                activeId={activeId}
                onSelect={onPick}
              />
            ))
          )}
        </div>
      )}
    </aside>
  );
}

type BranchProps = {
  node: WorkspaceFileTreeNode;
  activeId: string | null;
  onSelect: (file: WorkspaceFileEntry) => void;
  depth?: number;
};

function FileTreeBranch({ node, activeId, onSelect, depth = 0 }: BranchProps) {
  const [open, setOpen] = useState(true);
  if (node.kind === 'file') {
    return (
      <FileTreeRow
        entry={node.entry}
        name={node.name}
        depth={depth}
        activeId={activeId}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          paddingLeft: 8 + depth * 12,
          borderRadius: 8,
          border: '1px solid transparent',
          background: 'transparent',
          color: 'var(--z-fg-muted)',
          fontSize: 12,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        {open ? <IconFolderOpen size={12} /> : <IconFolder size={12} />}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name}
        </span>
      </button>
      {open
        ? node.children.map((child) => (
            <FileTreeBranch
              key={child.path}
              node={child}
              activeId={activeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  );
}

type FileRowProps = {
  entry: WorkspaceFileEntry;
  name: string;
  depth: number;
  activeId: string | null;
  onSelect: (file: WorkspaceFileEntry) => void;
};

function FileTreeRow({ entry, name, depth, activeId, onSelect }: FileRowProps) {
  const tabIdForEntry = `file:${entry.path}`;
  const active = activeId?.endsWith(`:${entry.path}`) ?? false;
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      title={entry.path}
      data-tab-id={tabIdForEntry}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        paddingLeft: 8 + depth * 12,
        borderRadius: 8,
        border: '1px solid transparent',
        background: active ? 'var(--z-accent-soft)' : 'transparent',
        color: 'var(--z-fg)',
        fontSize: 12.5,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <IconFile size={12} color="var(--z-fg-muted)" />
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}
      >
        {name}
      </span>
      {entry.change ? <ChangeMark change={entry.change} /> : null}
    </button>
  );
}

function FlatFileRow({
  entry,
  activeId,
  onSelect,
}: {
  entry: WorkspaceFileEntry;
  activeId: string | null;
  onSelect: (file: WorkspaceFileEntry) => void;
}) {
  const active = activeId?.endsWith(`:${entry.path}`) ?? false;
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      title={entry.path}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: active ? 'var(--z-accent-soft)' : 'transparent',
        color: 'var(--z-fg)',
        fontSize: 12.5,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <IconFile size={12} color="var(--z-fg-muted)" />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entry.title}
        </span>
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--z-fg-muted)',
            fontSize: 11,
          }}
        >
          {entry.path}
        </span>
      </span>
      {entry.change ? <ChangeMark change={entry.change} /> : null}
    </button>
  );
}

function ChangeMark({ change }: { change: WorkspaceFileEntry['change'] }) {
  const [color, label] =
    change === 'added'
      ? ['#22c55e', '+']
      : change === 'modified'
        ? ['#eab308', '~']
        : change === 'deleted'
          ? ['#ef4444', '-']
          : ['var(--z-fg-muted)', '·'];
  return (
    <span
      style={{
        fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
        fontSize: 11,
        color,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

const shellStyle = {
  display: 'flex',
  width: '100%',
  height: '100%',
  flexDirection: 'column' as const,
  background: 'var(--z-bg-sidebar)',
  borderLeft: '1px solid var(--z-border)',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
} as const;

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  borderBottom: '1px solid var(--z-border)',
} as const;

const titleStyle = {
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--z-fg-subtle)',
  fontWeight: 600,
} as const;

const searchStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderBottom: '1px solid var(--z-border)',
  background: 'var(--z-bg-app)',
} as const;

const searchInputStyle = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--z-fg)',
  fontSize: 12,
} as const;

const listStyle = {
  flex: 1,
  overflowY: 'auto' as const,
  padding: 8,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
  minHeight: 0,
} as const;

const emptyStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  padding: 24,
  textAlign: 'center' as const,
} as const;
