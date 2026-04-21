'use client';

import type { ChatTimelineSystemMessage } from '@cepage/state';
import { BlockShell, type BlockShellTone } from './BlockShell';

type SystemMessageBlockProps = {
  message: ChatTimelineSystemMessage;
};

function tone(level: ChatTimelineSystemMessage['level']): BlockShellTone {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  return 'subtle';
}

export function SystemMessageBlock({ message }: SystemMessageBlockProps) {
  return (
    <BlockShell tone={tone(message.level)} padding="8px 12px">
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'baseline',
          fontSize: 12,
          color: 'var(--z-fg)',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em' }}>
          {message.level}
        </strong>
        <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
      </div>
    </BlockShell>
  );
}
