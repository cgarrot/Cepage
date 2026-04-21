'use client';

import { useMemo } from 'react';
import {
  Badge,
  Button,
  IconButton,
  IconPanelRight,
  IconStudio,
  Spinner,
  Tooltip,
} from '@cepage/ui-kit';
import { useWorkspaceStore } from '@cepage/state';
import { useI18n } from '../I18nProvider';
import { DaemonOfflineBanner } from '../DaemonOfflineBanner';
import { DaemonStatusBadge } from '../DaemonStatusBadge';
import { formatStatusLine } from '../formatWorkspace';
import { useDaemonStatus } from '../useDaemonStatus';
import { ThemeToggle } from './ThemeToggle';

type ChatHeaderProps = {
  onOpenStudio: () => void;
  onConfigureWorkspace: () => void;
  onToggleFiles: () => void;
  filesOpen: boolean;
};

/**
 * Top bar showing the active session, live status (busy runs / flows),
 * and the global toggles (open studio, switch theme, show/hide file panel).
 */
export function ChatHeader({
  onOpenStudio,
  onConfigureWorkspace,
  onToggleFiles,
  filesOpen,
}: ChatHeaderProps) {
  const { t } = useI18n();
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const status = useWorkspaceStore((s) => s.status);
  const activeRuns = useWorkspaceStore((s) => s.activeRuns);
  const activeFlows = useWorkspaceStore((s) => s.activeFlows);
  const sending = useWorkspaceStore((s) => s.workflowCopilotSending);
  const sessionWorkspace = useWorkspaceStore((s) => s.sessionWorkspace);
  const thread = useWorkspaceStore((s) => s.workflowCopilotThread);

  const statusText = useMemo(() => formatStatusLine(status, t), [status, t]);
  const subtitle = sessionWorkspace?.workingDirectory
    ? sessionWorkspace.workingDirectory
    : t('ui.chat.noWorkspace');
  const daemonStatus = useDaemonStatus();

  return (
    <>
      <header style={shellStyle}>
        <div style={leftStyle}>
          <div style={titleStyle}>
            {thread?.title ?? t('ui.chat.headerTitle')}
          </div>
          <div style={subtitleStyle}>
            <span style={pathStyle}>{subtitle}</span>
          </div>
        </div>
        <div style={metaStyle}>
          <DaemonStatusBadge state={daemonStatus} />
          {sending ? (
            <Badge tone="agent" outline icon={<Spinner size={10} thickness={2} />}>
              {t('ui.chat.thinking')}
            </Badge>
          ) : null}
          {activeRuns.length > 0 ? (
            <Badge tone="info" outline>
              {t('ui.chat.runsBadge', { count: String(activeRuns.length) })}
            </Badge>
          ) : null}
          {activeFlows.length > 0 ? (
            <Badge tone="info" outline>
              {t('ui.chat.flowsBadge', { count: String(activeFlows.length) })}
            </Badge>
          ) : null}
          {statusText ? (
            <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
              {statusText}
            </span>
          ) : null}
        </div>
        <div style={actionsStyle}>
          <Button variant="ghost" size="sm" onClick={onConfigureWorkspace} disabled={!sessionId}>
            {t(sessionWorkspace ? 'ui.menu.editSessionWorkspace' : 'ui.menu.configureWorkspace')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenStudio} disabled={!sessionId}>
            <IconStudio size={14} /> {t('ui.simple.openStudio')}
          </Button>
          <ThemeToggle />
          <Tooltip label={filesOpen ? t('ui.chat.filesHide') : t('ui.chat.filesShow')}>
            <IconButton
              size={28}
              label={filesOpen ? t('ui.chat.filesHide') : t('ui.chat.filesShow')}
              active={filesOpen}
              onClick={onToggleFiles}
            >
              <IconPanelRight size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </header>
      <DaemonOfflineBanner state={daemonStatus} />
    </>
  );
}

const shellStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '10px 16px',
  borderBottom: '1px solid var(--z-border)',
  background: 'var(--z-bg-app)',
  flexWrap: 'wrap' as const,
} as const;

const leftStyle = {
  display: 'grid',
  gap: 2,
  minWidth: 0,
  flex: '1 1 240px',
} as const;

const titleStyle = {
  fontSize: 15,
  fontWeight: 700,
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

const subtitleStyle = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  minWidth: 0,
} as const;

const pathStyle = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '50ch',
} as const;

const metaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap' as const,
} as const;

const actionsStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap' as const,
  marginLeft: 'auto',
} as const;
