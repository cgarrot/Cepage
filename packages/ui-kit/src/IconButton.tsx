import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: number;
  active?: boolean;
  label: string;
};

export function IconButton({ size = 28, active, label, style, children, ...rest }: IconButtonProps) {
  const merged: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: 8,
    border: '1px solid var(--z-btn-ghost-border)',
    background: active ? 'var(--z-accent-soft)' : 'transparent',
    color: active ? 'var(--z-accent-strong)' : 'var(--z-fg-muted)',
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.5 : 1,
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
    ...style,
  };
  return (
    <button type="button" aria-label={label} title={label} {...rest} style={merged}>
      {children}
    </button>
  );
}
