'use client';

import { useWorkspaceStore, type AgentRunSelection } from '@cepage/state';
import { Button } from '@cepage/ui-kit';
import { AgentModelMenu } from './AgentModelMenu';
import { useI18n } from './I18nProvider';

type RunMenuButtonProps = {
  isSpawnNode: boolean;
  isRerun?: boolean;
  label?: string;
  title?: string;
  disabled?: boolean;
  showModelMenu?: boolean;
  selection?: AgentRunSelection | null;
  onRun: (selection?: AgentRunSelection | null) => void;
};

export function RunMenuButton({
  isSpawnNode,
  isRerun = false,
  label,
  title,
  disabled = false,
  showModelMenu = true,
  selection,
  onRun,
}: RunMenuButtonProps) {
  const { t } = useI18n();
  const lastRunSelection = useWorkspaceStore((s) => s.lastRunSelection);
  const currentSelection = selection ?? lastRunSelection;
  const buttonBackground = isSpawnNode ? 'var(--z-node-run-spawn-bg)' : 'var(--z-node-run-bg)';
  const buttonBorder = isSpawnNode
    ? `1px solid var(--z-node-run-spawn-border)`
    : `1px solid var(--z-node-run-border)`;

  const triggerRun = (selection?: AgentRunSelection | null) => {
    onRun(selection);
  };

  if (!showModelMenu) {
    return (
      <Button
        className="nodrag nopan"
        style={{
          fontSize: 10,
          padding: '3px 8px',
          borderRadius: 6,
          background: buttonBackground,
          border: buttonBorder,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
        title={title}
        disabled={disabled}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          triggerRun(null);
        }}
      >
        {label ?? (isRerun ? t('ui.node.runAgain') : t('ui.node.run'))}
      </Button>
    );
  }

  return (
    <AgentModelMenu
      selection={currentSelection}
      onSelect={(selection) => triggerRun(selection)}
      renderTrigger={({ open, selectionLabel, toggle }) => (
        <div
          className="nodrag nopan"
          style={{ display: 'inline-grid', gap: 4, position: 'relative', justifyItems: 'end' }}
        >
          <div style={{ display: 'inline-flex' }}>
            <Button
              className="nodrag nopan"
              style={{
                fontSize: 10,
                padding: '3px 7px',
                borderRadius: '6px 0 0 6px',
                background: buttonBackground,
                border: buttonBorder,
                borderRight: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
              }}
              title={title}
              disabled={disabled}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                triggerRun(null);
              }}
            >
              {label ?? (isRerun ? t('ui.node.runAgain') : t('ui.node.run'))}
            </Button>
            <Button
              aria-label={t('ui.node.runOptions')}
              aria-expanded={open}
              aria-haspopup="menu"
              className="nodrag nopan"
              style={{
                fontSize: 10,
                padding: '3px 6px',
                minWidth: 26,
                borderRadius: '0 6px 6px 0',
                background: buttonBackground,
                border: buttonBorder,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
              }}
              disabled={disabled}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
            >
              v
            </Button>
          </div>
          {selectionLabel ? (
            <div
              title={selectionLabel}
              style={{
                maxWidth: 110,
                fontSize: 9,
                lineHeight: 1.2,
                color: 'var(--z-menu-desc)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'right',
                textTransform: 'none',
                letterSpacing: 'normal',
              }}
            >
              {selectionLabel}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
