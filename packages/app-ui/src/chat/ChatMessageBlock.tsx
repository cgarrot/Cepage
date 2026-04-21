'use client';

import type { ReactNode } from 'react';
import type {
  ChatModelRef,
  ChatTimelineAgentMessage,
  ChatTimelineHumanMessage,
} from '@cepage/state';
import { MarkdownBody } from '../MarkdownBody';
import { AgentBadge } from './AgentBadge';
import { BlockShell } from './BlockShell';

type ChatMessageBlockProps = {
  message: ChatTimelineHumanMessage | ChatTimelineAgentMessage;
  trailing?: ReactNode;
  /**
   * Model actually invoked at runtime for this message's agent run. When it
   * differs from the configured `message.model` the badge strikes the
   * configured one and shows the effective one with an arrow.
   */
  callModel?: ChatModelRef;
};

/**
 * The most common block: a Markdown-formatted message from a human or an
 * agent. Layout mirrors Cursor / Codex style: badge + content stacked, with
 * tone differing between speakers so the eye can scan quickly.
 */
export function ChatMessageBlock({ message, trailing, callModel }: ChatMessageBlockProps) {
  const isAgent = message.kind === 'agent_message';
  return (
    <BlockShell
      tone={isAgent ? 'accent' : 'subtle'}
      bordered
      padding={14}
      style={{ display: 'grid', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <AgentBadge
          actor={message.actor}
          {...(isAgent
            ? {
                agentType: message.agentType,
                model: message.model,
                ...(callModel ? { callModel } : {}),
              }
            : {})}
        />
        {trailing ? <div style={{ marginLeft: 'auto' }}>{trailing}</div> : null}
      </div>
      {message.format === 'markdown' ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          <MarkdownBody content={message.text} compact />
        </div>
      ) : (
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--z-fg)',
          }}
        >
          {message.text}
        </pre>
      )}
    </BlockShell>
  );
}
