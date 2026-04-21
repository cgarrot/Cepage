'use client';

import { Badge, IconSparkles } from '@cepage/ui-kit';
import type { ChatModelRef, ChatTimelineAgentSpawn } from '@cepage/state';
import { AgentBadge } from './AgentBadge';
import { BlockShell } from './BlockShell';

type AgentSpawnBlockProps = {
  spawn: ChatTimelineAgentSpawn;
  /**
   * Runtime-effective model resolved from the AgentRun attached to this
   * spawn. When different from `spawn.model` the badge renders the strike
   * + arrow pair to surface the fallback.
   */
  callModel?: ChatModelRef;
};

export function AgentSpawnBlock({ spawn, callModel }: AgentSpawnBlockProps) {
  return (
    <BlockShell
      tone="subtle"
      padding="10px 14px"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <IconSparkles size={14} color="var(--z-fg-muted)" />
      <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>Spawned</span>
      <AgentBadge
        actor={spawn.actor}
        agentType={spawn.agentType}
        {...(spawn.model ? { model: spawn.model } : {})}
        {...(callModel ? { callModel } : {})}
        showModel
      />
      {spawn.workingDirectory ? (
        <Badge tone="neutral" outline>
          cwd: {spawn.workingDirectory}
        </Badge>
      ) : null}
    </BlockShell>
  );
}
