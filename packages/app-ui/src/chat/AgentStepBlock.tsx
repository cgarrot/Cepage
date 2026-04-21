'use client';

import type { ReactNode } from 'react';
import { Badge, IconBranch, IconChevronDown, IconChevronRight, IconButton } from '@cepage/ui-kit';
import { useState } from 'react';
import type { ChatTimelineAgentOutput, ChatTimelineAgentStep } from '@cepage/state';
import { AgentBadge } from './AgentBadge';
import { BlockShell } from './BlockShell';
import { CodeBlockEnhanced } from './CodeBlockEnhanced';

type AgentStepBlockProps = {
  step: ChatTimelineAgentStep;
  outputs?: ChatTimelineAgentOutput[];
  defaultOpen?: boolean;
  trailing?: ReactNode;
};

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap' as const,
};

/**
 * Step performed by an agent: ships a brief, the role label, and the
 * stdout/stderr stream collected while the step is running. Output is
 * collapsed by default for completed steps to keep the transcript skimmable.
 */
export function AgentStepBlock({
  step,
  outputs = [],
  defaultOpen,
  trailing,
}: AgentStepBlockProps) {
  const hasOutputs = outputs.length > 0;
  const [open, setOpen] = useState(defaultOpen ?? hasOutputs);
  const stderr = outputs.some((output) => output.stream === 'stderr');
  return (
    <BlockShell
      tone={stderr ? 'warning' : 'accent'}
      padding={12}
      style={{ display: 'grid', gap: 8 }}
    >
      <div style={HEADER_STYLE}>
        <IconBranch size={14} color="var(--z-fg-muted)" />
        <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>Step</span>
        <AgentBadge
          actor={step.actor}
          {...(step.agentType ? { agentType: step.agentType } : {})}
          {...(step.model ? { model: step.model } : {})}
        />
        {step.role ? <Badge tone="neutral" outline>{step.role}</Badge> : null}
        {step.label ? <Badge tone="info" outline>{step.label}</Badge> : null}
        {trailing ? <div style={{ marginLeft: 'auto' }}>{trailing}</div> : null}
        {hasOutputs ? (
          <IconButton
            size={26}
            label={open ? 'Hide output' : 'Show output'}
            active={open}
            onClick={() => setOpen((value) => !value)}
            style={{ marginLeft: trailing ? 0 : 'auto' }}
          >
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </IconButton>
        ) : null}
      </div>
      {step.brief ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--z-fg)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {step.brief}
        </p>
      ) : null}
      {open && hasOutputs ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {outputs.map((output) => (
            <CodeBlockEnhanced
              key={output.id}
              code={output.text}
              language={output.stream === 'stderr' ? 'stderr' : 'stdout'}
              maxHeight={320}
            />
          ))}
        </div>
      ) : null}
    </BlockShell>
  );
}
