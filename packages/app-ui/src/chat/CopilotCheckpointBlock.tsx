'use client';

import type { CSSProperties } from 'react';
import type { ChatTimelineCopilotCheckpoint } from '@cepage/state';
import { Button, IconRotateCcw } from '@cepage/ui-kit';

type CopilotCheckpointBlockProps = {
  item: ChatTimelineCopilotCheckpoint;
  restoring?: boolean;
  onRestore?: (checkpointId: string) => void;
  labels: {
    checkpoint: string;
    restore: string;
    restoring: string;
  };
};

/**
 * Compact strip rendered between the user message and the assistant reply
 * when a checkpoint was created. Lets the user roll back the graph to the
 * pre-apply state without leaving the chat surface.
 */
export function CopilotCheckpointBlock({
  item,
  restoring = false,
  onRestore,
  labels,
}: CopilotCheckpointBlockProps) {
  const ckptId = item.checkpoint.id;
  const short = ckptId.slice(0, 8);
  const restored = item.restoredAt;
  return (
    <div style={containerStyle}>
      <div style={leftStyle}>
        <span style={labelStyle}>{labels.checkpoint}</span>
        <span style={hashStyle}>#{short}</span>
        {restored ? (
          <span style={restoredStyle}>· {new Date(restored).toLocaleTimeString()}</span>
        ) : null}
      </div>
      {onRestore ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={restoring}
          onClick={() => onRestore(ckptId)}
        >
          <IconRotateCcw size={12} />
          {restoring ? labels.restoring : labels.restore}
        </Button>
      ) : null}
    </div>
  );
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 10px',
  border: '1px dashed var(--z-border)',
  borderRadius: 8,
  background: 'var(--z-bg-app)',
  color: 'var(--z-fg-muted)',
  fontSize: 11,
};

const leftStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const labelStyle: CSSProperties = {
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const hashStyle: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace',
  color: 'var(--z-fg-subtle)',
};

const restoredStyle: CSSProperties = {
  fontStyle: 'italic',
  color: 'var(--z-fg-subtle)',
};
