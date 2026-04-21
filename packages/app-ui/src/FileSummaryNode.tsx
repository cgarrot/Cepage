'use client';

import { memo, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getApiBaseUrl } from '@cepage/client-api';
import { type FileSummaryContent, type FileSummaryItem, type GraphNode } from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { Button } from '@cepage/ui-kit';
import { useI18n } from './I18nProvider';
import { MarkdownBody } from './MarkdownBody';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';
import { looksLikeMarkdown } from './looksLikeMarkdown';
import { RunMenuButton } from './RunMenuButton';

type FileSummaryNodeData = {
  raw: GraphNode;
  text: string;
  fileSummary: FileSummaryContent | null;
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(content: FileSummaryContent | null): string {
  if (!content?.status) return 'empty';
  return content.status;
}

function fileStatusLabel(item: FileSummaryItem): string {
  return item.status ?? 'pending';
}

function displaySummary(content: FileSummaryContent | null): string {
  return content?.summary ?? content?.generatedSummary ?? '';
}

const EMPTY_FILES: readonly FileSummaryItem[] = [];

function sameOpen(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const aIds = Object.keys(a);
  const bIds = Object.keys(b);
  if (aIds.length !== bIds.length) return false;
  return aIds.every((id) => a[id] === b[id]);
}

function keepOpen(
  prev: Record<string, boolean>,
  files: readonly FileSummaryItem[],
): Record<string, boolean> {
  const next = Object.fromEntries(files.filter((item) => prev[item.id]).map((item) => [item.id, true]));
  return sameOpen(prev, next) ? prev : next;
}

export const FileSummaryNode = memo(function FileSummaryNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { t } = useI18n();
  const { raw, fileSummary } = data as FileSummaryNodeData;
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const uploadFilesToNode = useWorkspaceStore((s) => s.uploadFilesToNode);
  const summarizeFileNode = useWorkspaceStore((s) => s.summarizeFileNode);
  const updateNodeText = useWorkspaceStore((s) => s.updateNodeText);
  const runFromNode = useWorkspaceStore((s) => s.runFromNode);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const setSelected = useWorkspaceStore((s) => s.setSelected);
  const { selection } = useNodeAgentSelection(id, raw);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'summary' | null>(null);
  const [combinedSummaryOpen, setCombinedSummaryOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [openSummaries, setOpenSummaries] = useState<Record<string, boolean>>({});
  const [openExtracts, setOpenExtracts] = useState<Record<string, boolean>>({});
  const files = fileSummary?.files ?? EMPTY_FILES;
  const summaryText = displaySummary(fileSummary);
  const [draft, setDraft] = useState(summaryText);
  const [markdownSurface, setMarkdownSurface] = useState<'auto' | 'edit'>('auto');
  const isBusy = busy !== null || fileSummary?.status === 'summarizing';
  const liveStatusLabel = liveRun
    ? t(`agentRunStatus.${liveRun.status}` as 'agentRunStatus.running')
    : null;
  const canPreviewMarkdown = looksLikeMarkdown(draft) && draft.trim().length > 0;
  const showMarkdownPreview = canPreviewMarkdown && markdownSurface !== 'edit';

  const focus = () => {
    if (selectedIds.length > 1 && selectedIds.includes(id)) return;
    setSelected(id);
  };

  useEffect(() => {
    setDraft(summaryText);
  }, [id, summaryText]);

  useEffect(() => {
    setMarkdownSurface('auto');
    setCombinedSummaryOpen(true);
    setFilesOpen(false);
    setOpenSummaries({});
    setOpenExtracts({});
  }, [id]);

  useEffect(() => {
    setOpenSummaries((prev) => keepOpen(prev, files));
  }, [files]);

  useEffect(() => {
    setOpenExtracts((prev) => keepOpen(prev, files));
  }, [files]);

  const handleRun = (next: AgentRunSelection | null = null) => {
    focus();
    void runFromNode(id, next);
  };

  const triggerUpload = () => {
    fileRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setBusy('upload');
    try {
      await uploadFilesToNode(id, files);
    } finally {
      setBusy(null);
    }
  };

  const handleSummarize = async () => {
    if (!selection) return;
    setBusy('summary');
    try {
      await summarizeFileNode(id, selection);
    } finally {
      setBusy(null);
    }
  };

  const saveSummary = () => {
    if (draft === summaryText) return;
    void updateNodeText(id, draft);
  };

  const toggleExtract = (fileId: string) => {
    setOpenExtracts((prev) => ({
      ...prev,
      [fileId]: !prev[fileId],
    }));
  };

  const toggleSummary = (fileId: string) => {
    setOpenSummaries((prev) => ({
      ...prev,
      [fileId]: !prev[fileId],
    }));
  };

  const assetUrl = (item: FileSummaryItem) => {
    if (!sessionId) return null;
    return `${getApiBaseUrl()}/api/v1/sessions/${sessionId}/nodes/${id}/file/${encodeURIComponent(item.id)}?ts=${encodeURIComponent(raw.updatedAt)}`;
  };

  return (
    <div style={{ width: '100%', minWidth: 0, maxWidth: '100%', position: 'relative' }}>
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
          border: selected
            ? '1px solid var(--z-node-border-selected)'
            : raw.status === 'error'
              ? '1px solid var(--z-node-error-fg)'
              : '1px solid var(--z-node-border)',
          background: 'var(--z-node-grad-default)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
          color: 'var(--z-node-fg)',
          overflow: 'hidden',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <span style={{ justifySelf: 'start', color: 'var(--z-node-type-default)' }}>
            {t('nodeType.file_summary')}
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
            {liveStatusLabel ? <span style={liveBadgeStyle}>{liveStatusLabel}</span> : null}
            <span style={statusChipStyle}>{statusLabel(fileSummary)}</span>
            <RunMenuButton onRun={handleRun} isSpawnNode={false} selection={selection} />
          </div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <NodeAgentSelectionControl
            nodeId={id}
            raw={raw}
            placeholder={t('ui.node.fileSummaryChooseModel')}
          />
        </div>

        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={toolbarStyle}>
            <Button className="nodrag nopan" onClick={triggerUpload} style={actionBtnStyle}>
              {busy === 'upload' ? t('ui.node.fileSummaryUploading') : t('ui.node.fileSummaryUpload')}
            </Button>
            <Button
              className="nodrag nopan"
              onClick={() => void handleSummarize()}
              disabled={files.length === 0 || isBusy || !selection}
              style={actionBtnStyle}
            >
              {fileSummary?.status === 'summarizing' || busy === 'summary'
                ? t('ui.node.fileSummarySummarizing')
                : t('ui.node.fileSummarySummarize')}
            </Button>
          </div>

          {files.length === 0 ? (
            <div style={emptyCardStyle}>
              <div style={{ fontSize: 13, color: 'var(--z-fg)' }}>{t('ui.node.fileSummaryEmpty')}</div>
              <div style={metaStyle}>{t('ui.node.fileSummaryHint')}</div>
            </div>
          ) : null}

          {!selection && files.length > 0 ? (
            <div style={hintStyle}>{t('ui.node.fileSummaryPendingHint')}</div>
          ) : null}

          {files.length > 0 ? (
            <div style={blockStyle}>
              <div style={sectionRowStyle}>
                <div style={blockTitleStyle}>{t('ui.node.fileSummaryCombinedSummary')}</div>
                <button
                  type="button"
                  className="nodrag nopan"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCombinedSummaryOpen((value) => !value);
                  }}
                  style={extractToggleStyle}
                >
                  {combinedSummaryOpen
                    ? t('ui.node.fileSummaryHideCombinedSummary')
                    : t('ui.node.fileSummaryShowCombinedSummary')}
                </button>
              </div>
              {combinedSummaryOpen
                ? showMarkdownPreview ? (
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
                      onBlur={saveSummary}
                      spellCheck={false}
                      placeholder={t('ui.node.fileSummarySummaryPlaceholder')}
                      style={textareaStyle}
                    />
                  )
                : null}
            </div>
          ) : null}

          {files.length > 0 ? (
            <div style={blockStyle}>
              <button
                type="button"
                className="nodrag nopan"
                onClick={(event) => {
                  event.stopPropagation();
                  setFilesOpen((value) => !value);
                }}
                style={sectionToggleButtonStyle}
              >
                <span style={sectionToggleTitleStyle}>
                  {files.length === 1
                    ? t('ui.node.fileSummarySingleFile')
                    : t('ui.node.fileSummaryFileCount', { count: String(files.length) })}
                </span>
                <span style={sectionToggleMetaStyle}>
                  {filesOpen ? t('ui.node.fileSummaryHideFiles') : t('ui.node.fileSummaryShowFiles')}
                </span>
              </button>

              {filesOpen ? (
                <div style={fileListStyle}>
                  {files.map((item) => {
                    const url = assetUrl(item);
                    const isImage = item.file.mimeType.startsWith('image/');
                    const showSummary = openSummaries[item.id] === true;
                    const showExtract = openExtracts[item.id] === true;
                    return (
                      <div key={item.id} style={fileCardStyle}>
                        <div style={fileHeaderStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <strong style={{ fontSize: 14, color: 'var(--z-fg)' }}>{item.file.name}</strong>
                            <div style={metaStyle}>
                              {item.file.mimeType} · {formatBytes(item.file.size)}
                              {item.file.width && item.file.height
                                ? ` · ${item.file.width}x${item.file.height}`
                                : ''}
                            </div>
                          </div>
                          <span style={statusChipStyle}>{fileStatusLabel(item)}</span>
                        </div>

                        {isImage && url ? (
                          <div style={imageWrapStyle}>
                            <img
                              src={url}
                              alt={item.file.name}
                              style={imageStyle}
                              onMouseDown={focus}
                            />
                          </div>
                        ) : null}

                        {item.summary ? (
                          <div style={nestedBlockStyle}>
                            <div style={sectionRowStyle}>
                              <div style={blockTitleStyle}>{t('ui.node.fileSummarySummary')}</div>
                              <button
                                type="button"
                                className="nodrag nopan"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSummary(item.id);
                                }}
                                style={extractToggleStyle}
                              >
                                {showSummary
                                  ? t('ui.node.fileSummaryHideSummary')
                                  : t('ui.node.fileSummaryShowSummary')}
                              </button>
                            </div>
                            {showSummary ? (
                              <div
                                className="nodrag nowheel"
                                onMouseDown={focus}
                                style={previewBodyStyle}
                              >
                                <MarkdownBody content={item.summary} />
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {item.extractedText ? (
                          <div style={nestedBlockStyle}>
                            <div style={sectionRowStyle}>
                              <div style={blockTitleStyle}>
                                {t('ui.node.fileSummaryExtracted')}
                                {item.extractedTextTruncated ? (
                                  <span style={{ opacity: 0.7 }}> ({t('ui.sidebar.truncated')})</span>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="nodrag nopan"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExtract(item.id);
                                }}
                                style={extractToggleStyle}
                              >
                                {showExtract
                                  ? t('ui.node.fileSummaryHideExtracted')
                                  : t('ui.node.fileSummaryShowExtracted')}
                              </button>
                            </div>
                            {showExtract ? <pre style={codeStyle}>{item.extractedText}</pre> : null}
                          </div>
                        ) : (
                          <div style={emptyMiniStyle}>{t('ui.node.fileSummaryNoExtract')}</div>
                        )}

                        {item.error ? <div style={errorStyle}>{item.error}</div> : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {fileSummary?.error ? (
            <div style={errorStyle}>{fileSummary.error}</div>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="nodrag nopan"
          onChange={(event) => void handleFileChange(event)}
          style={{ display: 'none' }}
        />

        <div title={raw.id} style={footerStyle}>
          {raw.id.slice(0, 8)}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});

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

const headerStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: 8,
  padding: '10px 12px 8px',
  borderBottom: '1px solid var(--z-node-header-border)',
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.8,
} as const;

const toggleWrapStyle = {
  justifySelf: 'center',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  textTransform: 'none' as const,
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

const statusChipStyle = {
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-chip-fg)',
  fontSize: 10,
} as const;

const liveBadgeStyle = {
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
  color: 'var(--z-fg)',
  fontSize: 10,
  fontWeight: 700,
} as const;

const toolbarStyle = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap' as const,
  justifyContent: 'space-between',
} as const;

const fileCardStyle = {
  display: 'grid',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const fileListStyle = {
  display: 'grid',
  gap: 10,
} as const;

const fileHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  alignItems: 'flex-start',
} as const;

const emptyCardStyle = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: '1px dashed var(--z-border)',
  background: 'var(--z-node-hint-bg)',
} as const;

const emptyMiniStyle = {
  padding: 10,
  borderRadius: 10,
  border: '1px dashed var(--z-border)',
  background: 'var(--z-node-hint-bg)',
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  lineHeight: 1.5,
} as const;

const hintStyle = {
  padding: 10,
  borderRadius: 10,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-fg-muted)',
  fontSize: 12,
  lineHeight: 1.5,
} as const;

const metaStyle = {
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  lineHeight: 1.5,
} as const;

const actionBtnStyle = {
  fontSize: 11,
  padding: '6px 10px',
} as const;

const imageWrapStyle = {
  borderRadius: 12,
  overflow: 'hidden',
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const imageStyle = {
  display: 'block',
  width: '100%',
  maxHeight: 220,
  objectFit: 'contain' as const,
  background: '#fff',
} as const;

const blockStyle = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const nestedBlockStyle = {
  display: 'grid',
  gap: 6,
} as const;

const sectionRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
} as const;

const sectionToggleButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left' as const,
} as const;

const sectionToggleTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--z-fg)',
} as const;

const sectionToggleMetaStyle = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  flexShrink: 0,
} as const;

const blockTitleStyle = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.7,
  color: 'var(--z-fg-subtle)',
} as const;

const previewBodyStyle = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-textarea-bg)',
} as const;

const textareaStyle = {
  minHeight: 190,
  borderRadius: 12,
  border: '1px solid var(--z-node-textarea-border)',
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  padding: 12,
  resize: 'vertical' as const,
  font: 'inherit',
  lineHeight: 1.5,
} as const;

const codeStyle = {
  margin: 0,
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  overflow: 'auto',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
} as const;

const extractToggleStyle = {
  border: '1px solid var(--z-node-header-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-fg)',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
} as const;

const errorStyle = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-error-fg)',
  fontSize: 12,
  lineHeight: 1.5,
} as const;

const footerStyle = {
  padding: '0 12px 10px',
  color: 'var(--z-node-id-fg)',
  fontSize: 10,
} as const;
