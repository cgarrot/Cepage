'use client';

import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import {
  applyNodeAgentSelection,
  readGraphNodeAgentSelection,
  resolveGraphNodeSelection,
  type GraphEdge,
  type GraphNode,
} from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { AgentModelMenu } from './AgentModelMenu';
import { useI18n } from './I18nProvider';

type NodeAgentSelectionControlProps = {
  nodeId: string;
  raw: GraphNode;
  placeholder?: string;
  onChange?: (input: { locked: boolean; selection: AgentRunSelection | null }) => void | Promise<void>;
};

type SelectionDraft =
  | { mode: 'inherit'; selection?: AgentRunSelection }
  | { mode: 'locked'; selection: AgentRunSelection };

function toLinks(edges: readonly Edge[]): Array<Pick<GraphEdge, 'source' | 'target' | 'relation'>> {
  return edges.flatMap((edge) =>
    edge.source && edge.target
      ? [
          {
            source: edge.source,
            target: edge.target,
            relation:
              (typeof edge.data?.relation === 'string' ? edge.data.relation : 'custom') as GraphEdge['relation'],
          },
        ]
      : [],
  );
}

function toRawNodes(nodes: readonly Node[]): GraphNode[] {
  return nodes.flatMap((node) => {
    const raw = (node.data as { raw?: GraphNode }).raw;
    return raw ? [raw] : [];
  });
}

function cloneSelection(selection: AgentRunSelection | null | undefined): AgentRunSelection | null {
  if (!selection) return null;
  return {
    type: selection.type,
    ...(selection.model
      ? {
          model: {
            providerID: selection.model.providerID,
            modelID: selection.model.modelID,
          },
        }
      : {}),
  };
}

export function useNodeAgentSelection(nodeId: string, raw: GraphNode) {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const edges = useWorkspaceStore((s) => s.edges);
  const lastRunSelection = useWorkspaceStore((s) => s.lastRunSelection);
  const nodeState = useMemo(() => readGraphNodeAgentSelection(raw), [raw]);
  const flowNodes = useMemo(() => toRawNodes(nodes), [nodes]);
  const links = useMemo(() => toLinks(edges), [edges]);
  const resolveWith = (value?: SelectionDraft | null) =>
    cloneSelection(
      resolveGraphNodeSelection({
        nodeId,
        nodes: flowNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                content: applyNodeAgentSelection(raw.type, raw.content, value ?? nodeState ?? null),
              }
            : node,
        ),
        edges: links,
        fallback: cloneSelection(lastRunSelection),
      }),
    );
  const selection = useMemo(() => resolveWith(), [flowNodes, lastRunSelection, links, nodeId, nodeState, raw.content, raw.type]);
  const localSelection = cloneSelection(nodeState?.selection);
  const locked = nodeState?.mode === 'locked';
  const canLock = Boolean(localSelection ?? selection ?? lastRunSelection);

  return {
    locked,
    selection,
    localSelection,
    canLock,
    resolveWith,
  };
}

export function NodeAgentSelectionControl({
  nodeId,
  raw,
  placeholder,
  onChange,
}: NodeAgentSelectionControlProps) {
  const { t } = useI18n();
  const { locked, selection, canLock, localSelection, resolveWith } = useNodeAgentSelection(nodeId, raw);
  const patchNodeData = useWorkspaceStore((s) => s.patchNodeData);

  const save = async (next: SelectionDraft) => {
    await patchNodeData(nodeId, {
      content: applyNodeAgentSelection(raw.type, raw.content, {
        mode: next.mode,
        ...(cloneSelection(next.selection) ? { selection: cloneSelection(next.selection)! } : {}),
      }),
    });
    await onChange?.({
      locked: next.mode === 'locked',
      selection: resolveWith(next),
    });
  };

  const toggle = async () => {
    const next = cloneSelection(localSelection ?? selection);
    if (locked) {
      await save({
        mode: 'inherit',
        ...(next ? { selection: next } : {}),
      });
      return;
    }
    if (!next) return;
    await save({
      mode: 'locked',
      selection: next,
    });
  };

  const select = async (next: AgentRunSelection) => {
    await save({
      mode: 'locked',
      selection: next,
    });
  };

  const modeLabel = locked ? t('ui.node.selectionModeLocked') : t('ui.node.selectionModeInherited');

  return (
    <div className="nodrag nopan" style={surfaceStyle(locked)}>
      <button
        type="button"
        className="nodrag nopan"
        aria-pressed={locked}
        aria-label={locked ? t('ui.node.selectionUnlock') : t('ui.node.selectionLock')}
        title={locked ? t('ui.node.selectionUnlock') : t('ui.node.selectionLock')}
        disabled={!locked && !canLock}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void toggle();
        }}
        style={modeButtonStyle(locked, !locked && !canLock)}
      >
        <span aria-hidden style={modeIconWrapStyle(locked)}>
          {locked ? <LockIcon /> : <UnlockIcon />}
        </span>
        <span style={modeLabelStyle}>{modeLabel}</span>
      </button>
      <AgentModelMenu
        selection={selection}
        onSelect={(next) => void select(next)}
        renderTrigger={({ open, loading, selectionLabel, toggle }) => (
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="menu"
            className="nodrag nopan"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            style={selectionButtonStyle(locked, open)}
            title={`${locked ? t('ui.node.selectionLocal') : t('ui.node.selectionInherited')}: ${loading ? t('ui.node.loadingProviders') : selectionLabel ?? placeholder ?? t('ui.node.selectionChoose')}`}
          >
            <span style={selectionBodyStyle}>
              <span style={selectionEyebrowStyle}>{t('ui.node.selectionTitle')}</span>
              <span
                style={selectionValueStyle(
                  !loading && !(selectionLabel ?? placeholder),
                )}
              >
                {loading ? t('ui.node.loadingProviders') : selectionLabel ?? placeholder ?? t('ui.node.selectionChoose')}
              </span>
            </span>
            <span aria-hidden style={chevronWrapStyle(open)}>
              <ChevronIcon />
            </span>
          </button>
        )}
      />
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="7" width="9" height="6" rx="1.8" />
      <path d="M5.25 7V5.75a2.75 2.75 0 1 1 5.5 0V7" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="7" width="9" height="6" rx="1.8" />
      <path d="M10.75 7V5.75a2.75 2.75 0 0 0-4.92-1.74" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function surfaceStyle(locked: boolean) {
  return {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0,1fr)',
    alignItems: 'stretch',
    gap: 8,
    width: '100%',
    minWidth: 0,
    padding: 6,
    borderRadius: 14,
    border: locked ? '1px solid var(--z-node-run-border)' : '1px solid var(--z-node-hint-border)',
    background: locked
      ? 'linear-gradient(180deg, rgba(81, 163, 255, 0.14), rgba(15, 20, 31, 0.72))'
      : 'var(--z-node-hint-bg)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  } as const;
}

function modeButtonStyle(locked: boolean, disabled: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    padding: '0 11px',
    borderRadius: 10,
    border: locked ? '1px solid var(--z-node-run-border)' : '1px solid transparent',
    background: locked ? 'var(--z-node-run-bg)' : 'rgba(255,255,255,0.04)',
    color: locked ? 'var(--z-fg)' : 'var(--z-node-chip-fg)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  } as const;
}

function modeIconWrapStyle(locked: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 999,
    background: locked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
  } as const;
}

const modeLabelStyle = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.1,
} as const;

function selectionButtonStyle(locked: boolean, open: boolean) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minWidth: 0,
    minHeight: 44,
    padding: '8px 10px 8px 12px',
    borderRadius: 10,
    border: open
      ? '1px solid var(--z-node-border-selected)'
      : locked
        ? '1px solid rgba(255,255,255,0.12)'
        : '1px solid var(--z-node-hint-border)',
    background: locked ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
    color: 'var(--z-node-fg)',
    cursor: 'pointer',
    textAlign: 'left',
  } as const;
}

const selectionBodyStyle = {
  minWidth: 0,
  display: 'grid',
  gap: 2,
} as const;

const selectionEyebrowStyle = {
  fontSize: 10,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.7,
  color: 'var(--z-fg-subtle)',
} as const;

function selectionValueStyle(muted: boolean) {
  return {
    minWidth: 0,
    fontSize: 12,
    fontWeight: 600,
    color: muted ? 'var(--z-fg-subtle)' : 'var(--z-node-fg)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as const;
}

function chevronWrapStyle(open: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 999,
    color: 'var(--z-fg-subtle)',
    background: 'rgba(255,255,255,0.04)',
    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
  } as const;
}
