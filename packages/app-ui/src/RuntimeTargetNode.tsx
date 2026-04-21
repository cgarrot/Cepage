'use client';

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { readRuntimeTargetSummary, type GraphNode, type RuntimeTargetSummary } from '@cepage/shared-core';
import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';
import { RunMenuButton } from './RunMenuButton';
import { useI18n } from './I18nProvider';

type RuntimeTargetNodeData = {
  raw: GraphNode;
  runtimeTarget: RuntimeTargetSummary | null;
};

export const RuntimeTargetNode = memo(function RuntimeTargetNode({ data, selected }: NodeProps) {
  const { t } = useI18n();
  const sessionId = useWorkspaceStore((state) => state.sessionId);
  const runFromNode = useWorkspaceStore((state) => state.runFromNode);
  const selectedIds = useWorkspaceStore((state) => state.selectedIds);
  const setSelected = useWorkspaceStore((state) => state.setSelected);
  const { raw, runtimeTarget: initialTarget } = data as RuntimeTargetNodeData;
  const runtimeTarget = initialTarget ?? readRuntimeTargetSummary(raw.metadata) ?? readRuntimeTargetSummary(raw.content);
  const { selection: nodeSelection } = useNodeAgentSelection(raw.id, raw);
  const [pending, setPending] = useState(false);
  const isStale = raw.status === 'archived' || raw.metadata?.stale === true;

  if (!runtimeTarget) {
    return (
      <div style={fallbackCardStyle}>
        <Handle type="target" position={Position.Top} />
        <div style={fallbackTitleStyle}>{t('nodeType.runtime_target')}</div>
        <div style={fallbackBodyStyle}>{t('ui.runtime.targetMissing')}</div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  const handleRun = async (selection: AgentRunSelection | null = null) => {
    if (!sessionId || pending) return;
    if (!(selectedIds.length > 1 && selectedIds.includes(raw.id))) {
      setSelected(raw.id);
    }
    setPending(true);
    try {
      await runFromNode(raw.id, selection);
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={rootStyle}>
      <div
        style={{
          ...cardStyle,
          borderColor: selected ? 'var(--z-node-border-selected)' : 'var(--z-node-run-border)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
          opacity: isStale ? 0.72 : 1,
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={eyebrowStyle}>{t('nodeType.runtime_target')}</span>
            <strong style={titleStyle}>{runtimeTarget.serviceName}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isStale ? (
              <span style={staleBadgeStyle}>{t('ui.runtime.stale')}</span>
            ) : null}
            <RunMenuButton
              isSpawnNode={false}
              isRerun
              disabled={!sessionId || pending}
              selection={nodeSelection}
              onRun={(selection) => {
                void handleRun(selection ?? null);
              }}
            />
          </div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <NodeAgentSelectionControl
            nodeId={raw.id}
            raw={raw}
            placeholder={t('ui.node.selectionChoose')}
          />
        </div>

        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={chipStyle}>{t(`runtimeKind.${runtimeTarget.kind}` as 'runtimeKind.web')}</span>
            <span style={chipStyle}>{t(`runtimeLaunchMode.${runtimeTarget.launchMode}` as 'runtimeLaunchMode.local_process')}</span>
            {runtimeTarget.monorepoRole ? <span style={chipStyle}>{runtimeTarget.monorepoRole}</span> : null}
            <span style={chipStyle}>{t(`runtimeSource.${runtimeTarget.source}` as 'runtimeSource.file')}</span>
          </div>

          <div style={sectionStyle}>
            <div style={labelStyle}>{t('ui.runtime.cwd')}</div>
            <div style={monoStyle}>{runtimeTarget.cwd}</div>
          </div>

          {runtimeTarget.command ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.runtime.command')}</div>
              <div style={monoStyle}>
                {runtimeTarget.command}
                {(runtimeTarget.args ?? []).length > 0 ? ` ${(runtimeTarget.args ?? []).join(' ')}` : ''}
              </div>
            </div>
          ) : null}

          {(runtimeTarget.ports ?? []).length > 0 ? (
            <div style={sectionStyle}>
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

          {runtimeTarget.preview ? (
            <div style={sectionStyle}>
              <div style={labelStyle}>{t('ui.runtime.preview')}</div>
              <div style={monoStyle}>
                {t(`runtimePreviewMode.${runtimeTarget.preview.mode ?? 'auto'}` as 'runtimePreviewMode.auto')}
                {runtimeTarget.preview.entry ? ` · ${runtimeTarget.preview.entry}` : ''}
              </div>
            </div>
          ) : null}

          {runtimeTarget.docker ? (
            <div style={sectionStyle}>
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
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});

const rootStyle = {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
} as const;

const cardStyle = {
  borderRadius: 16,
  border: '1px solid var(--z-node-run-border)',
  background: 'linear-gradient(180deg, rgba(81, 163, 255, 0.18), rgba(12, 18, 32, 0.96))',
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

const staleBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-header-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-fg-subtle)',
  fontSize: 10,
  fontWeight: 700,
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

const hintStyle = {
  padding: 10,
  borderRadius: 10,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-hint-fg)',
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
