'use client';

import type { CSSProperties } from 'react';
import type { SessionWorkspace } from '@cepage/shared-core';
import { useI18n } from './I18nProvider';

type SessionWorkspaceDialogProps = {
  open: boolean;
  sessionId: string | null;
  workspace: SessionWorkspace | null;
  parentDirectory: string;
  directoryName: string;
  pendingRun: boolean;
  onParentDirectoryChange: (value: string) => void;
  onDirectoryNameChange: (value: string) => void;
  onChooseParentDirectory: () => void;
  onClose: () => void;
  onSave: () => void;
};

export function SessionWorkspaceDialog({
  open,
  sessionId,
  workspace,
  parentDirectory,
  directoryName,
  pendingRun,
  onParentDirectoryChange,
  onDirectoryNameChange,
  onChooseParentDirectory,
  onClose,
  onSave,
}: SessionWorkspaceDialogProps) {
  const { t } = useI18n();

  if (!open) {
    return null;
  }

  const saveLabel = pendingRun ? t('ui.dialog.saveAndRun') : t('ui.dialog.save');
  const title = workspace ? t('ui.dialog.editTitle') : t('ui.dialog.setTitle');
  const autoName = sessionId ? `session-${sessionId.slice(0, 8)}` : 'session-xxxxxxx';

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '11px 12px',
    borderRadius: 10,
    border: `1px solid var(--z-border-input)`,
    background: 'var(--z-input-bg)',
    color: 'var(--z-fg)',
    outline: 'none',
  };

  const primaryButtonStyle: CSSProperties = {
    border: `1px solid var(--z-btn-solid-border)`,
    background: 'var(--z-btn-solid-bg)',
    color: 'var(--z-btn-solid-fg)',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 600,
  };

  const secondaryButtonStyle: CSSProperties = {
    border: `1px solid var(--z-btn-ghost-border)`,
    background: 'var(--z-btn-ghost-bg)',
    color: 'var(--z-btn-ghost-fg)',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--z-overlay)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        style={{
          width: 'min(520px, calc(100vw - 32px))',
          borderRadius: 18,
          border: `1px solid var(--z-dialog-border)`,
          background: `linear-gradient(180deg, var(--z-dialog-gradient-top) 0%, var(--z-dialog-gradient-bot) 100%)`,
          color: 'var(--z-fg)',
          boxShadow: 'var(--z-dialog-shadow)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: `1px solid var(--z-border-muted)`,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--z-dialog-body)' }}>
            {t('ui.dialog.body')}
          </div>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--z-label-fg)' }}>
              {t('ui.dialog.parentDir')}
            </span>
            <input
              value={parentDirectory}
              onChange={(event) => onParentDirectoryChange(event.target.value)}
              placeholder={t('ui.dialog.placeholderPath')}
              spellCheck={false}
              style={inputStyle}
            />
            <div>
              <button type="button" onClick={onChooseParentDirectory} style={secondaryButtonStyle}>
                {t('ui.dialog.chooseLocation')}
              </button>
            </div>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--z-label-fg)' }}>
              {t('ui.dialog.childDir')}
            </span>
            <input
              value={directoryName}
              onChange={(event) => onDirectoryNameChange(event.target.value)}
              placeholder={autoName}
              spellCheck={false}
              style={inputStyle}
            />
            <span style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--z-hint-fg)' }}>
              {t('ui.dialog.hintAuto')}
            </span>
          </label>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: `1px solid var(--z-section-border)`,
              background: 'var(--z-section-bg)',
              display: 'grid',
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                color: 'var(--z-fg-subtle)',
              }}
            >
              {t('ui.dialog.currentWorkspace')}
            </div>
            <div style={{ fontSize: 13, color: workspace ? 'var(--z-fg)' : 'var(--z-fg-section)' }}>
              {workspace?.workingDirectory ?? t('ui.dialog.notConfiguredYet')}
            </div>
          </div>

          {pendingRun ? (
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                border: `1px solid var(--z-pending-border)`,
                background: 'var(--z-pending-bg)',
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--z-pending-fg)',
              }}
            >
              {t('ui.dialog.pendingRun')}
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: 20,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            borderTop: `1px solid var(--z-border-muted)`,
          }}
        >
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            {t('ui.dialog.cancel')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!parentDirectory.trim()}
            style={{
              ...primaryButtonStyle,
              opacity: parentDirectory.trim() ? 1 : 0.55,
              cursor: parentDirectory.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
