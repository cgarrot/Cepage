'use client';

import { Badge, IconSparkles } from '@cepage/ui-kit';
import type { ChatTimelineAgentSpawn } from '@cepage/state';
import { AgentBadge } from './AgentBadge';
import { BlockShell } from './BlockShell';

type AgentSpawnBlockProps = {
  spawn: ChatTimelineAgentSpawn;
};

export function AgentSpawnBlock({ spawn }: AgentSpawnBlockProps) {
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
