import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

const SIZE: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: 12, borderRadius: 8, height: 28 },
  md: { padding: '6px 14px', fontSize: 13, borderRadius: 10, height: 34 },
  lg: { padding: '10px 18px', fontSize: 14, borderRadius: 12, height: 40 },
};

function variantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--z-btn-solid-bg)',
        border: '1px solid var(--z-btn-solid-border)',
        color: 'var(--z-btn-solid-fg)',
      };
    case 'secondary':
      return {
        background: 'var(--z-btn-primary-bg)',
        border: '1px solid var(--z-btn-primary-border)',
        color: 'var(--z-btn-primary-fg)',
      };
    case 'danger':
      return {
        background: 'rgba(220, 38, 38, 0.18)',
        border: '1px solid rgba(220, 38, 38, 0.5)',
        color: '#fda4a4',
      };
    case 'ghost':
    default:
      return {
        background: 'var(--z-btn-ghost-bg)',
        border: '1px solid var(--z-btn-ghost-border)',
        color: 'var(--z-btn-ghost-fg)',
      };
  }
}

export function Button({
  variant = 'ghost',
  size = 'md',
  block,
  style,
  children,
  ...rest
}: ButtonProps) {
  const merged: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: block ? '100%' : undefined,
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.55 : 1,
    fontWeight: 500,
    lineHeight: 1.2,
    transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease',
    ...SIZE[size],
    ...variantStyle(variant),
    ...style,
  };
  return (
    <button type="button" {...rest} style={merged}>
      {children}
    </button>
  );
}
