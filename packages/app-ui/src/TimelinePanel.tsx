'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ActivityLine } from '@cepage/state';
import { copyTextToClipboard, useWorkspaceStore } from '@cepage/state';
import { formatActivityLine } from './formatWorkspace';
import { useI18n } from './I18nProvider';
import { filterTimeline, readTimelineNode, readTimelineRuns } from './timeline-helpers';

type TimelinePanelProps = {
  rows: ActivityLine[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelectNode: (nodeId: string) => void;
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function TimelinePanel({
  rows,
  loading,
  hasMore,
  onLoadMore,
  onSelectNode,
}: TimelinePanelProps) {
  const { t } = useI18n();
  const [actor, setActor] = useState<'all' | ActivityLine['actorType']>('all');
  const [runId, setRunId] = useState('');
  const runs = useMemo(() => readTimelineRuns(rows), [rows]);
  const items = useMemo(() => filterTimeline(rows, actor, runId), [rows, actor, runId]);

  const handleCopyActivity = useCallback(async () => {
    const text = JSON.stringify(items, null, 2);
    const ok = await copyTextToClipboard(text);
    useWorkspaceStore.setState({
      status: {
        key: ok ? 'status.activity_copied' : 'status.clipboard_copy_failed',
      },
    });
  }, [items]);

  return (
    <div style={{ display: 'grid', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={labelStyle}>
          <span>{t('ui.timeline.actor')}</span>
          <select value={actor} onChange={(event) => setActor(event.target.value as typeof actor)} style={selectStyle}>
            <option value="all">{t('ui.timeline.actorAll')}</option>
            <option value="human">{t('ui.timeline.actorHuman')}</option>
            <option value="agent">{t('ui.timeline.actorAgent')}</option>
            <option value="system">{t('ui.timeline.actorSystem')}</option>
          </select>
        </label>
        <label style={labelStyle}>
          <span>{t('ui.timeline.run')}</span>
          <select value={runId} onChange={(event) => setRunId(event.target.value)} style={selectStyle}>
            <option value="">{t('ui.timeline.runAll')}</option>
            {runs.map((entry) => (
              <option key={entry} value={entry}>
                {shortId(entry)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void handleCopyActivity()} style={copyBtnStyle}>
          {t('ui.timeline.copyActivity')}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8, minHeight: 0 }}>
        {items.length === 0 ? (
          <div style={emptyStyle}>{t('ui.sidebar.activityEmpty')}</div>
        ) : (
          items.map((row) => {
            const nodeId = readTimelineNode(row);
            return (
              <article key={row.id} style={itemStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={metaStyle}>
                      <span>{row.timestamp}</span>
                      <span>{t(`ui.timeline.actorType.${row.actorType}` as 'ui.timeline.actorType.human')}</span>
                      {row.runId ? <span>{shortId(row.runId)}</span> : null}
                      {row.requestId ? <span>{`req ${shortId(row.requestId)}`}</span> : null}
                      {row.workerId ? <span>{`worker ${shortId(row.workerId)}`}</span> : null}
                      {row.worktreeId ? <span>{`worktree ${shortId(row.worktreeId)}`}</span> : null}
                      {row.wakeReason ? <span>{`wake ${row.wakeReason}`}</span> : null}
                    </div>
                    <div style={{ color: 'var(--z-fg)', lineHeight: 1.45 }}>{formatActivityLine(row, t)}</div>
                  </div>
                  {nodeId ? (
                    <button type="button" style={focusBtnStyle} onClick={() => onSelectNode(nodeId)}>
                      {t('ui.timeline.focusNode')}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      {hasMore ? (
        <div>
          <button type="button" onClick={onLoadMore} disabled={loading} style={loadBtnStyle}>
            {loading ? t('ui.timeline.loading') : t('ui.timeline.loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const labelStyle = {
  display: 'grid',
  gap: 4,
  color: 'var(--z-fg-subtle)',
  fontSize: 11,
} as const;

const selectStyle = {
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 12,
} as const;

const itemStyle = {
  display: 'grid',
  gap: 6,
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-panel)',
  borderRadius: 12,
  padding: 10,
} as const;

const metaStyle = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  color: 'var(--z-fg-subtle)',
  fontSize: 10,
} as const;

const focusBtnStyle = {
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const;

const loadBtnStyle = {
  border: '1px solid var(--z-btn-primary-border)',
  background: 'var(--z-btn-primary-bg)',
  color: 'var(--z-btn-primary-fg)',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const emptyStyle = {
  color: 'var(--z-fg-subtle)',
  opacity: 0.8,
} as const;

const copyBtnStyle = {
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  marginLeft: 'auto',
} as const;
