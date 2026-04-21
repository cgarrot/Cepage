'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ensureAgentRunPreview,
  getAgentRunArtifactFile,
  getAgentRunArtifacts,
  getAgentRunPreviewStatus,
  getApiBaseUrl,
} from '@cepage/client-api';
import {
  readRuntimeRunSummary,
  readRuntimeTargetSummary,
  readRunArtifactsSummary,
  type GraphNode,
  type RunArtifactsBundle,
  type WebPreviewInfo,
} from '@cepage/shared-core';
import { ArtifactFileViewer, type ArtifactFileView } from './ArtifactFileViewer';
import { useI18n } from './I18nProvider';
import { RuntimeInspectorPanel } from './RuntimeInspectorPanel';
import { SidebarSection } from './SidebarSection';

type WorkspaceInspectorPanelProps = {
  sessionId: string | null;
  selectedNode: GraphNode | null;
};

export function WorkspaceInspectorPanel({
  sessionId,
  selectedNode,
}: WorkspaceInspectorPanelProps) {
  const { t } = useI18n();
  const selectedSummary = useMemo(
    () => (selectedNode?.type === 'agent_output' ? readRunArtifactsSummary(selectedNode.metadata) : null),
    [selectedNode],
  );
  const runtimeTarget = useMemo(
    () =>
      selectedNode?.type === 'runtime_target'
        ? readRuntimeTargetSummary(selectedNode.metadata) ?? readRuntimeTargetSummary(selectedNode.content)
        : null,
    [selectedNode],
  );
  const runtimeRun = useMemo(
    () =>
      selectedNode?.type === 'runtime_run'
        ? readRuntimeRunSummary(selectedNode.metadata) ?? readRuntimeRunSummary(selectedNode.content)
        : null,
    [selectedNode],
  );
  const isRuntimeSelected = Boolean(runtimeTarget || runtimeRun);
  const runId = selectedSummary?.runId ?? null;
  const [artifacts, setArtifacts] = useState<RunArtifactsBundle | null>(null);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<ArtifactFileView | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const previewStartedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !runId) {
      setArtifacts(null);
      setArtifactsLoading(false);
      setArtifactsError(null);
      setSelectedPath(null);
      setFileData(null);
      return;
    }
    let active = true;
    setArtifacts({
      summary:
        selectedSummary ?? {
          runId,
          ownerNodeId: selectedNode?.id ?? runId,
          outputNodeId: selectedNode?.id,
          cwd: '.',
          generatedAt: new Date(0).toISOString(),
          counts: { added: 0, modified: 0, deleted: 0, total: 0 },
          files: [],
          preview: { status: 'idle' },
        },
      files: [],
    });
    setArtifactsLoading(true);
    setArtifactsError(null);
    void getAgentRunArtifacts(sessionId, runId).then((response) => {
      if (!active) return;
      setArtifactsLoading(false);
      if (!response.success) {
        setArtifactsError(response.error.message);
        return;
      }
      setArtifacts(response.data);
      const nextPath = response.data.files[0]?.path ?? null;
      setSelectedPath((current) => (current && response.data.files.some((file) => file.path === current) ? current : nextPath));
    });
    return () => {
      active = false;
    };
  }, [runId, selectedNode?.id, selectedSummary, sessionId]);

  useEffect(() => {
    if (!selectedSummary) return;
    setArtifacts((current) => {
      if (!current || current.summary.runId !== selectedSummary.runId) {
        return current;
      }
      return {
        ...current,
        summary: {
          ...current.summary,
          ...selectedSummary,
        },
      };
    });
  }, [selectedSummary]);

  useEffect(() => {
    if (!sessionId || !runId || !selectedPath) {
      setFileData(null);
      setFileLoading(false);
      return;
    }
    let active = true;
    setFileLoading(true);
    void getAgentRunArtifactFile(sessionId, runId, selectedPath).then((response) => {
      if (!active) return;
      setFileLoading(false);
      if (!response.success) {
        setFileData(null);
        return;
      }
      setFileData(response.data);
    });
    return () => {
      active = false;
    };
  }, [runId, selectedPath, sessionId]);

  useEffect(() => {
    if (!sessionId || !runId || !artifacts) {
      return;
    }
    const preview = artifacts.summary.preview;
    if (preview.status !== 'idle' && preview.status !== 'available') {
      return;
    }
    if (previewStartedRef.current === runId) {
      return;
    }
    previewStartedRef.current = runId;
    let active = true;
    void ensureAgentRunPreview(sessionId, runId).then((response) => {
      if (!active || !response.success) return;
      setArtifacts((current) =>
        current
          ? {
              ...current,
              summary: {
                ...current.summary,
                preview: response.data,
              },
            }
          : current,
      );
    });
    return () => {
      active = false;
    };
  }, [artifacts, runId, sessionId]);

  useEffect(() => {
    if (!sessionId || !runId || artifacts?.summary.preview.status !== 'launching') {
      return;
    }
    let active = true;
    let timer = 0;
    const poll = async () => {
      const response = await getAgentRunPreviewStatus(sessionId, runId);
      if (!active || !response.success) return;
      setArtifacts((current) =>
        current
          ? {
              ...current,
              summary: {
                ...current.summary,
                preview: response.data,
              },
            }
          : current,
      );
      if (response.data.status === 'launching') {
        timer = window.setTimeout(poll, 1200);
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [artifacts?.summary.preview.status, runId, sessionId]);

  const preview = artifacts?.summary.preview ?? selectedSummary?.preview ?? null;
  const previewSrc = preview ? toPreviewSrc(preview) : null;
  const inspectorSummary =
    runtimeRun?.serviceName ??
    runtimeTarget?.serviceName ??
    selectedSummary?.cwd ??
    t('ui.sidebar.inspectorEmpty');

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <SidebarSection title={t('ui.sidebar.inspector')} defaultOpen={false} summary={inspectorSummary}>
        {selectedNode && isRuntimeSelected ? (
          <RuntimeInspectorPanel sessionId={sessionId} selectedNode={selectedNode} />
        ) : !sessionId || !selectedSummary ? (
          <div style={emptyStateStyle}>{t('ui.sidebar.inspectorEmpty')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 10, minHeight: 0 }}>
            <div style={summaryCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--z-fg-subtle)' }}>{t('ui.sidebar.files')}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--z-fg)' }}>
                    {selectedSummary.cwd}
                  </div>
                </div>
                <span style={statusBadgeStyle}>{preview ? t(`previewStatus.${preview.status}` as 'previewStatus.idle') : ''}</span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {renderCountChip(String(selectedSummary.counts.added), t('fileChangeKind.added'))}
                {renderCountChip(String(selectedSummary.counts.modified), t('fileChangeKind.modified'))}
                {renderCountChip(String(selectedSummary.counts.deleted), t('fileChangeKind.deleted'))}
              </div>
              {artifactsError ? (
                <div style={{ marginTop: 8, color: 'var(--z-node-error-fg)', fontSize: 12 }}>{artifactsError}</div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <strong style={subheadingStyle}>{t('ui.sidebar.preview')}</strong>
                {preview?.url ? (
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--z-fg)', fontSize: 12 }}
                  >
                    {t('ui.sidebar.openPreview')}
                  </a>
                ) : null}
              </div>
              <div style={previewBoxStyle}>
                {preview?.status === 'unavailable' ? (
                  <div style={emptyStateStyle}>{t('ui.sidebar.previewUnavailable')}</div>
                ) : preview?.status === 'error' ? (
                  <div style={emptyStateStyle}>
                    {t('ui.sidebar.previewError', { detail: preview.error ?? 'unknown error' })}
                  </div>
                ) : previewSrc ? (
                  <iframe
                    title={t('ui.sidebar.livePreview')}
                    src={previewSrc}
                    style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
                  />
                ) : (
                  <div style={emptyStateStyle}>{t('ui.sidebar.previewStarting')}</div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, minHeight: 0 }}>
              <strong style={subheadingStyle}>{t('ui.sidebar.files')}</strong>
              <div style={fileListStyle}>
                {artifactsLoading ? (
                  <div style={emptyStateStyle}>{t('ui.sidebar.loadingFiles')}</div>
                ) : !artifacts || artifacts.files.length === 0 ? (
                  <div style={emptyStateStyle}>{t('ui.sidebar.filesEmpty')}</div>
                ) : (
                  artifacts.files.map((file) => (
                    <button
                      key={`${file.kind}:${file.path}`}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      style={{
                        ...fileRowStyle,
                        borderColor:
                          selectedPath === file.path ? 'var(--z-node-run-border)' : 'var(--z-border)',
                        background:
                          selectedPath === file.path ? 'var(--z-node-run-bg)' : 'var(--z-bg-sidebar)',
                      }}
                    >
                      <span style={fileKindBadgeStyle}>{t(`fileChangeKind.${file.kind}` as 'fileChangeKind.added')}</span>
                      <span style={{ textAlign: 'left', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {file.path}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, flex: 1, minHeight: 0 }}>
              <strong style={subheadingStyle}>{t('ui.sidebar.viewer')}</strong>
              <div style={viewerStyle}>
                {fileLoading ? (
                  <div style={emptyStateStyle}>{t('ui.sidebar.loadingFile')}</div>
                ) : !fileData ? (
                  <div style={emptyStateStyle}>{t('ui.sidebar.viewerEmpty')}</div>
                ) : (
                  <ArtifactFileViewer file={fileData} />
                )}
              </div>
            </div>
          </div>
        )}
      </SidebarSection>

    </div>
  );
}

function renderCountChip(value: string, label: string) {
  return (
    <span style={countChipStyle}>
      <strong>{value}</strong> {label}
    </span>
  );
}

function toPreviewSrc(preview: WebPreviewInfo): string | null {
  if (preview.embedPath) {
    if (/^https?:\/\//.test(preview.embedPath)) return preview.embedPath;
    return `${getApiBaseUrl()}${preview.embedPath}`;
  }
  return preview.url ?? null;
}

const subheadingStyle = {
  fontSize: 12,
  color: 'var(--z-fg)',
} as const;

const summaryCardStyle = {
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const previewBoxStyle = {
  height: 220,
  minHeight: 220,
  borderRadius: 12,
  overflow: 'hidden',
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const fileListStyle = {
  maxHeight: 180,
  overflow: 'auto',
  display: 'grid',
  gap: 6,
} as const;

const fileRowStyle = {
  width: '100%',
  border: '1px solid var(--z-border)',
  borderRadius: 10,
  padding: '8px 10px',
  color: 'var(--z-fg)',
  display: 'grid',
  gap: 6,
  cursor: 'pointer',
} as const;

const fileKindBadgeStyle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  opacity: 0.8,
} as const;

const viewerStyle = {
  minHeight: 0,
  overflow: 'auto',
  padding: 10,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const emptyStateStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-muted)',
} as const;

const countChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-chip-fg)',
  fontSize: 11,
} as const;

const statusBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-status-spawn-border)',
  background: 'var(--z-node-status-spawn-bg)',
  color: 'var(--z-node-status-spawn-fg)',
  fontSize: 11,
} as const;
