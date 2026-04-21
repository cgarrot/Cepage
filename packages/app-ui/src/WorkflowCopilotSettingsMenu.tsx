'use client';

import type { WorkflowCopilotMode } from '@cepage/shared-core';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from './I18nProvider';

type MenuPosition = {
  left: number;
  top: number;
  place: 'top' | 'bottom';
};

type ScopeItem = {
  key: string;
  label: string;
  active: boolean;
  onSelect: () => void;
};

type WorkflowCopilotSettingsMenuProps = {
  label: string;
  disabled?: boolean;
  mode: WorkflowCopilotMode;
  autoApply: boolean;
  autoRun: boolean;
  scopes: ScopeItem[];
  onSelectMode: (mode: WorkflowCopilotMode) => void;
  onToggleAutoApply: () => void;
  onToggleAutoRun: () => void;
};

const MENU_WIDTH = 280;
const MENU_HEIGHT = 280;

function clampPosition(left: number, top: number, place: 'top' | 'bottom'): MenuPosition {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const padding = 16;
  return {
    left: Math.max(padding, Math.min(left, viewportWidth - MENU_WIDTH - padding)),
    top,
    place,
  };
}

export function WorkflowCopilotSettingsMenu({
  label,
  disabled = false,
  mode,
  autoApply,
  autoRun,
  scopes,
  onSelectMode,
  onToggleAutoApply,
  onToggleAutoRun,
}: WorkflowCopilotSettingsMenuProps) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
    place: 'top',
  });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const place = rect.top > MENU_HEIGHT + 24 ? 'top' : 'bottom';
    const left = rect.left;
    const top = place === 'top' ? rect.top - 8 : rect.bottom + 8;
    setMenuPosition(clampPosition(left, top, place));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (wrapRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="nodrag nopan" style={{ position: 'relative', minWidth: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        className="nodrag nopan"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        style={triggerStyle}
        title={label}
      >
        <span aria-hidden style={iconWrapStyle}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 4.5h10" />
            <path d="M3 8h10" />
            <path d="M3 11.5h10" />
            <circle cx="6" cy="4.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="10" cy="8" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="5" cy="11.5" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </span>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="nodrag nopan"
              style={menuStyle(menuPosition)}
            >
              <div style={groupStyle}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === 'edit'}
                  className="nodrag nopan"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectMode('edit');
                  }}
                  style={mode === 'edit' ? chipActiveStyle : chipStyle}
                >
                  {t('ui.sidebar.copilotModeEdit')}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === 'ask'}
                  className="nodrag nopan"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectMode('ask');
                  }}
                  style={mode === 'ask' ? chipActiveStyle : chipStyle}
                >
                  {t('ui.sidebar.copilotModeAsk')}
                </button>
              </div>
              {mode === 'edit' ? (
                <div style={groupStyle}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={autoApply}
                    className="nodrag nopan"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleAutoApply();
                    }}
                    style={autoApply ? chipActiveStyle : chipStyle}
                  >
                    {autoApply ? t('ui.sidebar.copilotAutoApplyOn') : t('ui.sidebar.copilotAutoApplyOff')}
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={autoRun}
                    className="nodrag nopan"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleAutoRun();
                    }}
                    style={autoRun ? chipActiveStyle : chipStyle}
                  >
                    {autoRun ? t('ui.sidebar.copilotAutoRunOn') : t('ui.sidebar.copilotAutoRunOff')}
                  </button>
                </div>
              ) : null}
              <div style={groupStyle}>
                {scopes.map((scope) => (
                  <button
                    key={scope.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={scope.active}
                    className="nodrag nopan"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      scope.onSelect();
                    }}
                    style={scope.active ? chipActiveStyle : chipStyle}
                  >
                    {scope.label}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const triggerStyle = {
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg-subtle)',
  cursor: 'pointer',
  flexShrink: 0,
} as const;

const iconWrapStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.9,
} as const;

function menuStyle(position: MenuPosition) {
  return {
    position: 'fixed',
    left: position.left,
    top: position.top,
    transform: position.place === 'top' ? 'translateY(-100%)' : 'none',
    zIndex: 1200,
    width: MENU_WIDTH,
    maxHeight: 320,
    overflowY: 'auto',
    display: 'grid',
    gap: 8,
    padding: 8,
    borderRadius: 12,
    border: '1px solid var(--z-menu-border)',
    background: 'var(--z-menu-bg)',
    boxShadow: 'var(--z-menu-shadow)',
    backdropFilter: 'blur(16px)',
  } as const;
}

const groupStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap' as const,
} as const;

const chipStyle = {
  border: '1px solid var(--z-border-lang)',
  background: 'var(--z-lang-bg)',
  color: 'var(--z-lang-fg)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const chipActiveStyle = {
  ...chipStyle,
  border: '1px solid var(--z-border-lang-active)',
  background: 'var(--z-lang-bg-active)',
  color: 'var(--z-fg)',
} as const;
