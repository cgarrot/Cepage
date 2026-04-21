'use client';

import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getApiBaseUrl, restartRuntimeRun, stopRuntimeRun } from '@cepage/client-api';
import { readRuntimeRunSummary, type GraphNode, type RuntimeRunSummary, type WebPreviewInfo } from '@cepage/shared-core';
import { useWorkspaceStore } from '@cepage/state';
import { useI18n } from './I18nProvider';

type RuntimeRunNodeData = {
  raw: GraphNode;
  runtimeRun: RuntimeRunSummary | null;
};

export const RuntimeRunNode = memo(function RuntimeRunNode({ data, selected }: NodeProps) {
  const { t } = useI18n();
  const sessionId = useWorkspaceStore((state) => state.sessionId);
  const { raw, runtimeRun: initialRun } = data as RuntimeRunNodeData;
  const runtimeRun = initialRun ?? readRuntimeRunSummary(raw.metadata) ?? readRuntimeRunSummary(raw.content);
  const [pendingAction, setPendingAction] = useState<'stop' | 'restart' | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  if (!runtimeRun) {
    return (
      <div style={fallbackCardStyle}>
        <Handle type="target" position={Position.Top} />
        <div style={fallbackTitleStyle}>{t('nodeType.runtime_run')}</div>
        <div style={fallbackBodyStyle}>{t('ui.runtime.runMissing')}</div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  const previewSrc = toPreviewSrc(runtimeRun.preview);
  const previewHref = runtimeRun.preview?.url ?? previewSrc;
  const isActive = runtimeRun.status === 'running' || runtimeRun.status === 'launching';

  useEffect(() => {
    if (!previewExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewExpanded]);

  const handleStop = async () => {
    if (!sessionId || pendingAction) return;
    setPendingAction('stop');
    try {
      await stopRuntimeRun(sessionId, runtimeRun.runNodeId);
    } finally {
      setPendingAction(null);
    }
  };

  const handleRestart = async () => {
    if (!sessionId || pendingAction) return;
    setPendingAction('restart');
    try {
      await restartRuntimeRun(sessionId, runtimeRun.runNodeId);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div style={rootStyle}>
      <div
        style={{
          ...cardStyle,
          borderColor:
            selected
              ? 'var(--z-node-border-selected)'
              : runtimeRun.status === 'failed'
                ? 'var(--z-node-error-fg)'
                : 'var(--z-node-run-border)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={eyebrowStyle}>{t('nodeType.runtime_run')}</span>
            <strong style={titleStyle}>{runtimeRun.serviceName}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={statusChipStyle}>
              {t(`runtimeStatus.${runtimeRun.status}` as 'runtimeStatus.running')}
            </span>
            <button
              type="button"
              className="nodrag nopan"
              disabled={!isActive || pendingAction !== null}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void handleStop();
              }}
              style={secondaryButtonStyle}
            >
              {pendingAction === 'stop' ? t('ui.runtime.stopping') : t('ui.runtime.stop')}
            </button>
            <button
              type="button"
              className="nodrag nopan"
              disabled={pendingAction !== null}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void handleRestart();
              }}
              style={primaryButtonStyle}
            >
              {pendingAction === 'restart' ? t('ui.runtime.restarting') : t('ui.runtime.restart')}
            </button>
          </div>
        </div>

        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={chipStyle}>{t(`runtimeKind.${runtimeRun.targetKind}` as 'runtimeKind.web')}</span>
            <span style={chipStyle}>{t(`runtimeLaunchMode.${runtimeRun.launchMode}` as 'runtimeLaunchMode.local_process')}</span>
            {runtimeRun.pid ? <span style={chipStyle}>pid {runtimeRun.pid}</span> : null}
            {runtimeRun.exitCode !== undefined ? <span style={chipStyle}>exit {runtimeRun.exitCode}</span> : null}
          </div>

          <div style={sectionStyle}>
            <div style={labelStyle}>{t('ui.runtime.cwd')}</div>
            <div style={monoStyle}>{runtimeRun.cwd}</div>
          </div>

          {runtimeRun.command ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.runtime.command')}</div>
              <div style={monoStyle}>
                {runtimeRun.command}
                {(runtimeRun.args ?? []).length > 0 ? ` ${(runtimeRun.args ?? []).join(' ')}` : ''}
              </div>
            </div>
          ) : null}

          {(runtimeRun.ports ?? []).length > 0 ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.runtime.ports')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(runtimeRun.ports ?? []).map((port) => (
                  <span key={`${port.name ?? 'port'}-${port.port}`} style={chipStyle}>
                    {port.name ?? port.protocol ?? 'port'}:{port.port}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {runtimeRun.targetKind === 'web' ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={previewHeaderStyle}>
                <div style={labelStyle}>{t('ui.runtime.preview')}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {previewHref ? (
                    <a
                      href={previewHref}
                      target="_blank"
                      rel="noreferrer"
                      className="nodrag nopan"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      style={previewLinkStyle}
                    >
                      {t('ui.runtime.previewOpenNew')}
                    </a>
                  ) : null}
                  {previewSrc ? (
                    <button
                      type="button"
                      className="nodrag nopan"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPreviewExpanded(true);
                      }}
                      style={previewActionButtonStyle}
                    >
                      {t('ui.runtime.previewExpand')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div style={previewBoxStyle}>
                {runtimeRun.preview?.status === 'error' ? (
                  <div style={emptyStateStyle}>
                    {t('ui.runtime.previewError', { detail: runtimeRun.preview.error ?? 'unknown error' })}
                  </div>
                ) : previewSrc ? (
                  <iframe
                    title={`${runtimeRun.serviceName} preview`}
                    src={previewSrc}
                    style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
                  />
                ) : (
                  <div style={emptyStateStyle}>
                    {runtimeRun.status === 'launching'
                      ? t('ui.runtime.previewStarting')
                      : t('ui.runtime.previewUnavailable')}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={labelStyle}>{t('ui.runtime.logs')}</div>
            <pre style={logsStyle}>{runtimeRun.logs?.trim() || t('ui.runtime.logsEmpty')}</pre>
          </div>

          {runtimeRun.error ? <div style={errorStyle}>{runtimeRun.error}</div> : null}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
      {previewExpanded && previewSrc && typeof document !== 'undefined'
        ? createPortal(
            <div
              style={previewOverlayStyle}
              onClick={() => setPreviewExpanded(false)}
            >
              <div
                style={previewDialogStyle}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={previewDialogHeaderStyle}>
                  <div style={{ display: 'grid', gap: 2 }}>
                    <span style={eyebrowStyle}>{t('ui.runtime.previewExpanded')}</span>
                    <strong style={titleStyle}>{runtimeRun.serviceName}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {runtimeRun.preview?.url ? (
                      <a
                        href={runtimeRun.preview.url}
                        target="_blank"
                        rel="noreferrer"
                        style={previewLinkStyle}
                      >
                        {t('ui.runtime.previewOpenNew')}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPreviewExpanded(false)}
                      style={primaryButtonStyle}
                    >
                      {t('ui.runtime.previewClose')}
                    </button>
                  </div>
                </div>
                <div style={previewDialogBodyStyle}>
                  <iframe
                    title={`${runtimeRun.serviceName} preview expanded`}
                    src={previewSrc}
                    style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function toPreviewSrc(preview: WebPreviewInfo | undefined): string | null {
  if (!preview) return null;
  if (preview.embedPath) {
    if (/^https?:\/\//.test(preview.embedPath)) return preview.embedPath;
    return `${getApiBaseUrl()}${preview.embedPath}`;
  }
  return preview.url ?? null;
}

const rootStyle = {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
} as const;

const cardStyle = {
  borderRadius: 16,
  border: '1px solid var(--z-node-run-border)',
  background: 'linear-gradient(180deg, rgba(25, 206, 164, 0.14), rgba(12, 18, 32, 0.98))',
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

const eyebrowStyle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: 'var(--z-fg-subtle)',
} as const;

const titleStyle = {
  fontSize: 16,
  color: 'var(--z-fg)',
} as const;

const statusChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
  color: 'var(--z-fg)',
  fontSize: 11,
  fontWeight: 700,
} as const;

const primaryButtonStyle = {
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  background: 'rgba(255,255,255,0.04)',
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

const previewBoxStyle = {
  height: 180,
  minHeight: 180,
  borderRadius: 12,
  overflow: 'hidden',
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const previewHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
} as const;

const previewActionButtonStyle = {
  border: '1px solid var(--z-node-hint-border)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '5px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const logsStyle = {
  margin: 0,
  minHeight: 110,
  maxHeight: 180,
  overflow: 'auto',
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

const emptyStateStyle = {
  display: 'grid',
  placeItems: 'center',
  minHeight: 180,
  padding: 16,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-muted)',
  textAlign: 'center',
} as const;

const previewOverlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1300,
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  background: 'var(--z-overlay)',
  backdropFilter: 'blur(10px)',
} as const;

const previewDialogStyle = {
  width: 'min(1200px, calc(100vw - 32px))',
  height: 'min(85vh, 900px)',
  borderRadius: 18,
  border: '1px solid var(--z-dialog-border)',
  background: 'linear-gradient(180deg, var(--z-dialog-gradient-top) 0%, var(--z-dialog-gradient-bot) 100%)',
  color: 'var(--z-fg)',
  boxShadow: 'var(--z-dialog-shadow)',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
} as const;

const previewDialogHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  borderBottom: '1px solid var(--z-border-muted)',
} as const;

const previewDialogBodyStyle = {
  minHeight: 0,
  background: 'var(--z-bg-panel)',
} as const;

const previewLinkStyle = {
  color: 'var(--z-fg)',
  fontSize: 12,
  fontWeight: 600,
  textDecoration: 'none',
} as const;

const errorStyle = {
  padding: 10,
  borderRadius: 10,
  background: 'rgba(255, 93, 93, 0.12)',
  border: '1px solid rgba(255, 93, 93, 0.32)',
  color: 'var(--z-node-error-fg)',
  fontSize: 12,
  lineHeight: 1.5,
} as const;

const fallbackCardStyle = {
  ...cardStyle,
  padding: 12,
  display: 'grid',
  gap: 8,
} as const;

const fallbackTitleStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-fg)',
} as const;

const fallbackBodyStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-muted)',
} as const;
