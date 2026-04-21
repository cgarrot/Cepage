import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'agent';

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  outline?: boolean;
  icon?: ReactNode;
};

const TONE_FG: Record<BadgeTone, string> = {
  neutral: 'var(--z-fg-muted)',
  accent: 'var(--z-accent-strong)',
  success: '#7ddc9a',
  warning: '#facc15',
  danger: '#fca5a5',
  info: '#7dd3fc',
  agent: 'var(--z-accent-strong)',
};

const TONE_BG: Record<BadgeTone, string> = {
  neutral: 'var(--z-section-bg)',
  accent: 'var(--z-accent-soft)',
  success: 'rgba(34, 197, 94, 0.12)',
  warning: 'rgba(250, 204, 21, 0.12)',
  danger: 'rgba(220, 38, 38, 0.14)',
  info: 'rgba(56, 189, 248, 0.14)',
  agent: 'var(--z-accent-soft)',
};

export function Badge({ tone = 'neutral', outline, icon, style, children, ...rest }: BadgeProps) {
  const merged: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 11,
    lineHeight: 1.4,
    fontWeight: 500,
    borderRadius: 999,
    color: TONE_FG[tone],
    background: outline ? 'transparent' : TONE_BG[tone],
    border: outline ? `1px solid ${TONE_FG[tone]}` : '1px solid transparent',
    ...style,
  };
  return (
    <span {...rest} style={merged}>
      {icon ? <span style={{ display: 'inline-flex' }}>{icon}</span> : null}
      {children}
    </span>
  );
}
