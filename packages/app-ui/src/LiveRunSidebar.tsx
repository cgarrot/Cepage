'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Node } from '@xyflow/react';
import type { Translator } from '@cepage/i18n';
import type { LiveRunDescriptor } from '@cepage/state';
import {
  readWorkflowControllerSummary,
  summarizeWorkflowDecisionValidatorContent,
  summarizeWorkflowLoopContent,
  summarizeWorkflowSubgraphContent,
  type GraphNode,
} from '@cepage/shared-core';
import { useI18n } from './I18nProvider';
import { MarkdownBody } from './MarkdownBody';
import { looksLikeMarkdown } from './looksLikeMarkdown';
import { SidebarSection } from './SidebarSection';

type LiveRunSidebarProps = {
  liveRuns: LiveRunDescriptor[];
  nodes: Node[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--z-fg-subtle)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};

const primaryCardStyle: CSSProperties = {
  padding: 12,
  borderRadius: 16,
  border: '1px solid var(--z-border)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--z-node-textarea-bg) 96%, transparent) 0%, color-mix(in srgb, var(--z-bg-sidebar) 92%, transparent) 100%)',
  display: 'grid',
  gap: 12,
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function readRawNode(node: Node): GraphNode {
  return (node.data as { raw: GraphNode }).raw;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNodeText(node: GraphNode): string {
  if (node.type === 'loop') {
    const summary = readWorkflowControllerSummary(node.metadata);
    const lines = [summarizeWorkflowLoopContent(node.content) || 'Loop controller'];
    if (summary?.currentItemLabel) {
      lines.push(summary.currentItemLabel);
    }
    return lines.filter(Boolean).join(' ');
  }
  if (node.type === 'sub_graph') {
    return summarizeWorkflowSubgraphContent(node.content) || '';
  }
  if (node.type === 'decision') {
    return summarizeWorkflowDecisionValidatorContent(node.content) || '';
  }
  return (
    readString((node.content as { text?: unknown }).text) ??
    readString((node.content as { output?: unknown }).output) ??
    readString((node.content as { message?: unknown }).message) ??
    ''
  );
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 96);
}

function formatElapsed(startedAt: string | undefined, endedAt: string | undefined, now: number): string {
  if (!startedAt) return '--';
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return '--';
  const diff = Math.max(0, end - start);
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor(diff / 60_000) % 60;
  const secs = Math.floor(diff / 1_000) % 60;
  if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatNodeLabel(node: GraphNode | undefined, nodeId: string | undefined, t: Translator): string {
  if (!nodeId) return '-';
  if (!node) return shortId(nodeId);
  const type = t(`nodeType.${node.type}` as 'nodeType.note');
  const preview = compactText(readNodeText(node));
  return preview ? `${type} ${shortId(node.id)} - ${preview}` : `${type} ${shortId(node.id)}`;
}

function statusBadge(run: LiveRunDescriptor, t: Translator): string {
  return run.isActive ? t('ui.sidebar.runActive') : t('ui.sidebar.runRecent');
}

function metricChip(active = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 9px',
    borderRadius: 999,
    border: active ? '1px solid var(--z-node-run-border)' : '1px solid var(--z-node-hint-border)',
    background: active ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
    color: active ? 'var(--z-fg)' : 'var(--z-fg-muted)',
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    lineHeight: 1.2,
  };
}

function MetricCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: '10px 12px',
        borderRadius: 12,
        border: accent ? '1px solid var(--z-node-run-border)' : '1px solid var(--z-border)',
        background: accent
          ? 'color-mix(in srgb, var(--z-node-run-bg) 82%, var(--z-node-textarea-bg) 18%)'
          : 'var(--z-bg-sidebar)',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={sectionLabelStyle}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--z-fg)' }}>{value}</div>
    </div>
  );
}

function OutputBody({ content }: { content: string }) {
  const text = content.trim();
  if (!text) return null;
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid var(--z-border)',
        background: 'var(--z-bg-sidebar)',
        color: 'var(--z-fg)',
        fontSize: 11.5,
        lineHeight: 1.55,
        whiteSpace: looksLikeMarkdown(text) ? 'normal' : 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 320,
        overflow: 'auto',
      }}
    >
      {looksLikeMarkdown(text) ? <MarkdownBody content={text} compact /> : text}
    </div>
  );
}

function NodeLink({
  label,
  node,
  nodeId,
  selectedNodeId,
  onSelectNode,
}: {
  label: string;
  node: GraphNode | undefined;
  nodeId: string | undefined;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={sectionLabelStyle}>{label}</span>
      {nodeId ? (
        <button
          type="button"
          onClick={() => onSelectNode(nodeId)}
          style={{
            textAlign: 'left',
            padding: '10px 11px',
            borderRadius: 12,
            border:
              selectedNodeId === nodeId
                ? '1px solid var(--z-node-run-border)'
                : '1px solid var(--z-border)',
            background:
              selectedNodeId === nodeId
                ? 'linear-gradient(180deg, color-mix(in srgb, var(--z-node-run-bg) 88%, transparent) 0%, color-mix(in srgb, var(--z-node-textarea-bg) 84%, transparent) 100%)'
                : 'linear-gradient(180deg, color-mix(in srgb, var(--z-node-textarea-bg) 96%, transparent) 0%, color-mix(in srgb, var(--z-bg-sidebar) 94%, transparent) 100%)',
            color: 'var(--z-fg)',
            fontSize: 11,
            lineHeight: 1.45,
            cursor: 'pointer',
          }}
        >
          {formatNodeLabel(node, nodeId, t)}
        </button>
      ) : (
        <div
          style={{
            padding: '10px 11px',
            borderRadius: 12,
            border: '1px solid var(--z-border)',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--z-node-textarea-bg) 96%, transparent) 0%, color-mix(in srgb, var(--z-bg-sidebar) 94%, transparent) 100%)',
            color: 'var(--z-fg-muted)',
            fontSize: 11,
          }}
        >
          -
        </div>
      )}
    </div>
  );
}

export function LiveRunSidebar({
  liveRuns,
  nodes,
  selectedNodeId,
  onSelectNode,
}: LiveRunSidebarProps) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const rawNodeById = useMemo(() => new Map(nodes.map((node) => [node.id, readRawNode(node)])), [nodes]);
  const ticking = liveRuns.some((run) => !run.endedAt);

  useEffect(() => {
    if (!ticking) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const primaryRun = liveRuns[0] ?? null;
  const extraRuns = liveRuns.slice(1, 5);
  const primaryLoopNode = primaryRun
    ? rawNodeById.get(
        primaryRun.rootNodeId ??
          primaryRun.triggerNodeId ??
          primaryRun.stepNodeId ??
          primaryRun.sourceNodeId ??
          '',
      )
    : undefined;
  const primaryController =
    primaryLoopNode?.type === 'loop' ? readWorkflowControllerSummary(primaryLoopNode.metadata) : null;
  const primaryLabel = primaryLoopNode?.type === 'loop' ? t('nodeType.loop') : primaryRun?.agentLabel ?? '';
  const controllerProgress =
    primaryController?.totalItems != null
      ? {
          current:
            primaryController.currentIndex != null
              ? String(Math.min(primaryController.currentIndex + 1, primaryController.totalItems))
              : primaryController.status === 'completed'
                ? String(primaryController.totalItems)
                : '0',
          total: String(primaryController.totalItems),
        }
      : null;
  const summary = primaryRun
    ? `${primaryLabel} · ${t(`agentRunStatus.${primaryRun.status}`)}`
    : t('ui.sidebar.runEmpty');

  return (
    <SidebarSection title={t('ui.sidebar.run')} defaultOpen={false} summary={summary}>
      {!primaryRun ? (
        <span style={{ opacity: 0.6 }}>{t('ui.sidebar.runEmpty')}</span>
      ) : (
        <>
          <div
            style={{
              ...primaryCardStyle,
              border: primaryRun.isActive ? '1px solid var(--z-node-run-border)' : '1px solid var(--z-border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <div style={{ minWidth: 0, display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--z-fg)', lineHeight: 1.35 }}>{primaryLabel}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>
                    {t('ui.sidebar.runId', { id: shortId(primaryRun.id) })}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: primaryRun.isActive ? 'var(--z-fg-status)' : 'var(--z-fg-muted)' }}>
                  {t('ui.sidebar.runStatus', {
                    status: t(`agentRunStatus.${primaryRun.status}`),
                  })}
                </div>
              </div>
              <div
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 9px',
                  borderRadius: 999,
                  border: primaryRun.isActive ? '1px solid var(--z-node-run-border)' : '1px solid var(--z-border)',
                  background: primaryRun.isActive ? 'var(--z-node-run-bg)' : 'var(--z-node-hint-bg)',
                  color: primaryRun.isActive ? 'var(--z-fg)' : 'var(--z-fg-muted)',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: primaryRun.isActive ? 'var(--z-fg-status)' : 'var(--z-fg-dim)',
                    display: 'inline-block',
                  }}
                />
                {statusBadge(primaryRun, t)}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 8,
                gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
              }}
            >
              <MetricCard
                label={t('ui.sidebar.liveElapsedLabel')}
                value={formatElapsed(primaryRun.startedAt, primaryRun.endedAt, now)}
              />
              {controllerProgress ? (
                <MetricCard
                  label={t('ui.sidebar.liveProgressLabel')}
                  value={`${controllerProgress.current}/${controllerProgress.total}`}
                  accent
                />
              ) : null}
              {primaryController?.attemptsTotal != null ? (
                <MetricCard
                  label={t('ui.sidebar.liveAttemptsLabel')}
                  value={String(primaryController.attemptsTotal)}
                />
              ) : null}
            </div>

            {primaryController?.currentItemLabel || primaryController?.lastDecision ? (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: '1px solid var(--z-node-header-border)',
                  background:
                    'color-mix(in srgb, var(--z-node-run-bg) 34%, var(--z-node-textarea-bg) 66%)',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={sectionLabelStyle}>{t('ui.sidebar.liveCurrentItemLabel')}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--z-fg)', lineHeight: 1.35 }}>
                    {primaryController.currentItemLabel ?? primaryLabel}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {primaryController.currentItemLabel ? (
                    <div style={metricChip(primaryRun.isActive)}>
                      {t('ui.sidebar.controllerCurrentItem', {
                        label: primaryController.currentItemLabel,
                      })}
                    </div>
                  ) : null}
                  {primaryController.lastDecision ? (
                    <div style={metricChip()}>
                      {t('ui.sidebar.controllerLastDecision', {
                        decision: primaryController.lastDecision,
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={sectionLabelStyle}>{t('ui.sidebar.runWorkspace')}</span>
                <div
                  style={{
                    padding: '10px 11px',
                    borderRadius: 12,
                    border: '1px solid var(--z-border)',
                    background: 'var(--z-bg-sidebar)',
                    color: 'var(--z-fg)',
                    fontSize: 11,
                    lineHeight: 1.45,
                    wordBreak: 'break-all',
                  }}
                >
                  {primaryRun.workspacePath ?? '-'}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <NodeLink
                  label={t('ui.sidebar.runSourceNode')}
                  node={primaryRun.sourceNodeId ? rawNodeById.get(primaryRun.sourceNodeId) : undefined}
                  nodeId={primaryRun.sourceNodeId}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
                <NodeLink
                  label={t('ui.sidebar.runNode')}
                  node={primaryRun.rootNodeId ? rawNodeById.get(primaryRun.rootNodeId) : undefined}
                  nodeId={primaryRun.rootNodeId}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
                <NodeLink
                  label={t('ui.sidebar.runOutputNode')}
                  node={primaryRun.outputNodeId ? rawNodeById.get(primaryRun.outputNodeId) : undefined}
                  nodeId={primaryRun.outputNodeId}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={metricChip(primaryRun.isActive)}>
                  {t('ui.sidebar.runContext', { count: String(primaryRun.seedNodeIds.length) })}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 4 }}>
                <span style={sectionLabelStyle}>{t('ui.sidebar.runOutput')}</span>
                {primaryRun.output.trim().length > 0 ? (
                  <OutputBody content={primaryRun.output} />
                ) : (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--z-border)',
                      background: 'var(--z-bg-sidebar)',
                      color: primaryRun.isActive ? 'var(--z-fg-status)' : 'var(--z-fg-muted)',
                      fontSize: 11,
                      lineHeight: 1.5,
                    }}
                  >
                    {primaryRun.isActive
                      ? primaryRun.workspacePath
                        ? t('ui.sidebar.runWaitingOutput', { path: primaryRun.workspacePath })
                        : t('ui.sidebar.runWaitingOutputNoPath')
                      : t('ui.sidebar.runNoOutput')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {extraRuns.length > 0 ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={sectionLabelStyle}>{t('ui.sidebar.runMore')}</span>
              {extraRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => {
                    if (run.rootNodeId) onSelectNode(run.rootNodeId);
                    else if (run.outputNodeId) onSelectNode(run.outputNodeId);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '10px 11px',
                    borderRadius: 12,
                    border: '1px solid var(--z-border)',
                    background:
                      'linear-gradient(180deg, color-mix(in srgb, var(--z-node-textarea-bg) 96%, transparent) 0%, color-mix(in srgb, var(--z-bg-sidebar) 94%, transparent) 100%)',
                    color: 'var(--z-fg)',
                    display: 'grid',
                    gap: 6,
                    cursor: run.rootNodeId || run.outputNodeId ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{run.agentLabel}</span>
                    <span style={{ fontSize: 10, color: run.isActive ? 'var(--z-fg-status)' : 'var(--z-fg-muted)' }}>
                      {t(`agentRunStatus.${run.status}`)}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--z-fg-muted)' }}>
                    {t('ui.sidebar.runId', { id: shortId(run.id) })}
                  </span>
                  {run.output.trim().length > 0 ? (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid var(--z-border)',
                        background: 'var(--z-bg-sidebar)',
                        fontSize: 11,
                        color: 'var(--z-fg-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      {compactText(run.output)}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </SidebarSection>
  );
}
