'use client';

import type { CSSProperties, ReactNode } from 'react';

export type BlockShellTone = 'neutral' | 'accent' | 'subtle' | 'danger' | 'warning' | 'success';

type BlockShellProps = {
  tone?: BlockShellTone;
  bordered?: boolean;
  padding?: number | string;
  radius?: number | string;
  children: ReactNode;
  style?: CSSProperties;
};

function background(tone: BlockShellTone): string {
  switch (tone) {
    case 'accent':
      return 'var(--z-bg-panel)';
    case 'subtle':
      return 'var(--z-bg-sidebar)';
    case 'danger':
      return 'rgba(220, 38, 38, 0.08)';
    case 'warning':
      return 'rgba(202, 138, 4, 0.08)';
    case 'success':
      return 'rgba(22, 163, 74, 0.08)';
    case 'neutral':
    default:
      return 'transparent';
  }
}

function border(tone: BlockShellTone): string {
  switch (tone) {
    case 'danger':
      return '1px solid rgba(220, 38, 38, 0.4)';
    case 'warning':
      return '1px solid rgba(202, 138, 4, 0.4)';
    case 'success':
      return '1px solid rgba(22, 163, 74, 0.4)';
    case 'accent':
      return '1px solid var(--z-border)';
    case 'subtle':
      return '1px solid var(--z-border)';
    case 'neutral':
    default:
      return '1px solid transparent';
  }
}

/**
 * Atomic container shared by every chat block. Keeps spacing/radius/borders
 * consistent across kinds while exposing a `tone` knob for status colouring.
 */
export function BlockShell({
  tone = 'neutral',
  bordered = true,
  padding = 14,
  radius = 14,
  children,
  style,
}: BlockShellProps) {
  const merged: CSSProperties = {
    background: background(tone),
    border: bordered ? border(tone) : 'none',
    borderRadius: radius,
    padding,
    color: 'var(--z-fg)',
    boxShadow: tone === 'accent' ? 'var(--z-bg-panel-shadow)' : 'none',
    ...style,
  };
  return <div style={merged}>{children}</div>;
}
