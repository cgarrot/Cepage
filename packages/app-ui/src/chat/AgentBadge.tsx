'use client';

import type { CSSProperties } from 'react';
import { Avatar, Badge, IconSparkles, IconTool, IconUser, type AvatarRole } from '@cepage/ui-kit';
import type { ChatActor, ChatModelRef } from '@cepage/state';
import { useI18n } from '../I18nProvider';
import {
  selectAgentBadgeModelDisplay,
  type AgentBadgeModelDisplay,
} from './agent-badge-display.js';

export { selectAgentBadgeModelDisplay, type AgentBadgeModelDisplay };

type AgentBadgeProps = {
  actor: ChatActor;
  agentType?: string;
  /**
   * The model the user **configured** on the node (step/spawn payload). This
   * is what was declared at design time; it may not be the model that ran.
   */
  model?: ChatModelRef;
  /**
   * The model that was **actually called** at runtime (from the AgentRun
   * record). When this differs from {@link model} the badge strikes through
   * the configured one and shows the effective one with an arrow, surfacing
   * that a fallback was triggered.
   */
  callModel?: ChatModelRef;
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

function formatModel(model: ChatModelRef): string {
  return `${model.providerId} · ${model.modelId}`;
}

const ICONS = {
  human: <IconUser size={12} />,
  agent: <IconSparkles size={12} />,
  system: <IconTool size={12} />,
} as const;

/**
 * Pill that identifies the speaker for a chat block: avatar + role label,
 * with optional model spec ("openai · gpt-5.4") when available.
 *
 * When a {@link AgentBadgeProps.callModel} is provided and differs from
 * {@link AgentBadgeProps.model}, the configured model is rendered with a
 * strike-through followed by a `→` pointing at the actually-called model.
 * This tells the user "we wanted X, the runtime fell back to Y" without
 * needing a separate explanation row.
 */
export function AgentBadge({
  actor,
  agentType,
  model,
  callModel,
  size = 22,
  showModel = true,
  style,
}: AgentBadgeProps) {
  const { t } = useI18n();
  const label = actorLabel(actor, agentType);

  // Single decision table: avoids duplicating the branching between the
  // mismatch render and the single render paths.
  const display = showModel ? selectAgentBadgeModelDisplay(model, callModel) : { kind: 'none' as const };

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
      {display.kind === 'mismatch' ? (
        <span
          title={t('ui.chat.modelStruckLabel')}
          style={{
            fontSize: 11,
            color: 'var(--z-fg-muted)',
            fontVariantNumeric: 'tabular-nums',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <s style={{ opacity: 0.6 }}>{formatModel(display.configured)}</s>
          <span aria-hidden="true">→</span>
          <span>{formatModel(display.called)}</span>
        </span>
      ) : null}
      {display.kind === 'single' ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--z-fg-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatModel(display.model)}
        </span>
      ) : null}
    </div>
  );
}
