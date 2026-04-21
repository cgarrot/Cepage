import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type AvatarRole = 'human' | 'agent' | 'system' | 'tool';

export type AvatarProps = HTMLAttributes<HTMLDivElement> & {
  role?: AvatarRole;
  label: string;
  size?: number;
  icon?: ReactNode;
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function roleStyle(role: AvatarRole): CSSProperties {
  switch (role) {
    case 'agent':
      return {
        background:
          'linear-gradient(135deg, var(--z-accent) 0%, var(--z-accent-strong) 100%)',
        color: 'var(--z-btn-solid-fg)',
      };
    case 'system':
      return { background: 'var(--z-section-bg)', color: 'var(--z-fg-muted)' };
    case 'tool':
      return { background: 'rgba(56, 189, 248, 0.16)', color: '#7dd3fc' };
    case 'human':
    default:
      return { background: 'var(--z-section-bg)', color: 'var(--z-fg)' };
  }
}

export function Avatar({ role = 'human', label, size = 28, icon, style, ...rest }: AvatarProps) {
  const merged: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: size,
    border: '1px solid var(--z-border-soft)',
    fontSize: Math.max(10, Math.round(size * 0.4)),
    fontWeight: 600,
    flex: '0 0 auto',
    overflow: 'hidden',
    ...roleStyle(role),
    ...style,
  };
  return (
    <div {...rest} style={merged} aria-hidden>
      {icon ?? initials(label)}
    </div>
  );
}
