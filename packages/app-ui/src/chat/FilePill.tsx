'use client';

import type { CSSProperties } from 'react';
import { IconExternal, IconFile } from '@cepage/ui-kit';
import type { ChatTimelineFile, WorkspaceFileEntry } from '@cepage/state';

type FileLike =
  | Pick<ChatTimelineFile, 'title' | 'path' | 'status' | 'change' | 'role'>
  | Pick<WorkspaceFileEntry, 'title' | 'path' | 'status' | 'change' | 'role'>;

type FilePillProps = {
  file: FileLike;
  onOpen?: () => void;
  onRevealInStudio?: () => void;
  compact?: boolean;
  style?: CSSProperties;
};

function changeColor(change: FileLike['change']): string {
  if (change === 'added') return '#22c55e';
  if (change === 'deleted') return '#ef4444';
  if (change === 'modified') return '#eab308';
  return 'var(--z-fg-muted)';
}

function changeLabel(change: FileLike['change']): string {
  if (change === 'added') return '+';
  if (change === 'deleted') return '-';
  if (change === 'modified') return '~';
  return '';
}

/**
 * Compact, click-to-open pill representing a single workspace file.
 * Shared between the chat transcript and the right-side file panel.
 */
export function FilePill({
  file,
  onOpen,
  onRevealInStudio,
  compact = false,
  style,
}: FilePillProps) {
  const interactive = Boolean(onOpen);
  const change = file.change;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onOpen : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: compact ? '4px 8px' : '6px 10px',
        borderRadius: 999,
        border: '1px solid var(--z-border)',
        background: 'var(--z-bg-sidebar)',
        color: 'var(--z-fg)',
        cursor: interactive ? 'pointer' : 'default',
        fontSize: compact ? 11 : 12,
        maxWidth: '100%',
        ...style,
      }}
      title={file.path}
    >
      <IconFile size={compact ? 12 : 14} />
      {change ? (
        <span
          aria-hidden
          style={{
            fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
            fontWeight: 700,
            color: changeColor(change),
          }}
        >
          {changeLabel(change)}
        </span>
      ) : null}
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 280,
        }}
      >
        {file.path}
      </span>
      {onRevealInStudio ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onRevealInStudio();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onRevealInStudio();
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--z-fg-muted)',
            fontSize: compact ? 10 : 11,
          }}
          title="Reveal in studio"
        >
          <IconExternal size={compact ? 10 : 12} />
        </span>
      ) : null}
    </div>
  );
}
