'use client';

import { useCallback, useEffect, useState } from 'react';
import { listSessions, type SessionLibraryRow } from '@cepage/client-api';
import {
  Badge,
  Button,
  IconButton,
  IconNew,
  IconPanelLeft,
  Spinner,
  Tooltip,
} from '@cepage/ui-kit';
import { useWorkspaceStore } from '@cepage/state';
import { useI18n } from '../I18nProvider';

type SessionsSidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function formatDate(value: string): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const today = new Date();
    const sameDay =
      date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    return sameDay
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

/**
 * Left rail listing existing sessions. Selecting a row swaps the active
 * session via {@link useWorkspaceStore.loadSession}; the {@link IconNew}
 * button bootstraps a fresh blank one. The rail can be collapsed to gain
 * room for the chat (or on smaller screens).
 */
export function SessionsSidebar({ collapsed, onToggleCollapsed }: SessionsSidebarProps) {
  const { t } = useI18n();
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const bootstrap = useWorkspaceStore((s) => s.bootstrapNewSession);
  const loadSession = useWorkspaceStore((s) => s.loadSession);
  const [items, setItems] = useState<SessionLibraryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listSessions({ status: 'active', limit: 50 });
      if (!res.success) {
        setError(res.error.message ?? 'sessions.list.failed');
        return;
      }
      setItems(res.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sessions.list.failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, sessionId]);

  const onCreate = useCallback(async () => {
    await bootstrap();
    void refresh();
  }, [bootstrap, refresh]);

  const onPick = useCallback(
    async (id: string) => {
      if (id === sessionId) return;
      await loadSession(id);
    },
    [loadSession, sessionId],
  );

  if (collapsed) {
    return (
      <aside style={collapsedStyle}>
        <Tooltip label={t('ui.chat.sidebarShow')} side="bottom">
          <IconButton
            size={28}
            label={t('ui.chat.sidebarShow')}
            onClick={onToggleCollapsed}
          >
            <IconPanelLeft size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t('ui.chat.sessionNew')} side="bottom">
          <IconButton size={28} label={t('ui.chat.sessionNew')} onClick={onCreate}>
            <IconNew size={16} />
          </IconButton>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside style={shellStyle}>
      <header style={headerStyle}>
        <div style={titleStyle}>{t('ui.chat.sessionsTitle')}</div>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <Tooltip label={t('ui.chat.sessionNew')} side="bottom">
            <IconButton size={26} label={t('ui.chat.sessionNew')} onClick={onCreate}>
              <IconNew size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t('ui.chat.sidebarHide')} side="bottom">
            <IconButton
              size={26}
              label={t('ui.chat.sidebarHide')}
              onClick={onToggleCollapsed}
            >
              <IconPanelLeft size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      <div style={listStyle}>
        {loading && !items ? (
          <div style={emptyStyle}>
            <Spinner size={16} /> <span>{t('ui.chat.loading')}</span>
          </div>
        ) : error ? (
          <div style={emptyStyle}>
            <span>{t('ui.chat.sessionLoadError', { message: error })}</span>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              {t('ui.chat.sessionsTitle')}
            </Button>
          </div>
        ) : !items || items.length === 0 ? (
          <div style={emptyStyle}>
            <span>{t('ui.chat.sessionsEmpty')}</span>
            <Button size="sm" variant="primary" onClick={() => void onCreate()}>
              {t('ui.chat.startSession')}
            </Button>
          </div>
        ) : (
          items.map((item) => {
            const active = item.id === sessionId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void onPick(item.id)}
                style={rowStyle(active)}
              >
                <div style={rowTitleStyle}>
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    {item.name || t('ui.chat.sessionUntitled')}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>
                    {formatDate(item.updatedAt)}
                  </span>
                </div>
                <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.counts.agentRuns > 0 ? (
                    <Badge tone="agent" outline>
                      {t('ui.chat.statusRuns', { count: String(item.counts.agentRuns) })}
                    </Badge>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

const shellStyle = {
  display: 'flex',
  width: '100%',
  height: '100%',
  flexDirection: 'column' as const,
  background: 'var(--z-bg-sidebar)',
  borderRight: '1px solid var(--z-border)',
  minHeight: 0,
  minWidth: 0,
} as const;

const collapsedStyle = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 8,
  padding: '12px 0',
  background: 'var(--z-bg-sidebar)',
  borderRight: '1px solid var(--z-border)',
  minHeight: '100vh',
} as const;

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  borderBottom: '1px solid var(--z-border)',
} as const;

const titleStyle = {
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--z-fg-subtle)',
  fontWeight: 600,
} as const;

const listStyle = {
  flex: 1,
  overflowY: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: 8,
} as const;

const emptyStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start',
  gap: 8,
  padding: 12,
  fontSize: 12,
  color: 'var(--z-fg-muted)',
} as const;

function rowStyle(active: boolean) {
  return {
    display: 'grid',
    gap: 6,
    padding: '8px 10px',
    borderRadius: 10,
    border: active
      ? '1px solid var(--z-accent-strong)'
      : '1px solid transparent',
    background: active ? 'var(--z-accent-soft)' : 'transparent',
    color: 'var(--z-fg)',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontSize: 12.5,
  };
}

const rowTitleStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 13,
} as const;
