'use client';

import { memo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { readRunArtifactsSummary, type GraphNode, type RunArtifactsSummary } from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { MarkdownBody } from './MarkdownBody';
import { useI18n } from './I18nProvider';
import { looksLikeMarkdown } from './looksLikeMarkdown';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';
import { RunMenuButton } from './RunMenuButton';

type AgentOutputNodeData = {
  raw: GraphNode;
  text: string;
  artifacts: RunArtifactsSummary | null;
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

export const AgentOutputNode = memo(function AgentOutputNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { t } = useI18n();
  const { raw, text, artifacts: initialArtifacts } = data as AgentOutputNodeData;
  const artifacts = initialArtifacts ?? readRunArtifactsSummary(raw.metadata);
  const updateNodeText = useWorkspaceStore((s) => s.updateNodeText);
  const runFromNode = useWorkspaceStore((s) => s.runFromNode);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const setSelected = useWorkspaceStore((s) => s.setSelected);
  const { selection: nodeSelection } = useNodeAgentSelection(id, raw);
  const [draft, setDraft] = useState(text);
  const [markdownSurface, setMarkdownSurface] = useState<'auto' | 'edit'>('auto');
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);

  useEffect(() => {
    setDraft(text);
  }, [id, text]);

  useEffect(() => {
    setMarkdownSurface('auto');
    setArtifactsExpanded(false);
  }, [id]);

  const canPreviewMarkdown = looksLikeMarkdown(draft) && draft.trim().length > 0;
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
    if (draft === text) return;
    void updateNodeText(id, draft);
  };

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
        style={deleteButtonStyle}
      >
        &times;
      </button>
      <div
        style={{
          borderRadius: 16,
          border: selected ? `1px solid var(--z-node-border-selected)` : `1px solid var(--z-node-border)`,
          background: 'var(--z-node-grad-default)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
          color: 'var(--z-node-fg)',
          overflow: 'hidden',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <span
            style={{
              justifySelf: 'start',
              color: 'var(--z-node-type-default)',
            }}
          >
            {t('nodeType.agent_output')}
          </span>
          {canPreviewMarkdown ? (
            <div className="nodrag" style={toggleWrapStyle}>
              <button
                type="button"
                className="nodrag"
                onClick={(event) => {
                  event.stopPropagation();
                  setMarkdownSurface('edit');
                }}
                style={markdownSurface === 'edit' ? toggleButtonActiveStyle : toggleButtonStyle}
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
                style={showMarkdownPreview ? toggleButtonActiveStyle : toggleButtonStyle}
              >
                {t('ui.node.markdownPreview')}
              </button>
            </div>
          ) : (
            <span aria-hidden style={{ justifySelf: 'center' }} />
          )}
          <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--z-node-status-ok)' }}>{t(`nodeStatus.${raw.status}` as 'nodeStatus.active')}</span>
            <RunMenuButton isSpawnNode={false} isRerun selection={nodeSelection} onRun={handleRun} />
          </div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <NodeAgentSelectionControl
            nodeId={id}
            raw={raw}
            placeholder={t('ui.node.selectionChoose')}
          />
        </div>

        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div
            className="nodrag"
            onMouseDown={focus}
            style={artifactsCardStyle}
          >
            <button
              type="button"
              className="nodrag"
              onClick={(event) => {
                event.stopPropagation();
                setArtifactsExpanded((value) => !value);
              }}
              style={artifactsHeaderButtonStyle}
            >
              <span style={{ fontWeight: 700 }}>{t('ui.node.artifacts')}</span>
              <span style={{ opacity: 0.85 }}>
                {artifacts
                  ? `${artifacts.counts.total} ${t('ui.node.filesChanged')}`
                  : t('ui.node.noArtifactsYet')}
              </span>
            </button>
            {artifacts ? (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {renderChip(String(artifacts.counts.added), t('fileChangeKind.added'))}
                  {renderChip(String(artifacts.counts.modified), t('fileChangeKind.modified'))}
                  {renderChip(String(artifacts.counts.deleted), t('fileChangeKind.deleted'))}
                  <span style={chipStyle}>{t(`previewStatus.${artifacts.preview.status}` as 'previewStatus.idle')}</span>
                </div>
                {artifactsExpanded ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--z-fg-subtle)' }}>{artifacts.cwd}</div>
                    {artifacts.files.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{t('ui.node.noArtifactsYet')}</div>
                    ) : (
                      artifacts.files.map((file) => (
                        <div
                          key={`${file.kind}:${file.path}`}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            fontSize: 12,
                            color: 'var(--z-fg)',
                          }}
                        >
                          <span style={chipStyle}>{t(`fileChangeKind.${file.kind}` as 'fileChangeKind.added')}</span>
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            {file.path}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {showMarkdownPreview ? (
            <div
              className="nodrag nowheel"
              onMouseDown={focus}
              style={previewBodyStyle}
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
              placeholder={t('ui.node.editPlaceholder', { type: t('nodeType.agent_output') })}
              style={textareaStyle}
            />
          )}
        </div>

        <div
          title={raw.id}
          style={{
            padding: '0 12px 10px',
            color: 'var(--z-node-id-fg)',
            fontSize: 10,
          }}
        >
          {t('ui.node.runLabel', { id: shortId(raw.id) })}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});

function renderChip(value: string, label: string) {
  return (
    <span style={chipStyle}>
      <strong>{value}</strong> {label}
    </span>
  );
}

const deleteButtonStyle = {
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
} as const;

const headerStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: 8,
  padding: '10px 12px 8px',
  borderBottom: `1px solid var(--z-node-header-border)`,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
} as const;

const toggleWrapStyle = {
  justifySelf: 'center',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  textTransform: 'none',
  letterSpacing: 'normal',
} as const;

const toggleButtonStyle = {
  fontSize: 10,
  fontWeight: 600,
  padding: '3px 8px',
  borderRadius: 6,
  border: '1px solid var(--z-node-header-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-fg)',
  cursor: 'pointer',
} as const;

const toggleButtonActiveStyle = {
  ...toggleButtonStyle,
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
} as const;

const artifactsCardStyle = {
  padding: 10,
  borderRadius: 12,
  background: 'var(--z-node-hint-bg)',
  border: '1px solid var(--z-node-hint-border)',
  display: 'grid',
  gap: 8,
} as const;

const artifactsHeaderButtonStyle = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'pointer',
  textAlign: 'left',
} as const;

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--z-node-chip-fg)',
  fontSize: 11,
} as const;

const previewBodyStyle = {
  width: '100%',
  minHeight: 148,
  maxHeight: 320,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: 12,
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-node-fg)',
  fontSize: 14,
  lineHeight: 1.45,
} as const;

const textareaStyle = {
  width: '100%',
  minHeight: 148,
  resize: 'vertical',
  padding: 12,
  border: 'none',
  outline: 'none',
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-node-fg)',
  fontSize: 14,
  lineHeight: 1.45,
  fontFamily: 'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;
