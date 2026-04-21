'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Badge, Tooltip } from '@cepage/ui-kit';
import { useI18n } from './I18nProvider';
import type { DaemonStatusState } from './useDaemonStatus';

type DaemonStatusBadgeProps = {
  state: DaemonStatusState;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

const dotStyleBase: CSSProperties = {
  display: 'inline-block',
  width: 7,
  height: 7,
  borderRadius: 999,
};

/**
 * Compact badge surfacing whether at least one native daemon is currently
 * polling the API. Hovering reveals the heartbeat timestamp and the count of
 * connected daemons.
 *
 * The badge intentionally renders in a stable position whether the daemon is
 * online, offline, or still being checked, to avoid layout shift in the chat
 * header.
 */
export function DaemonStatusBadge({ state }: DaemonStatusBadgeProps) {
  const { t } = useI18n();

  const view = useMemo(() => {
    if (state.status === null) {
      return {
        tone: 'neutral' as const,
        label: t('ui.chat.daemonUnknownLabel'),
        tooltip: t('ui.chat.daemonUnknownTooltip'),
        dotColor: 'var(--z-fg-muted)',
      };
    }
    if (!state.status.online) {
      return {
        tone: 'warning' as const,
        label: t('ui.chat.daemonOfflineLabel'),
        tooltip: t('ui.chat.daemonOfflineTooltip'),
        dotColor: '#facc15',
      };
    }
    const count = state.status.count;
    const tooltipKey =
      count === 1 ? 'ui.chat.daemonOnlineTooltipOne' : 'ui.chat.daemonOnlineTooltipMany';
    return {
      tone: 'success' as const,
      label: t('ui.chat.daemonOnlineLabel'),
      tooltip: t(tooltipKey, {
        count: String(count),
        when: formatTimestamp(state.status.lastSeenAt),
      }),
      dotColor: '#22c55e',
    };
  }, [state.status, t]);

  return (
    <Tooltip label={view.tooltip} side="bottom">
      <Badge
        tone={view.tone}
        outline
        icon={<span style={{ ...dotStyleBase, background: view.dotColor }} />}
        aria-live="polite"
      >
        {view.label}
      </Badge>
    </Tooltip>
  );
}
