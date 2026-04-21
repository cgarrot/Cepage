'use client';

import type { CSSProperties } from 'react';
import { useI18n } from './I18nProvider';
import type { DaemonStatusState } from './useDaemonStatus';

type DaemonOfflineBannerProps = {
  state: DaemonStatusState;
};

const wrapperStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '8px 16px',
  borderBottom: '1px solid rgba(250, 204, 21, 0.32)',
  background: 'rgba(250, 204, 21, 0.10)',
  color: 'var(--z-fg)',
  fontSize: 12,
};

const titleStyle: CSSProperties = {
  fontWeight: 600,
  color: '#facc15',
};

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  background: 'rgba(0, 0, 0, 0.18)',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
};

/**
 * Persistent banner shown at the top of the chat column whenever no native
 * daemon is connected to the API. Helps users understand why their runs
 * stay queued instead of producing output.
 *
 * The banner stays hidden during the very first poll (before we know the
 * status), so we never flash a false-positive warning on initial load.
 */
export function DaemonOfflineBanner({ state }: DaemonOfflineBannerProps) {
  const { t } = useI18n();
  if (state.status === null) return null;
  if (state.status.online) return null;

  return (
    <div role="status" aria-live="polite" style={wrapperStyle}>
      <span aria-hidden style={{ fontSize: 14, lineHeight: '16px', color: '#facc15' }}>⚠</span>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={titleStyle}>{t('ui.chat.daemonBannerTitle')}</div>
        <div style={{ color: 'var(--z-fg-muted)' }}>{t('ui.chat.daemonBannerBody')}</div>
        <code style={codeStyle}>{t('ui.chat.daemonBannerCommand')}</code>
      </div>
    </div>
  );
}
