import { Panel } from '@xyflow/react';
import type { SessionWorkspace } from '@cepage/shared-core';
import type { Locale, ThemeCepage, ThemeMode } from '@cepage/state';
import { CEPAGE_DEFAULTS, THEME_CEPAGES } from '@cepage/state';
import { useI18n } from './I18nProvider';
import {
  chipBtn,
  chipBtnActive,
  panelCompactBtn,
  panelPrimaryBtn,
  panelSecondaryBtn,
  panelToggleBtn,
} from './canvas-workspace-styles';

type CanvasWorkspacePanelProps = {
  t: ReturnType<typeof useI18n>['t'];
  locale: Locale;
  sessionId: string | null;
  sessionWorkspace: SessionWorkspace | null;
  statusText: string;
  themeMode: ThemeMode;
  themeCepage: ThemeCepage;
  prefsPanelOpen: boolean;
  canArrange: boolean;
  arranging: boolean;
  onArrange: () => void;
  onOpenWorkspaceDialog: () => void;
  onOpenWorkspaceDirectory: () => void;
  onPrefsPanelOpenChange: (next: boolean) => void;
  onLocaleChange: (next: Locale) => void;
  onThemeModeChange: (next: ThemeMode) => void;
  onThemeCepageChange: (next: ThemeCepage) => void;
};

export function CanvasWorkspacePanel({
  t,
  locale,
  sessionId,
  sessionWorkspace,
  statusText,
  themeMode,
  themeCepage,
  prefsPanelOpen,
  canArrange,
  arranging,
  onArrange,
  onOpenWorkspaceDialog,
  onOpenWorkspaceDirectory,
  onPrefsPanelOpenChange,
  onLocaleChange,
  onThemeModeChange,
  onThemeCepageChange,
}: CanvasWorkspacePanelProps) {
  return (
    <Panel position="top-left">
      {!prefsPanelOpen ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 14,
            border: '1px solid var(--z-bg-panel-border)',
            background: 'var(--z-bg-panel)',
            boxShadow: 'var(--z-bg-panel-shadow)',
            color: 'var(--z-fg)',
          }}
        >
          <strong style={{ fontSize: 13 }}>{t('ui.canvas.title')}</strong>
          <button
            type="button"
            disabled={!canArrange || arranging}
            aria-busy={arranging}
            onClick={onArrange}
            style={
              !canArrange || arranging
                ? {
                    ...panelCompactBtn,
                    opacity: 0.64,
                    cursor: arranging ? 'wait' : 'default',
                  }
                : panelCompactBtn
            }
          >
            {arranging ? t('ui.canvas.arranging') : t('ui.canvas.arrange')}
          </button>
          <button
            type="button"
            aria-expanded={false}
            aria-label={t('ui.canvas.panelExpand')}
            onClick={() => onPrefsPanelOpenChange(true)}
            style={panelToggleBtn}
          >
            ›
          </button>
        </div>
      ) : (
        <div
          style={{
            minWidth: 260,
            display: 'grid',
            gap: 6,
            padding: '12px 14px',
            borderRadius: 14,
            border: '1px solid var(--z-bg-panel-border)',
            background: 'var(--z-bg-panel)',
            boxShadow: 'var(--z-bg-panel-shadow)',
            color: 'var(--z-fg)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
                flexWrap: 'wrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              <strong style={{ fontSize: 14 }}>{t('ui.canvas.title')}</strong>
              <span style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>
                {sessionId ?? t('ui.canvas.noSession')}
              </span>
            </div>
            <button
              type="button"
              aria-expanded={true}
              aria-label={t('ui.canvas.panelCollapse')}
              onClick={() => onPrefsPanelOpenChange(false)}
              style={panelToggleBtn}
            >
              ‹
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--z-fg-subtle)' }}>{t('ui.canvas.langSwitch')}</span>
            <button
              type="button"
              onClick={() => onLocaleChange('en')}
              style={locale === 'en' ? chipBtnActive : chipBtn}
            >
              {t('ui.canvas.langEn')}
            </button>
            <button
              type="button"
              onClick={() => onLocaleChange('fr')}
              style={locale === 'fr' ? chipBtnActive : chipBtn}
            >
              {t('ui.canvas.langFr')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--z-fg-subtle)' }}>
              {t('ui.canvas.themeAppearance')}
            </span>
            <button
              type="button"
              onClick={() => onThemeModeChange('system')}
              style={themeMode === 'system' ? chipBtnActive : chipBtn}
            >
              {t('ui.canvas.themeSystem')}
            </button>
            <button
              type="button"
              onClick={() => onThemeModeChange('light')}
              style={themeMode === 'light' ? chipBtnActive : chipBtn}
            >
              {t('ui.canvas.themeLight')}
            </button>
            <button
              type="button"
              onClick={() => onThemeModeChange('dark')}
              style={themeMode === 'dark' ? chipBtnActive : chipBtn}
            >
              {t('ui.canvas.themeDark')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--z-fg-subtle)' }}>
              {t('ui.canvas.themeCepage')}
            </span>
            {THEME_CEPAGES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onThemeCepageChange(c)}
                style={themeCepage === c ? chipBtnActive : chipBtn}
              >
                {CEPAGE_DEFAULTS[c].label}
              </button>
            ))}
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: statusText ? 'var(--z-fg-status)' : 'var(--z-fg-dim)',
            }}
          >
            {statusText || t('ui.canvas.hintMenu')}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--z-fg-section)' }}>
            {t('ui.canvas.workspace')}:{' '}
            {sessionWorkspace ? (
              <span style={{ color: 'var(--z-fg)' }}>{sessionWorkspace.workingDirectory}</span>
            ) : (
              t('ui.canvas.notConfigured')
            )}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--z-fg-subtle)' }}>
            {t('ui.canvas.edgeHint')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onOpenWorkspaceDialog}
              style={panelPrimaryBtn}
            >
              {sessionWorkspace ? t('ui.canvas.editWorkspace') : t('ui.canvas.setWorkspace')}
            </button>
            <button
              type="button"
              disabled={!canArrange || arranging}
              aria-busy={arranging}
              onClick={onArrange}
              style={
                !canArrange || arranging
                  ? {
                      ...panelSecondaryBtn,
                      opacity: 0.64,
                      cursor: arranging ? 'wait' : 'default',
                    }
                  : panelSecondaryBtn
              }
            >
              {arranging ? t('ui.canvas.arranging') : t('ui.canvas.arrange')}
            </button>
            {sessionWorkspace ? (
              <button type="button" onClick={onOpenWorkspaceDirectory} style={panelSecondaryBtn}>
                {t('ui.canvas.openFolder')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
