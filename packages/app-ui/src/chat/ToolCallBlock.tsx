'use client';

import { useState } from 'react';
import { Badge, IconButton, IconChevronDown, IconChevronRight, IconTool } from '@cepage/ui-kit';
import { BlockShell } from './BlockShell';
import { CodeBlockEnhanced } from './CodeBlockEnhanced';

export type ToolCallStatus = 'running' | 'success' | 'error';

type ToolCallBlockProps = {
  name: string;
  status: ToolCallStatus;
  argsPreview?: string;
  resultPreview?: string;
  durationMs?: number;
  defaultOpen?: boolean;
};

function statusTone(status: ToolCallStatus): 'success' | 'danger' | 'subtle' {
  if (status === 'success') return 'success';
  if (status === 'error') return 'danger';
  return 'subtle';
}

function statusBadgeTone(status: ToolCallStatus): 'success' | 'danger' | 'info' {
  if (status === 'success') return 'success';
  if (status === 'error') return 'danger';
  return 'info';
}

/**
 * Generic tool-call line. The current store doesn't surface tool calls as a
 * dedicated graph type yet, but agents can emit them through `agent_step`
 * metadata in the future. This component is the canonical render so callers
 * just project their data into ToolCallBlockProps and ship it.
 */
export function ToolCallBlock({
  name,
  status,
  argsPreview,
  resultPreview,
  durationMs,
  defaultOpen = false,
}: ToolCallBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <BlockShell tone={statusTone(status)} padding={12} style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <IconTool size={14} color="var(--z-fg-muted)" />
        <strong style={{ fontSize: 13 }}>{name}</strong>
        <Badge tone={statusBadgeTone(status)} outline>{status}</Badge>
        {typeof durationMs === 'number' ? (
          <span style={{ fontSize: 11, color: 'var(--z-fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {durationMs}ms
          </span>
        ) : null}
        {(argsPreview || resultPreview) ? (
          <IconButton
            size={26}
            label={open ? 'Collapse' : 'Expand'}
            active={open}
            onClick={() => setOpen((value) => !value)}
            style={{ marginLeft: 'auto' }}
          >
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </IconButton>
        ) : null}
      </div>
      {open && argsPreview ? (
        <CodeBlockEnhanced code={argsPreview} language="args" maxHeight={200} />
      ) : null}
      {open && resultPreview ? (
        <CodeBlockEnhanced code={resultPreview} language="result" maxHeight={320} />
      ) : null}
    </BlockShell>
  );
}
