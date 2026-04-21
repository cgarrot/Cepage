'use client';

import { memo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  formatAgentModelLabel,
  formatAgentTypeLabel,
  readWorkflowControllerSummary,
  readWorkflowDecisionValidatorContent,
  readWorkflowLoopContent,
  readWorkflowManagedFlowSummary,
  readWorkflowSubgraphContent,
  type GraphNode,
} from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { useI18n } from './I18nProvider';
import { MarkdownBody } from './MarkdownBody';
import { canRenderManagedFlowForm } from './managed-flow-helpers';
import { looksLikeMarkdown } from './looksLikeMarkdown';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';
import { RunMenuButton } from './RunMenuButton';
import { StructuredNodeEditor, canRenderStructuredForm } from './StructuredNodeEditor';

type EditableTextNodeData = {
  raw: GraphNode;
  text: string;
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStructuredNodeKind(raw: GraphNode): 'loop' | 'managed_flow' | 'sub_graph' | 'decision' | null {
  if (raw.type === 'loop' && (readWorkflowLoopContent(raw.content) || readRecord(raw.content))) {
    return 'loop';
  }
  if (canRenderManagedFlowForm(raw)) {
    return 'managed_flow';
  }
  if (raw.type === 'sub_graph' && (readWorkflowSubgraphContent(raw.content) || readRecord(raw.content)?.workflowRef)) {
    return 'sub_graph';
  }
  if (
    raw.type === 'decision' &&
    (readWorkflowDecisionValidatorContent(raw.content) || readRecord(raw.content)?.mode === 'workspace_validator')
  ) {
    return 'decision';
  }
  return null;
}

function getSpawnDetails(raw: GraphNode, fallbackDirectory?: string, selection?: AgentRunSelection | null): {
  agentType: string;
  agentLabel: string;
  modelLabel?: string;
  workingDirectory: string;
  workingDirectoryLabel: string;
  contextCount: number;
} {
  const content = raw.content as {
    agentType?: unknown;
    model?: { providerID?: unknown; modelID?: unknown };
    config?: { workingDirectory?: unknown; contextNodeIds?: unknown };
  };
  const agentType = selection?.type ?? readString(content.agentType) ?? 'agent';
  const modelProviderID = selection?.model?.providerID ?? readString(content.model?.providerID);
  const modelID = selection?.model?.modelID ?? readString(content.model?.modelID);
  const workingDirectory = readString(content.config?.workingDirectory) ?? fallbackDirectory ?? '.';
  const parts = workingDirectory.split('/').filter(Boolean);
  const workingDirectoryLabel = parts[parts.length - 1] ?? workingDirectory;
  const contextCount = Array.isArray(content.config?.contextNodeIds)
    ? content.config.contextNodeIds.length
    : 0;
  return {
    agentType,
    agentLabel: formatAgentTypeLabel(agentType as Parameters<typeof formatAgentTypeLabel>[0]),
    modelLabel:
      modelProviderID && modelID
        ? formatAgentModelLabel({ providerID: modelProviderID, modelID })
        : undefined,
    workingDirectory,
    workingDirectoryLabel,
    contextCount,
  };
}

function workflowRunLabel(raw: GraphNode, t: (key: string) => string): string | undefined {
  if (raw.type === 'loop') {
    const summary = readWorkflowControllerSummary(raw.metadata);
    if (!summary) {
      return t('ui.node.run');
    }
    if (summary.status === 'completed' || summary.status === 'failed' || summary.status === 'cancelled') {
      return t('ui.node.restart');
    }
    return t('ui.node.resume');
  }
  if (raw.type === 'managed_flow') {
    const summary = readWorkflowManagedFlowSummary(raw.metadata);
    if (!summary) {
      return t('ui.node.run');
    }
    if (summary.status === 'completed' || summary.status === 'failed' || summary.status === 'cancelled') {
      return t('ui.node.restart');
    }
    return t('ui.node.resume');
  }
  return undefined;
}

export const EditableTextNode = memo(function EditableTextNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { t } = useI18n();
  const { raw, text } = data as EditableTextNodeData;
  const updateNodeText = useWorkspaceStore((s) => s.updateNodeText);
  const patchNodeData = useWorkspaceStore((s) => s.patchNodeData);
  const runFromNode = useWorkspaceStore((s) => s.runFromNode);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const sessionWorkspace = useWorkspaceStore((s) => s.sessionWorkspace);
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const setSelected = useWorkspaceStore((s) => s.setSelected);
  const liveRun = useWorkspaceStore(
    (s) =>
      s.liveRuns.find(
        (entry) =>
          entry.rootNodeId === id ||
          entry.outputNodeId === id ||
          entry.triggerNodeId === id ||
          entry.stepNodeId === id,
      ) ?? null,
  );
  const [draft, setDraft] = useState(text);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [structuredSurface, setStructuredSurface] = useState<'form' | 'json'>('form');
  /** `auto` = show markdown preview when content looks like markdown (default). `edit` = user chose the raw editor. */
  const [markdownSurface, setMarkdownSurface] = useState<'auto' | 'edit'>('auto');
  const isSpawnNode = raw.type === 'agent_spawn' || raw.type === 'agent_step';
  const structuredKind = readStructuredNodeKind(raw);
  const isStructuredNode = structuredKind !== null;
  const showStructuredForm = isStructuredNode && canRenderStructuredForm(raw);
  const isControllerNode = raw.type === 'loop' || raw.type === 'managed_flow';
  const runLabel = workflowRunLabel(raw, t);
  const isOutputNode = raw.type === 'agent_output';
  const isStreamingOutput = isOutputNode && readBoolean((raw.content as { isStreaming?: unknown }).isStreaming);
  const isLiveNode = Boolean(liveRun?.isActive) || isStreamingOutput;
  const liveStatusLabel = liveRun
    ? t(`agentRunStatus.${liveRun.status}` as 'agentRunStatus.running')
    : t('agentRunStatus.running');
  const { selection: nodeSelection } = useNodeAgentSelection(id, raw);
  const spawnDetails = isSpawnNode ? getSpawnDetails(raw, sessionWorkspace?.workingDirectory, nodeSelection) : null;

  useEffect(() => {
    setDraft(isStructuredNode ? JSON.stringify(raw.content ?? {}, null, 2) : text);
    setJsonError(null);
    setStructuredSurface(showStructuredForm ? 'form' : 'json');
  }, [id, isStructuredNode, raw.content, showStructuredForm, text]);

  useEffect(() => {
    setMarkdownSurface('auto');
  }, [id]);

  const canPreviewMarkdown =
    !isSpawnNode &&
    !isStructuredNode &&
    looksLikeMarkdown(draft) &&
    draft.trim().length > 0;
  const showMarkdownPreview = canPreviewMarkdown && markdownSurface !== 'edit';
  const focus = () => {
    if (selectedIds.length > 1 && selectedIds.includes(id)) return;
    setSelected(id);
  };
  const handleRun = (selection: AgentRunSelection | null = null) => {
    focus();
    void runFromNode(id, selection);
  };

  const save = () => {
    if (isStructuredNode) {
      try {
        const next = JSON.parse(draft) as GraphNode['content'];
        setJsonError(null);
        if (JSON.stringify(next) === JSON.stringify(raw.content ?? {})) return;
        void patchNodeData(id, { content: next });
      } catch {
        setJsonError(t('ui.node.structuredInvalidJson'));
      }
      return;
    }
    if (draft === text) return;
    void updateNodeText(id, draft);
  };

  const typeLabel =
    raw.type === 'agent_spawn'
      ? t('ui.node.opencodeRun')
      : raw.type === 'agent_step'
        ? t('ui.node.agentStep')
      : t(`nodeType.${raw.type}` as 'nodeType.note');
  const isStale = raw.status === 'archived' || raw.metadata?.stale === true;

  const nodeBackground =
    raw.status === 'error'
      ? 'var(--z-node-grad-error)'
      : isSpawnNode
        ? 'var(--z-node-grad-spawn)'
        : 'var(--z-node-grad-default)';

  return (
    <div
      style={{
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        position: 'relative',
      }}
    >
      <button
        type="button"
        aria-label={t('ui.node.delete')}
        title={t('ui.node.delete')}
        className="nodrag nopan"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void removeNode(id);
        }}
        style={{
          position: 'absolute',
          top: 12,
          left: 0,
          transform: 'translateX(-50%)',
          zIndex: 1,
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          borderRadius: 999,
          border: `1px solid var(--z-node-header-border)`,
          background: 'var(--z-node-hint-bg)',
          color: 'var(--z-node-error-fg)',
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        &times;
      </button>
      <div
        style={{
          borderRadius: 16,
          border: selected
            ? `1px solid var(--z-node-border-selected)`
            : isLiveNode
              ? `1px solid var(--z-node-run-border)`
              : `1px solid var(--z-node-border)`,
          background: nodeBackground,
          boxShadow: selected
            ? 'var(--z-node-shadow-selected)'
            : isLiveNode
              ? '0 0 0 1px var(--z-node-run-border), var(--z-node-shadow)'
              : 'var(--z-node-shadow)',
          opacity: isStale ? 0.72 : 1,
          color: 'var(--z-node-fg)',
          overflow: 'hidden',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            columnGap: 8,
            padding: '10px 12px 8px',
            borderBottom: `1px solid var(--z-node-header-border)`,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
          }}
        >
          <span
            style={{
              justifySelf: 'start',
              color: isSpawnNode ? 'var(--z-node-type-spawn)' : 'var(--z-node-type-default)',
            }}
          >
            {typeLabel}
          </span>
          {!isSpawnNode && canPreviewMarkdown ? (
            <div
              className="nodrag"
              style={{
                justifySelf: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                textTransform: 'none',
                letterSpacing: 'normal',
              }}
            >
              <button
                type="button"
                className="nodrag"
                onClick={(event) => {
                  event.stopPropagation();
                  setMarkdownSurface('edit');
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border:
                    markdownSurface === 'edit'
                      ? '1px solid var(--z-node-run-border)'
                      : '1px solid var(--z-node-header-border)',
                  background:
                    markdownSurface === 'edit' ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
                  color: 'var(--z-node-fg)',
                  cursor: 'pointer',
                }}
              >
                {t('ui.node.markdownEdit')}
              </button>
              <button
                type="button"
                className="nodrag"
                onClick={(event) => {
                  event.stopPropagation();
                  setMarkdownSurface('auto');
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border:
                    showMarkdownPreview
                      ? '1px solid var(--z-node-run-border)'
                      : '1px solid var(--z-node-header-border)',
                  background:
                    showMarkdownPreview ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
                  color: 'var(--z-node-fg)',
                  cursor: 'pointer',
                }}
              >
                {t('ui.node.markdownPreview')}
              </button>
            </div>
          ) : isStructuredNode ? (
            <div
              className="nodrag"
              style={{
                justifySelf: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                textTransform: 'none',
                letterSpacing: 'normal',
              }}
            >
              {showStructuredForm ? (
                <button
                  type="button"
                  className="nodrag"
                  onClick={(event) => {
                    event.stopPropagation();
                    setStructuredSurface('form');
                  }}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border:
                      structuredSurface === 'form'
                        ? '1px solid var(--z-node-run-border)'
                        : '1px solid var(--z-node-header-border)',
                    background:
                      structuredSurface === 'form' ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
                    color: 'var(--z-node-fg)',
                    cursor: 'pointer',
                  }}
                >
                  {t('ui.node.structuredDetails')}
                </button>
              ) : null}
              <button
                type="button"
                className="nodrag"
                onClick={(event) => {
                  event.stopPropagation();
                  setStructuredSurface('json');
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border:
                    structuredSurface === 'json'
                      ? '1px solid var(--z-node-run-border)'
                      : '1px solid var(--z-node-header-border)',
                  background:
                    structuredSurface === 'json' ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
                  color: 'var(--z-node-fg)',
                  cursor: 'pointer',
                }}
              >
                {t('ui.node.structuredJson')}
              </button>
            </div>
          ) : (
            <span aria-hidden style={{ justifySelf: 'center' }} />
          )}
          <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isStale ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 8px',
                  borderRadius: 999,
                  border: '1px solid var(--z-node-header-border)',
                  background: 'var(--z-node-hint-bg)',
                  color: 'var(--z-fg-subtle)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {t('ui.runtime.stale')}
              </span>
            ) : null}
            {isLiveNode ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 8px',
                  borderRadius: 999,
                  border: '1px solid var(--z-node-run-border)',
                  background: 'var(--z-node-run-bg)',
                  color: 'var(--z-fg)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: 'var(--z-fg-status)',
                    display: 'inline-block',
                  }}
                />
                {liveStatusLabel}
              </span>
            ) : null}
            <span
              style={{
                color:
                  raw.status === 'error'
                    ? 'var(--z-node-error-fg)'
                    : isSpawnNode
                      ? 'var(--z-node-status-spawn-fg)'
                      : 'var(--z-node-status-ok)',
                background: isSpawnNode ? 'var(--z-node-status-spawn-bg)' : 'transparent',
                border: isSpawnNode ? `1px solid var(--z-node-status-spawn-border)` : 'none',
                borderRadius: 999,
                padding: isSpawnNode ? '3px 8px' : 0,
              }}
            >
              {t(`nodeStatus.${raw.status}` as 'nodeStatus.active')}
            </span>
            <RunMenuButton
              isSpawnNode={isSpawnNode}
              isRerun={isSpawnNode}
              label={runLabel}
              showModelMenu={!isControllerNode}
              selection={nodeSelection}
              onRun={handleRun}
            />
          </div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <NodeAgentSelectionControl
            nodeId={id}
            raw={raw}
            placeholder={t('ui.node.selectionChoose')}
          />
        </div>
        {isSpawnNode && spawnDetails ? (
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: 'var(--z-node-spawn-card-bg)',
                border: `1px solid var(--z-node-spawn-card-border)`,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--z-node-spawn-label)', marginBottom: 4 }}>
                {t('ui.node.workspace')}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--z-node-spawn-title)' }}>
                {spawnDetails.workingDirectoryLabel}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--z-node-spawn-path)',
                  wordBreak: 'break-all',
                }}
              >
                {spawnDetails.workingDirectory}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'var(--z-node-hint-bg)',
                  border: `1px solid var(--z-node-hint-border)`,
                  fontSize: 12,
                  color: 'var(--z-node-chip-fg)',
                }}
              >
                {spawnDetails.agentLabel}
              </div>
              {spawnDetails.modelLabel ? (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: 'var(--z-node-hint-bg)',
                    border: `1px solid var(--z-node-hint-border)`,
                    fontSize: 12,
                    color: 'var(--z-node-chip-fg)',
                  }}
                >
                  {spawnDetails.modelLabel}
                </div>
              ) : null}
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'var(--z-node-hint-bg)',
                  border: `1px solid var(--z-node-hint-border)`,
                  fontSize: 12,
                  color: 'var(--z-node-chip-fg)',
                }}
              >
                {t('ui.node.context', { count: String(spawnDetails.contextCount) })}
              </div>
            </div>
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: 'var(--z-node-hint-bg)',
                border: `1px solid var(--z-node-hint-border)`,
                fontSize: 12,
                color: 'var(--z-node-hint-fg)',
                lineHeight: 1.5,
              }}
            >
              {t('ui.node.spawnHint')}
            </div>
          </div>
        ) : (
          <>
            {isStructuredNode && text.trim() ? (
              <div style={{ padding: '12px 12px 0' }}>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'var(--z-node-hint-bg)',
                    border: `1px solid var(--z-node-hint-border)`,
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--z-node-id-fg)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.7,
                    }}
                  >
                    {t('ui.node.structuredSummary')}
                  </div>
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: 'var(--z-node-hint-fg)',
                    }}
                  >
                    {text}
                  </div>
                </div>
              </div>
            ) : null}
            {isStructuredNode && structuredSurface === 'form' && showStructuredForm ? (
              <div style={{ padding: 12 }}>
                <StructuredNodeEditor
                  raw={raw}
                  onPatch={(content) => {
                    void patchNodeData(id, { content });
                  }}
                />
              </div>
            ) : showMarkdownPreview ? (
              <div
                className="nodrag nowheel"
                onMouseDown={focus}
                style={{
                  width: '100%',
                  minHeight: isOutputNode ? 148 : 112,
                  maxHeight: 320,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  padding: 12,
                  background: isOutputNode ? 'var(--z-node-textarea-bg)' : 'transparent',
                  color: 'var(--z-node-fg)',
                  fontSize: 14,
                  lineHeight: 1.45,
                  WebkitMaskImage:
                    'linear-gradient(to bottom, transparent, #000 18px, #000 calc(100% - 18px), transparent)',
                  maskImage:
                    'linear-gradient(to bottom, transparent, #000 18px, #000 calc(100% - 18px), transparent)',
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                }}
              >
                <MarkdownBody content={draft} />
              </div>
            ) : (
              <textarea
                className="nodrag nowheel"
                value={draft}
                onFocus={focus}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={save}
                spellCheck={false}
                placeholder={
                  isStructuredNode
                    ? t('ui.node.structuredConfigPlaceholder')
                    : t('ui.node.editPlaceholder', { type: t(`nodeType.${raw.type}` as 'nodeType.note') })
                }
                style={{
                  width: '100%',
                  minHeight: isStructuredNode ? 180 : isOutputNode ? 148 : 112,
                  resize: 'vertical',
                  padding: 12,
                  border: 'none',
                  outline: 'none',
                  background: isOutputNode ? 'var(--z-node-textarea-bg)' : 'transparent',
                  color: 'var(--z-node-fg)',
                  fontSize: isStructuredNode ? 12 : 14,
                  lineHeight: 1.45,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}
              />
            )}
            {jsonError ? (
              <div
                style={{
                  padding: '0 12px 12px',
                  color: 'var(--z-node-error-fg)',
                  fontSize: 11,
                }}
              >
                {jsonError}
              </div>
            ) : null}
          </>
        )}
        <div
          title={raw.id}
          style={{
            padding: '0 12px 10px',
            color: 'var(--z-node-id-fg)',
            fontSize: 10,
          }}
        >
          {isSpawnNode ? t('ui.node.runLabel', { id: shortId(raw.id) }) : shortId(raw.id)}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});
