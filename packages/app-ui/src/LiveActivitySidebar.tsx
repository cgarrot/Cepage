'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Node } from '@xyflow/react';
import type { WorkflowControllerState, GraphNode, WorkflowControllerItem } from '@cepage/shared-core';
import { summarizeWorkflowLoopContent } from '@cepage/shared-core';
import type { LiveRunDescriptor } from '@cepage/state';
import { useI18n } from './I18nProvider';
import { MarkdownBody } from './MarkdownBody';
import { looksLikeMarkdown } from './looksLikeMarkdown';
import { SidebarSection } from './SidebarSection';

type LiveActivitySidebarProps = {
  activeControllers: WorkflowControllerState[];
  activeRuns: LiveRunDescriptor[];
  nodes: Node[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

type ControllerStatus = WorkflowControllerState['status'] | WorkflowControllerItem['status'];
type StatusTone = {
  background: string;
  border: string;
  color: string;
  dot: string;
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--z-fg-subtle)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};

const cardStyle: CSSProperties = {
  minWidth: 0,
  padding: 14,
  borderRadius: 16,
  border: '1px solid var(--z-border)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--z-node-textarea-bg) 96%, transparent) 0%, color-mix(in srgb, var(--z-bg-sidebar) 92%, transparent) 100%)',
  display: 'grid',
  gap: 12,
  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.12)',
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function readRawNode(node: Node): GraphNode {
  return (node.data as { raw: GraphNode }).raw;
}

function readItem(rows: readonly WorkflowControllerItem[], index: number | undefined): WorkflowControllerItem | null {
  if (index == null) return null;
  return rows.find((row) => row.index === index) ?? null;
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

function formatLoopLabel(node: GraphNode | undefined, fallback: string): string {
  if (!node || node.type !== 'loop') return fallback;
  return summarizeWorkflowLoopContent(node.content) || fallback;
}

function countItems(rows: readonly WorkflowControllerItem[]): Record<WorkflowControllerItem['status'], number> {
  return rows.reduce(
    (acc, row) => ({
      ...acc,
      [row.status]: acc[row.status] + 1,
    }),
    {
      pending: 0,
      running: 0,
      retrying: 0,
      completed: 0,
      blocked: 0,
      failed: 0,
      skipped: 0,
    } satisfies Record<WorkflowControllerItem['status'], number>,
  );
}

function progress(controller: WorkflowControllerState): { current: string; total: string } | null {
  const total = controller.totalItems ?? controller.items.length;
  if (total <= 0) return null;
  if (controller.currentIndex != null) {
    return {
      current: String(Math.min(controller.currentIndex + 1, total)),
      total: String(total),
    };
  }
  if (controller.status === 'completed') {
    return { current: String(total), total: String(total) };
  }
  const done = controller.items.filter((row) => row.status !== 'pending').length;
  return { current: String(done), total: String(total) };
}

function progressPercent(next: { current: string; total: string } | null): number {
  if (!next) return 0;
  const current = Number(next.current);
  const total = Number(next.total);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function readStatusTone(status: ControllerStatus): StatusTone {
  if (status === 'running' || status === 'retrying') {
    return {
      border: '1px solid var(--z-node-run-border)',
      background: 'var(--z-node-run-bg)',
      color: 'var(--z-fg)',
      dot: 'var(--z-accent)',
    };
  }
  if (status === 'completed') {
    return {
      border: '1px solid color-mix(in srgb, var(--z-accent) 30%, transparent)',
      background: 'color-mix(in srgb, var(--z-accent) 14%, transparent)',
      color: 'var(--z-fg)',
      dot: 'var(--z-accent)',
    };
  }
  if (status === 'blocked') {
    return {
      border: '1px solid color-mix(in srgb, #f59e0b 32%, transparent)',
      background: 'color-mix(in srgb, #f59e0b 12%, transparent)',
      color: 'var(--z-fg)',
      dot: '#f59e0b',
    };
  }
  if (status === 'failed' || status === 'cancelled') {
    return {
      border: '1px solid color-mix(in srgb, var(--z-node-error-fg) 32%, transparent)',
      background: 'color-mix(in srgb, var(--z-node-error-fg) 12%, transparent)',
      color: 'var(--z-fg)',
      dot: 'var(--z-node-error-fg)',
    };
  }
  if (status === 'pending') {
    return {
      border: '1px solid var(--z-pending-border)',
      background: 'var(--z-pending-bg)',
      color: 'var(--z-pending-fg)',
      dot: 'var(--z-accent)',
    };
  }
  return {
    border: '1px solid var(--z-node-hint-border)',
    background: 'var(--z-node-hint-bg)',
    color: 'var(--z-fg-muted)',
    dot: 'var(--z-fg-dim)',
  };
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

function focusable(targetId: string | undefined, selectedNodeId: string | null): CSSProperties {
  return {
    width: '100%',
    minWidth: 0,
    textAlign: 'left',
    padding: '12px 13px',
    borderRadius: 14,
    border:
      targetId && selectedNodeId === targetId
        ? '1px solid var(--z-node-run-border)'
        : '1px solid var(--z-border)',
    background:
      targetId && selectedNodeId === targetId
        ? 'linear-gradient(180deg, color-mix(in srgb, var(--z-node-run-bg) 88%, transparent) 0%, color-mix(in srgb, var(--z-node-textarea-bg) 82%, transparent) 100%)'
        : 'linear-gradient(180deg, color-mix(in srgb, var(--z-node-textarea-bg) 96%, transparent) 0%, color-mix(in srgb, var(--z-bg-sidebar) 94%, transparent) 100%)',
    color: 'var(--z-fg)',
    display: 'grid',
    gap: 8,
    overflow: 'hidden',
    cursor: targetId ? 'pointer' : 'default',
  };
}

function StatusPill({
  status,
  label,
  emphasis = false,
}: {
  status: ControllerStatus;
  label: string;
  emphasis?: boolean;
}) {
  const tone = readStatusTone(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: emphasis ? '6px 10px' : '4px 8px',
        borderRadius: 999,
        border: tone.border,
        background: tone.background,
        color: tone.color,
        fontSize: emphasis ? 11 : 10.5,
        fontWeight: emphasis ? 700 : 600,
        lineHeight: 1.2,
      }}
    >
      <span
        aria-hidden
        style={{
          width: emphasis ? 8 : 7,
          height: emphasis ? 8 : 7,
          borderRadius: 999,
          background: tone.dot,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
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

function SummaryBody({ content }: { content: string }) {
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
        fontSize: 11,
        lineHeight: 1.55,
        wordBreak: 'break-word',
        overflowX: 'hidden',
      }}
    >
      {looksLikeMarkdown(text) ? (
        <MarkdownBody content={text} compact />
      ) : (
        <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
      )}
    </div>
  );
}

export function LiveActivitySidebar({
  activeControllers,
  activeRuns,
  nodes,
  selectedNodeId,
  onSelectNode,
}: LiveActivitySidebarProps) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, readRawNode(node)])), [nodes]);
  const runById = useMemo(() => new Map(activeRuns.map((run) => [run.id, run])), [activeRuns]);
  const ticking = activeControllers.some((row) => !row.endedAt) || activeRuns.some((row) => !row.endedAt);

  useEffect(() => {
    if (!ticking) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const summary =
    activeControllers.length > 0 || activeRuns.length > 0
      ? t('ui.sidebar.liveProgressSummary', {
          loops: String(activeControllers.length),
          runs: String(activeRuns.length),
        })
      : t('ui.sidebar.liveProgressEmpty');

  return (
    <SidebarSection
      title={t('ui.sidebar.liveProgress')}
      defaultOpen
      summary={summary}
      contentStyle={{ display: 'grid', gap: 12, minWidth: 0 }}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <strong style={{ color: 'var(--z-sidebar-heading)', fontSize: 12 }}>{t('ui.sidebar.liveLoops')}</strong>
        {activeControllers.length === 0 ? (
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: '1px solid var(--z-border)',
              background: 'var(--z-node-textarea-bg)',
              color: 'var(--z-fg-muted)',
              fontSize: 12,
            }}
          >
            {t('ui.sidebar.liveLoopsEmpty')}
          </div>
        ) : (
          activeControllers.map((controller) => {
            const node = nodeById.get(controller.controllerNodeId);
            const row = readItem(controller.items, controller.currentIndex);
            const currentRun = controller.currentChildRunId ? runById.get(controller.currentChildRunId) : null;
            const counts = countItems(controller.items);
            const next = progress(controller);
            const percent = progressPercent(next);
            const title = formatLoopLabel(node, `${t('nodeType.loop')} ${shortId(controller.controllerNodeId)}`);
            const currentLabel = row ? `${row.index + 1}. ${row.label ?? row.key}` : null;
            return (
              <div
                key={controller.id}
                style={cardStyle}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--z-fg)', lineHeight: 1.35 }}>{title}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>#{shortId(controller.id)}</span>
                      {controller.executionId ? (
                        <span style={{ fontSize: 11, color: 'var(--z-fg-subtle)' }}>{shortId(controller.executionId)}</span>
                      ) : null}
                    </div>
                  </div>
                  <StatusPill
                    status={controller.status}
                    label={t(`workflowControllerStatus.${controller.status}`)}
                    emphasis
                  />
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {next ? (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: 11,
                          color: 'var(--z-fg-muted)',
                        }}
                      >
                        <span>{t('ui.sidebar.controllerProgress', { current: next.current, total: next.total })}</span>
                        <span>{percent}%</span>
                      </div>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 999,
                          background: 'var(--z-node-hint-bg)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${percent}%`,
                            height: '100%',
                            borderRadius: 999,
                            background:
                              'linear-gradient(90deg, var(--z-accent) 0%, color-mix(in srgb, var(--z-accent) 68%, white) 100%)',
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: 'grid',
                      gap: 8,
                      gridTemplateColumns: next
                        ? 'repeat(auto-fit, minmax(104px, 1fr))'
                        : 'repeat(auto-fit, minmax(132px, 1fr))',
                    }}
                  >
                    {next ? <MetricCard label={t('ui.sidebar.liveProgressLabel')} value={`${next.current}/${next.total}`} accent /> : null}
                    <MetricCard
                      label={t('ui.sidebar.liveElapsedLabel')}
                      value={formatElapsed(controller.startedAt, controller.endedAt, now)}
                    />
                    <MetricCard label={t('ui.sidebar.liveAttemptsLabel')} value={String(controller.attemptsTotal)} />
                  </div>
                </div>

                {row || currentRun || controller.lastDecision ? (
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
                        {currentLabel ?? t(`workflowControllerStatus.${controller.status}`)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {row ? (
                        <StatusPill
                          status={row.status}
                          label={t(`workflowControllerItemStatus.${row.status}`)}
                        />
                      ) : null}
                      {row ? (
                        <div style={metricChip(row.status === 'running' || row.status === 'retrying')}>
                          {t('ui.sidebar.liveAttempts', { count: String(row.attempts) })}
                        </div>
                      ) : null}
                      {currentRun ? (
                        <div style={metricChip(true)}>
                          {t('ui.sidebar.liveCurrentRun', {
                            id: shortId(currentRun.id),
                            value: formatElapsed(currentRun.startedAt, currentRun.endedAt, now),
                          })}
                        </div>
                      ) : null}
                      {controller.lastDecision ? (
                        <div style={metricChip()}>
                          {t('ui.sidebar.controllerLastDecision', {
                            decision: controller.lastDecision,
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={sectionLabelStyle}>{t('ui.sidebar.liveStatusBreakdown')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(Object.keys(counts) as WorkflowControllerItem['status'][]).map((status) =>
                      counts[status] > 0 ? (
                        <StatusPill
                          key={status}
                          status={status}
                          label={`${t(`workflowControllerItemStatus.${status}`)} ${counts[status]}`}
                        />
                      ) : null,
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={sectionLabelStyle}>{t('ui.sidebar.liveItems')}</div>
                  <div
                    style={{
                      display: 'grid',
                      gap: 8,
                      maxHeight: 320,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      paddingRight: 2,
                    }}
                  >
                    {controller.items.map((item) => (
                      <div
                        key={item.key}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 14,
                          border:
                            controller.currentIndex === item.index
                              ? '1px solid var(--z-node-run-border)'
                              : '1px solid var(--z-border)',
                          background:
                            controller.currentIndex === item.index
                              ? 'color-mix(in srgb, var(--z-node-run-bg) 60%, var(--z-node-textarea-bg) 40%)'
                              : 'var(--z-bg-sidebar)',
                          display: 'grid',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                          <div style={{ minWidth: 0, display: 'grid', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  minWidth: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  border:
                                    controller.currentIndex === item.index
                                      ? '1px solid var(--z-node-run-border)'
                                      : '1px solid var(--z-node-hint-border)',
                                  background:
                                    controller.currentIndex === item.index
                                      ? 'var(--z-node-run-bg)'
                                      : 'var(--z-node-hint-bg)',
                                  color: 'var(--z-fg)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {item.index + 1}
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: 'var(--z-fg)',
                                  lineHeight: 1.4,
                                  wordBreak: 'break-word',
                                }}
                              >
                                {item.label ?? item.key}
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              <StatusPill
                                status={item.status}
                                label={t(`workflowControllerItemStatus.${item.status}`)}
                              />
                              <div
                                style={metricChip(
                                  controller.currentIndex === item.index &&
                                    (item.status === 'running' || item.status === 'retrying'),
                                )}
                              >
                                {t('ui.sidebar.liveAttempts', { count: String(item.attempts) })}
                              </div>
                            </div>
                          </div>
                        </div>
                        {item.summary?.trim() ? (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div style={sectionLabelStyle}>{t('ui.sidebar.liveSummary')}</div>
                            <SummaryBody content={item.summary} />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <strong style={{ color: 'var(--z-sidebar-heading)', fontSize: 12 }}>{t('ui.sidebar.liveRuns')}</strong>
        {activeRuns.length === 0 ? (
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: '1px solid var(--z-border)',
              background: 'var(--z-node-textarea-bg)',
              color: 'var(--z-fg-muted)',
              fontSize: 12,
            }}
          >
            {t('ui.sidebar.liveRunsEmpty')}
          </div>
        ) : (
          activeRuns.map((run) => {
            const nodeId = run.rootNodeId ?? run.outputNodeId ?? run.sourceNodeId;
            const preview = run.output.trim();
            return (
              <div
                key={run.id}
                tabIndex={nodeId ? 0 : -1}
                aria-label={`${run.agentLabel} · ${t('ui.sidebar.runId', { id: shortId(run.id) })}`}
                onClick={() => {
                  if (nodeId) onSelectNode(nodeId);
                }}
                onKeyDown={(e) => {
                  if (!nodeId) return;
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelectNode(nodeId);
                }}
                style={focusable(nodeId, selectedNodeId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, wordBreak: 'break-word' }}>
                      {run.agentLabel}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>
                      {t('ui.sidebar.runId', { id: shortId(run.id) })}
                    </div>
                  </div>
                  <div style={metricChip(run.isActive)}>{t(`agentRunStatus.${run.status}`)}</div>
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
                    value={formatElapsed(run.startedAt, run.endedAt, now)}
                    accent={run.isActive}
                  />
                  <MetricCard
                    label={t('ui.sidebar.runContextLabel')}
                    value={String(run.seedNodeIds.length)}
                  />
                </div>

                {run.workspacePath ? (
                  <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                    <div style={sectionLabelStyle}>{t('ui.sidebar.runWorkspace')}</div>
                    <div
                      style={{
                        padding: '10px 11px',
                        borderRadius: 12,
                        border: '1px solid var(--z-border)',
                        background: 'var(--z-bg-sidebar)',
                        fontSize: 11,
                        lineHeight: 1.45,
                        color: 'var(--z-fg)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {run.workspacePath}
                    </div>
                  </div>
                ) : null}

                {preview.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <div style={sectionLabelStyle}>{t('ui.sidebar.runOutput')}</div>
                    <div
                      style={{
                        padding: '10px 11px',
                        borderRadius: 12,
                        border: '1px solid var(--z-border)',
                        background: 'var(--z-bg-sidebar)',
                        fontSize: 11,
                        color: 'var(--z-fg-muted)',
                        lineHeight: 1.5,
                        maxHeight: 180,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        minWidth: 0,
                      }}
                    >
                      {looksLikeMarkdown(preview) ? (
                        <MarkdownBody content={preview} compact />
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {preview.replace(/\s+/g, ' ').trim().slice(0, 280)}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {!preview.length ? (
                  <div
                    style={{
                      padding: '10px 11px',
                      borderRadius: 12,
                      border: '1px solid var(--z-border)',
                      background: 'var(--z-bg-sidebar)',
                      fontSize: 11,
                      color: 'var(--z-fg-muted)',
                      lineHeight: 1.45,
                    }}
                  >
                    {run.isActive ? t('ui.sidebar.runWaitingOutputNoPath') : t('ui.sidebar.runNoOutput')}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </SidebarSection>
  );
}
