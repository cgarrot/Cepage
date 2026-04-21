'use client';

import { memo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  readWorkflowArtifactContent,
  type GraphNode,
  type WorkflowArtifactContent,
  type WorkflowArtifactPathMode,
} from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { MarkdownBody } from './MarkdownBody';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';
import { RunMenuButton } from './RunMenuButton';
import { useI18n } from './I18nProvider';

type WorkspaceFileNodeData = {
  raw: GraphNode;
  workflowArtifact: WorkflowArtifactContent | null;
};

type MarkdownSurface = 'raw' | 'preview';

function trim(value: string | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function isMarkdownArtifact(artifact: WorkflowArtifactContent): boolean {
  const path = artifact.relativePath.toLowerCase();
  const mime = artifact.mimeType?.toLowerCase();
  if (mime?.includes('markdown')) return true;
  return /\.(md|mdx|markdown|mdown|mkdn|mkd)$/.test(path);
}

function readPathMode(artifact: WorkflowArtifactContent | null): WorkflowArtifactPathMode {
  return artifact?.pathMode ?? 'static';
}

export const WorkspaceFileNode = memo(function WorkspaceFileNode({ id, data, selected }: NodeProps) {
  const { t } = useI18n();
  const { raw, workflowArtifact: initialArtifact } = data as WorkspaceFileNodeData;
  const artifact = initialArtifact ?? readWorkflowArtifactContent(raw.content);
  const patchNodeData = useWorkspaceStore((state) => state.patchNodeData);
  const runFromNode = useWorkspaceStore((state) => state.runFromNode);
  const removeNode = useWorkspaceStore((state) => state.removeNode);
  const selectedIds = useWorkspaceStore((state) => state.selectedIds);
  const setSelected = useWorkspaceStore((state) => state.setSelected);
  const { selection: nodeSelection } = useNodeAgentSelection(id, raw);
  const [surface, setSurface] = useState<MarkdownSurface>('preview');
  const [pathMode, setPathMode] = useState<WorkflowArtifactPathMode>(() => readPathMode(artifact));
  const summary = trim(artifact?.summary);
  const excerpt = trim(artifact?.excerpt);
  const resolvedPath = trim(artifact?.resolvedRelativePath);
  const canPreviewMarkdown = Boolean(artifact && isMarkdownArtifact(artifact) && (summary || excerpt));
  const showMarkdownPreview = canPreviewMarkdown && surface === 'preview';
  const showResolvedPath = Boolean(resolvedPath && resolvedPath !== artifact?.relativePath);

  useEffect(() => {
    setSurface('preview');
  }, [id]);

  useEffect(() => {
    setPathMode(readPathMode(artifact));
  }, [artifact?.pathMode, id]);

  if (!artifact) {
    return (
      <div style={fallbackCardStyle}>
        <Handle type="target" position={Position.Top} />
        <div style={fallbackTitleStyle}>{t('nodeType.workspace_file')}</div>
        <div style={fallbackBodyStyle}>{t('ui.node.workspaceFileMissing')}</div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  const focus = () => {
    if (selectedIds.length > 1 && selectedIds.includes(id)) return;
    setSelected(id);
  };

  const handleRun = (selection: AgentRunSelection | null = null) => {
    focus();
    void runFromNode(id, selection);
  };

  const savePathMode = (next: WorkflowArtifactPathMode) => {
    if (artifact.role !== 'output') return;
    setPathMode(next);
    const content = {
      ...artifact,
      pathMode: next,
    };
    if (next !== 'per_run') {
      delete (content as { resolvedRelativePath?: string }).resolvedRelativePath;
    }
    void patchNodeData(id, { content: content as GraphNode['content'] });
  };

  return (
    <div style={rootStyle}>
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
          ...cardStyle,
          borderColor: selected ? 'var(--z-node-border-selected)' : 'var(--z-node-border)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <span style={eyebrowStyle}>{t('nodeType.workspace_file')}</span>
            <strong style={titleStyle}>{artifact.title?.trim() || artifact.relativePath}</strong>
          </div>
          <div style={headerActionsStyle}>
            {canPreviewMarkdown ? (
              <div className="nodrag" style={toggleWrapStyle}>
                <button
                  type="button"
                  className="nodrag"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSurface('raw');
                  }}
                  style={surface === 'raw' ? toggleButtonActiveStyle : toggleButtonStyle}
                >
                  {t('ui.node.markdownRaw')}
                </button>
                <button
                  type="button"
                  className="nodrag"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSurface('preview');
                  }}
                  style={showMarkdownPreview ? toggleButtonActiveStyle : toggleButtonStyle}
                >
                  {t('ui.node.markdownPreview')}
                </button>
              </div>
            ) : null}
            <RunMenuButton isSpawnNode={false} selection={nodeSelection} onRun={handleRun} />
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={chipStyle}>{artifact.role}</span>
            <span style={chipStyle}>{artifact.origin}</span>
            <span style={chipStyle}>{artifact.transferMode ?? 'reference'}</span>
            <span style={chipStyle}>{pathMode === 'per_run' ? t('ui.node.workspaceFileModePerRun') : t('ui.node.workspaceFileModeStatic')}</span>
            <span style={chipStyle}>{artifact.status ?? 'declared'}</span>
            {artifact.change ? <span style={chipStyle}>{artifact.change}</span> : null}
          </div>

          <div style={sectionStyle}>
            <div style={labelStyle}>{t('ui.node.workspaceFileMode')}</div>
            <div className="nodrag" onMouseDown={(event) => event.stopPropagation()}>
              <select
                value={pathMode}
                onChange={(event) => savePathMode(event.target.value as WorkflowArtifactPathMode)}
                disabled={artifact.role !== 'output'}
                style={selectStyle}
              >
                <option value="static">{t('ui.node.workspaceFileModeStatic')}</option>
                <option value="per_run">{t('ui.node.workspaceFileModePerRun')}</option>
              </select>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={labelStyle}>{t('ui.node.workspaceFilePath')}</div>
            <div style={monoStyle}>{artifact.relativePath}</div>
          </div>

          {showResolvedPath ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileResolvedPath')}</div>
              <div style={monoStyle}>{resolvedPath}</div>
            </div>
          ) : null}

          <div style={twoColStyle}>
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileKind')}</div>
              <div style={monoStyle}>{artifact.kind}</div>
            </div>
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileSize')}</div>
              <div style={monoStyle}>{artifact.size != null ? `${artifact.size} B` : '—'}</div>
            </div>
          </div>

          {artifact.mimeType ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileMime')}</div>
              <div style={monoStyle}>{artifact.mimeType}</div>
            </div>
          ) : null}

          {artifact.claimRef ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileClaim')}</div>
              <div style={monoStyle}>{artifact.claimRef}</div>
            </div>
          ) : null}

          {summary ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileSummary')}</div>
              {showMarkdownPreview ? (
                <div className="nodrag nowheel" onMouseDown={focus} style={previewBodyStyle}>
                  <MarkdownBody content={summary} />
                </div>
              ) : (
                <pre className="nodrag nowheel" onMouseDown={focus} style={codeStyle}>
                  {summary}
                </pre>
              )}
            </div>
          ) : null}

          {excerpt ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.node.workspaceFileExcerpt')}</div>
              {showMarkdownPreview ? (
                <div className="nodrag nowheel" onMouseDown={focus} style={previewBodyStyle}>
                  <MarkdownBody content={excerpt} />
                </div>
              ) : (
                <pre className="nodrag nowheel" onMouseDown={focus} style={codeStyle}>
                  {excerpt}
                </pre>
              )}
            </div>
          ) : null}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});

const rootStyle = {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  position: 'relative',
} as const;

const cardStyle = {
  borderRadius: 16,
  border: '1px solid var(--z-node-border)',
  background: 'linear-gradient(180deg, rgba(141, 108, 255, 0.16), rgba(12, 18, 32, 0.96))',
  color: 'var(--z-node-fg)',
  overflow: 'hidden',
} as const;

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  padding: '12px 12px 10px',
  borderBottom: '1px solid var(--z-node-header-border)',
} as const;

const headerActionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
} as const;

const toggleWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
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

const eyebrowStyle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: 'var(--z-fg-subtle)',
} as const;

const titleStyle = {
  fontSize: 16,
  color: 'var(--z-fg)',
  wordBreak: 'break-word',
} as const;

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--z-node-chip-fg)',
  fontSize: 11,
} as const;

const sectionStyle = {
  display: 'grid',
  gap: 4,
} as const;

const twoColStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
} as const;

const labelStyle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.7,
  color: 'var(--z-fg-subtle)',
} as const;

const monoStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  wordBreak: 'break-word',
} as const;

const selectStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-node-fg)',
  fontSize: 12,
} as const;

const codeStyle = {
  margin: 0,
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-hint-bg)',
  border: '1px solid var(--z-node-hint-border)',
  color: 'var(--z-node-hint-fg)',
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

const previewBodyStyle = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-textarea-bg)',
  border: '1px solid var(--z-node-hint-border)',
  color: 'var(--z-node-fg)',
} as const;

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
  border: '1px solid var(--z-node-header-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-error-fg)',
  fontSize: 14,
  lineHeight: 1,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

const fallbackCardStyle = {
  borderRadius: 16,
  border: '1px solid var(--z-node-border)',
  background: 'var(--z-node-grad-default)',
  color: 'var(--z-node-fg)',
  padding: 14,
  display: 'grid',
  gap: 8,
} as const;

const fallbackTitleStyle = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: 'var(--z-node-type-default)',
} as const;

const fallbackBodyStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-subtle)',
} as const;
