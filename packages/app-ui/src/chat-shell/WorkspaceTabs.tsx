'use client';

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { CHAT_TAB_ID, useWorkspaceStore } from '@cepage/state';
import { IconFile, IconMessageCircle, IconX } from '@cepage/ui-kit';
import { useI18n } from '../I18nProvider';
import { FileViewer } from './FileViewer';
import type { ChatShellOpenStudioInput } from './types';

type WorkspaceTabsProps = {
  chat: ReactNode;
  onOpenStudio?: (input?: ChatShellOpenStudioInput) => void;
};

/**
 * Tab bar at the top of the main pane. The chat tab is pinned and always
 * available; opening a workspace file pushes a new closable tab. Clicking on
 * the chat tab swaps the rendered body back to the live transcript composer.
 */
export function WorkspaceTabs({ chat, onOpenStudio }: WorkspaceTabsProps) {
  const { t } = useI18n();
  const sessionId = useWorkspaceStore((s) => s.sessionId);
  const tabs = useWorkspaceStore((s) =>
    sessionId ? s.workspaceTabs[sessionId] ?? null : null,
  );
  const setActive = useWorkspaceStore((s) => s.setActiveWorkspaceTab);
  const closeTab = useWorkspaceStore((s) => s.closeWorkspaceFile);

  const activeId = tabs?.activeId ?? CHAT_TAB_ID;
  const order = tabs?.order ?? [];
  const byId = tabs?.byId ?? {};

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (tabId !== CHAT_TAB_ID) {
        event.preventDefault();
        closeTab(tabId);
      }
    }
  };

  return (
    <div style={containerStyle}>
      <div role="tablist" aria-label={t('ui.tabs.label')} style={tabBarStyle}>
        <TabButton
          active={activeId === CHAT_TAB_ID}
          onSelect={() => setActive(CHAT_TAB_ID)}
          tabId={CHAT_TAB_ID}
          label={t('ui.tabs.chat')}
          icon={<IconMessageCircle size={12} />}
        />
        {order.map((id) => {
          const tab = byId[id];
          if (!tab) return null;
          const active = id === activeId;
          return (
            <TabButton
              key={id}
              active={active}
              onSelect={() => setActive(id)}
              tabId={id}
              label={tab.title}
              title={tab.path}
              icon={<IconFile size={12} />}
              onClose={() => closeTab(id)}
              onKeyDown={(event) => onKeyDown(event, id)}
            />
          );
        })}
      </div>
      <div style={bodyStyle}>
        {/* Chat is kept mounted so transcript scroll position survives tab
            swaps. We toggle visibility with `display: none` instead of the
            `hidden` attribute because `panelStyle` sets `display: flex`,
            which would otherwise win over `hidden` and leak the chat behind
            the active file viewer. */}
        <div
          style={{
            ...panelStyle,
            display: activeId === CHAT_TAB_ID ? 'flex' : 'none',
          }}
        >
          {chat}
        </div>
        {order.map((id) => {
          if (id !== activeId) return null;
          const tab = byId[id];
          if (!tab) return null;
          return (
            <div key={id} style={panelStyle}>
              <FileViewer
                tab={tab}
                onRevealInStudio={
                  onOpenStudio ? () => onOpenStudio({ selectedNodeId: tab.id }) : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TabButtonProps = {
  active: boolean;
  label: string;
  tabId: string;
  title?: string;
  icon: ReactNode;
  onSelect: () => void;
  onClose?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function TabButton({
  active,
  label,
  tabId,
  title,
  icon,
  onSelect,
  onClose,
  onKeyDown,
}: TabButtonProps) {
  return (
    <div
      style={{
        ...tabWrapperStyle,
        background: active ? 'var(--z-bg-app)' : 'transparent',
        borderBottomColor: active ? 'transparent' : 'var(--z-border)',
      }}
      role="presentation"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={`tab-panel-${tabId}`}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        title={title ?? label}
        style={{
          ...tabButtonStyle,
          color: active ? 'var(--z-fg)' : 'var(--z-fg-muted)',
          fontWeight: active ? 600 : 500,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {icon}
          <span
            style={{
              maxWidth: 180,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
        </span>
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label="close tab"
          onClick={onClose}
          style={closeButtonStyle}
        >
          <IconX size={12} />
        </button>
      ) : null}
    </div>
  );
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  // `<Panel>` from react-resizable-panels is `display: block`, so a `flex: 1`
  // root would never get a real height. Use `width/height: 100%` to fill the
  // panel; the inner flex chain (bodyStyle → panelStyle → chatColumn) then
  // gives ChatTranscript an actual bounded height to scroll inside.
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  background: 'var(--z-bg-app)',
  overflow: 'hidden',
};

const tabBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 0,
  padding: '6px 8px 0',
  background: 'var(--z-bg-sidebar)',
  borderBottom: '1px solid var(--z-border)',
  overflowX: 'auto',
  flexShrink: 0,
};

const tabWrapperStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 6px 4px 10px',
  borderTopLeftRadius: 8,
  borderTopRightRadius: 8,
  borderTop: '1px solid var(--z-border)',
  borderLeft: '1px solid var(--z-border)',
  borderRight: '1px solid var(--z-border)',
  borderBottom: '1px solid var(--z-border)',
  marginRight: 4,
  position: 'relative' as const,
};

const tabButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '4px 6px',
  fontSize: 12,
  display: 'inline-flex',
  alignItems: 'center',
};

const closeButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 2,
  borderRadius: 4,
  color: 'var(--z-fg-muted)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

const panelStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};
