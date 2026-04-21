'use client';

import { Badge, IconButton, IconExternal, IconEye, IconFile, Tooltip } from '@cepage/ui-kit';
import type { ChatTimelineFile } from '@cepage/state';
import { AgentBadge } from './AgentBadge';
import { BlockShell } from './BlockShell';

type FileWriteBlockProps = {
  file: ChatTimelineFile;
  onPreview?: () => void;
  onRevealInStudio?: () => void;
  /**
   * Primary click action on the file pill itself (the row with the filename +
   * relative path). Wiring this makes the pill behave like an IDE file row:
   * clicking opens the file tab and selects it in the right-side workspace
   * files panel. Leave unset for a non-interactive display.
   */
  onOpen?: () => void;
};

function changeTone(change: ChatTimelineFile['change']): 'success' | 'warning' | 'danger' | 'info' {
  if (change === 'added') return 'success';
  if (change === 'modified') return 'warning';
  if (change === 'deleted') return 'danger';
  return 'info';
}

function changeLabel(change: ChatTimelineFile['change']): string {
  return change ?? 'declared';
}

/**
 * Inline display when an agent produces / modifies a workspace file. Surfaces
 * the path, status, and a short summary, with quick actions to preview or
 * jump to the file in studio mode.
 */
export function FileWriteBlock({ file, onPreview, onRevealInStudio, onOpen }: FileWriteBlockProps) {
  const pillChildren = (
    <>
      <IconFile size={14} color="var(--z-fg-muted)" />
      <strong style={{ fontSize: 13 }}>{file.title}</strong>
      <code
        style={{
          fontSize: 11,
          color: 'var(--z-fg-muted)',
          fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}
        title={file.path}
      >
        {file.path}
      </code>
    </>
  );
  return (
    <BlockShell tone="subtle" padding={12} style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <AgentBadge actor={file.actor} showModel={false} />
        <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>wrote</span>
        <Badge tone={changeTone(file.change)} outline>{changeLabel(file.change)}</Badge>
        <Badge tone="neutral" outline>{file.role}</Badge>
        {file.status !== 'available' ? <Badge tone="info" outline>{file.status}</Badge> : null}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {onPreview ? (
            <Tooltip label="Preview">
              <IconButton size={26} label="Preview file" onClick={onPreview}>
                <IconEye size={14} />
              </IconButton>
            </Tooltip>
          ) : null}
          {onRevealInStudio ? (
            <Tooltip label="Reveal in studio">
              <IconButton size={26} label="Reveal in studio" onClick={onRevealInStudio}>
                <IconExternal size={14} />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          title={`Open ${file.path}`}
          style={{
            ...pillStyle,
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
            color: 'var(--z-fg)',
            font: 'inherit',
            transition: 'background 120ms ease, border-color 120ms ease',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'var(--z-bg-hover, var(--z-accent-soft))';
            event.currentTarget.style.borderColor = 'var(--z-border-strong, var(--z-accent))';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'var(--z-bg-app)';
            event.currentTarget.style.borderColor = 'var(--z-border)';
          }}
          onFocus={(event) => {
            event.currentTarget.style.background = 'var(--z-bg-hover, var(--z-accent-soft))';
            event.currentTarget.style.borderColor = 'var(--z-border-strong, var(--z-accent))';
          }}
          onBlur={(event) => {
            event.currentTarget.style.background = 'var(--z-bg-app)';
            event.currentTarget.style.borderColor = 'var(--z-border)';
          }}
        >
          {pillChildren}
        </button>
      ) : (
        <div style={pillStyle}>{pillChildren}</div>
      )}
      {file.summary ? (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--z-fg)' }}>
          {file.summary}
        </p>
      ) : file.excerpt ? (
        <pre
          style={{
            margin: 0,
            padding: 10,
            background: 'var(--z-node-textarea-bg)',
            border: '1px solid var(--z-border)',
            borderRadius: 10,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            color: 'var(--z-fg)',
            overflow: 'hidden',
            maxHeight: 240,
          }}
        >
          {file.excerpt}
        </pre>
      ) : null}
    </BlockShell>
  );
}

const pillStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 10,
  background: 'var(--z-bg-app)',
  border: '1px solid var(--z-border)',
} as const;
