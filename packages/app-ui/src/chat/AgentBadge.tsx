'use client';

import type { CSSProperties } from 'react';
import { Avatar, Badge, IconSparkles, IconTool, IconUser, type AvatarRole } from '@cepage/ui-kit';
import type { ChatActor, ChatModelRef } from '@cepage/state';

type AgentBadgeProps = {
  actor: ChatActor;
  agentType?: string;
  model?: ChatModelRef;
  size?: number;
  showModel?: boolean;
  style?: CSSProperties;
};

function actorToAvatarRole(actor: ChatActor): AvatarRole {
  return actor.kind;
}

function actorLabel(actor: ChatActor, agentType?: string): string {
  if (actor.kind === 'human') return 'You';
  if (actor.kind === 'agent') return agentType ?? actor.agentType;
  return 'System';
}

function actorInitial(actor: ChatActor, agentType?: string): string {
  const label = actorLabel(actor, agentType);
  return label.charAt(0).toUpperCase() || '?';
}

const ICONS = {
  human: <IconUser size={12} />,
  agent: <IconSparkles size={12} />,
  system: <IconTool size={12} />,
} as const;

/**
 * Pill that identifies the speaker for a chat block: avatar + role label,
 * with optional model spec ("openai · gpt-5.4") when available.
 */
export function AgentBadge({
  actor,
  agentType,
  model,
  size = 22,
  showModel = true,
  style,
}: AgentBadgeProps) {
  const label = actorLabel(actor, agentType);
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...style,
      }}
    >
      <Avatar role={actorToAvatarRole(actor)} label={actorInitial(actor, agentType)} size={size} icon={ICONS[actor.kind]} />
      <Badge tone={actor.kind === 'human' ? 'info' : actor.kind === 'agent' ? 'agent' : 'neutral'}>
        {label}
      </Badge>
      {showModel && model ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--z-fg-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {model.providerId} · {model.modelId}
        </span>
      ) : null}
    </div>
  );
}
