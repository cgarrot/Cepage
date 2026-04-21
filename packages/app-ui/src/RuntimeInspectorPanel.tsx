'use client';

import { useMemo, useState } from 'react';
import { getApiBaseUrl, restartRuntimeRun, stopRuntimeRun } from '@cepage/client-api';
import {
  readRuntimeRunSummary,
  readRuntimeTargetSummary,
  type GraphNode,
  type WebPreviewInfo,
} from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { RunMenuButton } from './RunMenuButton';
import { useI18n } from './I18nProvider';

type RuntimeInspectorPanelProps = {
  sessionId: string | null;
  selectedNode: GraphNode;
};

export function RuntimeInspectorPanel({ sessionId, selectedNode }: RuntimeInspectorPanelProps) {
  const { t } = useI18n();
  const runFromNode = useWorkspaceStore((state) => state.runFromNode);
  const runtimeTarget =
    selectedNode.type === 'runtime_target'
      ? readRuntimeTargetSummary(selectedNode.metadata) ?? readRuntimeTargetSummary(selectedNode.content)
      : null;
  const runtimeRun =
    selectedNode.type === 'runtime_run'
      ? readRuntimeRunSummary(selectedNode.metadata) ?? readRuntimeRunSummary(selectedNode.content)
      : null;
  const previewSrc = useMemo(() => toPreviewSrc(runtimeRun?.preview), [runtimeRun?.preview]);
  const [pendingAction, setPendingAction] = useState<'run' | 'stop' | 'restart' | null>(null);

  if (!runtimeTarget && !runtimeRun) {
    return <div style={emptyStateStyle}>{t('ui.runtime.inspectorEmpty')}</div>;
  }

  const handleRun = async (selection: AgentRunSelection | null = null) => {
    if (!sessionId || !runtimeTarget || pendingAction) return;
    setPendingAction('run');
    try {
      await runFromNode(selectedNode.id, selection);
    } finally {
      setPendingAction(null);
    }
  };

  const handleStop = async () => {
    if (!sessionId || !runtimeRun || pendingAction) return;
    setPendingAction('stop');
    try {
      await stopRuntimeRun(sessionId, runtimeRun.runNodeId);
    } finally {
      setPendingAction(null);
    }
  };

  const handleRestart = async () => {
    if (!sessionId || !runtimeRun || pendingAction) return;
    setPendingAction('restart');
    try {
      await restartRuntimeRun(sessionId, runtimeRun.runNodeId);
    } finally {
      setPendingAction(null);
    }
  };

  if (runtimeTarget) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={summaryCardStyle}>
          <div style={headerRowStyle}>
            <div>
              <div style={subheadingStyle}>{t('nodeType.runtime_target')}</div>
              <div style={titleStyle}>{runtimeTarget.serviceName}</div>
            </div>
            <RunMenuButton
              isSpawnNode={false}
              isRerun
              disabled={!sessionId || pendingAction !== null}
              onRun={(selection) => {
                void handleRun(selection ?? null);
              }}
            />
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={chipStyle}>{t(`runtimeKind.${runtimeTarget.kind}` as 'runtimeKind.web')}</span>
            <span style={chipStyle}>
              {t(`runtimeLaunchMode.${runtimeTarget.launchMode}` as 'runtimeLaunchMode.local_process')}
            </span>
            <span style={chipStyle}>{t(`runtimeSource.${runtimeTarget.source}` as 'runtimeSource.file')}</span>
            {runtimeTarget.monorepoRole ? <span style={chipStyle}>{runtimeTarget.monorepoRole}</span> : null}
          </div>
        </div>

        <div style={sectionCardStyle}>
          <div style={labelStyle}>{t('ui.runtime.cwd')}</div>
          <div style={monoStyle}>{runtimeTarget.cwd}</div>
        </div>

        {runtimeTarget.command ? (
          <div style={sectionCardStyle}>
            <div style={labelStyle}>{t('ui.runtime.command')}</div>
            <div style={monoStyle}>
              {runtimeTarget.command}
              {(runtimeTarget.args ?? []).length > 0 ? ` ${(runtimeTarget.args ?? []).join(' ')}` : ''}
            </div>
          </div>
        ) : null}

        {(runtimeTarget.ports ?? []).length > 0 ? (
          <div style={sectionCardStyle}>
            <div style={labelStyle}>{t('ui.runtime.ports')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(runtimeTarget.ports ?? []).map((port) => (
                <span key={`${port.name ?? 'port'}-${port.port}`} style={chipStyle}>
                  {port.name ?? port.protocol ?? 'port'}:{port.port}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {runtimeTarget.docker ? (
          <div style={sectionCardStyle}>
            <div style={labelStyle}>{t('ui.runtime.docker')}</div>
            <div style={monoStyle}>
              {runtimeTarget.docker.image
                ? `${t('ui.runtime.dockerImage')}: ${runtimeTarget.docker.image}`
                : t('ui.runtime.dockerPlanned')}
              {runtimeTarget.docker.workingDir
                ? `\n${t('ui.runtime.dockerWorkdir')}: ${runtimeTarget.docker.workingDir}`
                : ''}
            </div>
          </div>
        ) : null}

        {runtimeTarget.launchMode === 'docker' ? (
          <div style={hintStyle}>{t('ui.runtime.dockerPlanned')}</div>
        ) : null}
      </div>
    );
  }

  const isActive = runtimeRun?.status === 'running' || runtimeRun?.status === 'launching';

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={summaryCardStyle}>
        <div style={headerRowStyle}>
          <div>
            <div style={subheadingStyle}>{t('nodeType.runtime_run')}</div>
            <div style={titleStyle}>{runtimeRun?.serviceName}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={!isActive || pendingAction !== null}
              onClick={() => void handleStop()}
              style={secondaryButtonStyle}
            >
              {pendingAction === 'stop' ? t('ui.runtime.stopping') : t('ui.runtime.stop')}
            </button>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void handleRestart()}
              style={primaryButtonStyle}
            >
              {pendingAction === 'restart' ? t('ui.runtime.restarting') : t('ui.runtime.restart')}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={chipStyle}>{t(`runtimeKind.${runtimeRun?.targetKind ?? 'web'}` as 'runtimeKind.web')}</span>
          <span style={chipStyle}>{t(`runtimeStatus.${runtimeRun?.status ?? 'planned'}` as 'runtimeStatus.running')}</span>
          {runtimeRun?.pid ? <span style={chipStyle}>pid {runtimeRun.pid}</span> : null}
          {runtimeRun?.exitCode !== undefined ? <span style={chipStyle}>exit {runtimeRun.exitCode}</span> : null}
        </div>
      </div>

      <div style={sectionCardStyle}>
        <div style={labelStyle}>{t('ui.runtime.cwd')}</div>
        <div style={monoStyle}>{runtimeRun?.cwd}</div>
      </div>

      {runtimeRun?.command ? (
        <div style={sectionCardStyle}>
          <div style={labelStyle}>{t('ui.runtime.command')}</div>
          <div style={monoStyle}>
            {runtimeRun.command}
            {(runtimeRun.args ?? []).length > 0 ? ` ${(runtimeRun.args ?? []).join(' ')}` : ''}
          </div>
        </div>
      ) : null}

      {(runtimeRun?.ports ?? []).length > 0 ? (
        <div style={sectionCardStyle}>
          <div style={labelStyle}>{t('ui.runtime.ports')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(runtimeRun?.ports ?? []).map((port) => (
              <span key={`${port.name ?? 'port'}-${port.port}`} style={chipStyle}>
                {port.name ?? port.protocol ?? 'port'}:{port.port}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {runtimeRun?.targetKind === 'web' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={subheadingStyle}>{t('ui.runtime.preview')}</div>
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
        <div style={subheadingStyle}>{t('ui.runtime.logs')}</div>
        <pre style={logsStyle}>{runtimeRun?.logs?.trim() || t('ui.runtime.logsEmpty')}</pre>
      </div>

      {runtimeRun?.error ? <div style={errorStyle}>{runtimeRun.error}</div> : null}
    </div>
  );
}

function toPreviewSrc(preview: WebPreviewInfo | undefined): string | null {
  if (!preview) return null;
  if (preview.embedPath) {
    if (/^https?:\/\//.test(preview.embedPath)) return preview.embedPath;
    return `${getApiBaseUrl()}${preview.embedPath}`;
  }
  return preview.url ?? null;
}

const summaryCardStyle = {
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const sectionCardStyle = {
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
  display: 'grid',
  gap: 6,
} as const;

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 10,
} as const;

const subheadingStyle = {
  fontSize: 12,
  color: 'var(--z-fg-subtle)',
} as const;

const titleStyle = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--z-fg)',
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
  height: 260,
  minHeight: 260,
  borderRadius: 12,
  overflow: 'hidden',
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
} as const;

const logsStyle = {
  margin: 0,
  minHeight: 140,
  maxHeight: 260,
  overflow: 'auto',
  padding: 12,
  borderRadius: 12,
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

const hintStyle = {
  padding: 10,
  borderRadius: 10,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-hint-fg)',
  fontSize: 12,
  lineHeight: 1.5,
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

const emptyStateStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-muted)',
} as const;
