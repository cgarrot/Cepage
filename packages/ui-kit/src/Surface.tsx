import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type SurfaceVariant = 'panel' | 'card' | 'subtle' | 'flat';
export type SurfaceTone = 'default' | 'accent' | 'muted' | 'danger';

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  as?: 'div' | 'section' | 'article' | 'aside' | 'nav' | 'header' | 'footer';
  variant?: SurfaceVariant;
  tone?: SurfaceTone;
  padding?: number | string;
  radius?: number;
  bordered?: boolean;
  children?: ReactNode;
};

function surfaceStyle(variant: SurfaceVariant, tone: SurfaceTone, bordered: boolean): CSSProperties {
  const borderColor =
    tone === 'accent'
      ? 'color-mix(in srgb, var(--z-accent) 32%, transparent)'
      : tone === 'danger'
        ? 'rgba(220, 38, 38, 0.4)'
        : 'var(--z-bg-panel-border)';

  const accentBg =
    tone === 'accent'
      ? 'var(--z-accent-soft)'
      : tone === 'muted'
        ? 'var(--z-section-bg)'
        : tone === 'danger'
          ? 'rgba(220, 38, 38, 0.08)'
          : undefined;

  switch (variant) {
    case 'panel':
      return {
        background: accentBg ?? 'var(--z-bg-panel)',
        border: bordered ? `1px solid ${borderColor}` : '1px solid transparent',
        boxShadow: 'var(--z-bg-panel-shadow)',
      };
    case 'card':
      return {
        background: accentBg ?? 'var(--z-section-bg)',
        border: bordered ? `1px solid ${borderColor}` : '1px solid transparent',
      };
    case 'subtle':
      return {
        background: 'transparent',
        border: bordered ? `1px solid ${borderColor}` : '1px solid transparent',
      };
    case 'flat':
    default:
      return {
        background: accentBg ?? 'transparent',
        border: bordered ? `1px solid ${borderColor}` : '1px solid transparent',
      };
  }
}

export function Surface({
  as = 'div',
  variant = 'panel',
  tone = 'default',
  padding = 14,
  radius = 14,
  bordered = true,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const Tag = as;
  const merged: CSSProperties = {
    color: 'var(--z-fg)',
    padding,
    borderRadius: radius,
    ...surfaceStyle(variant, tone, bordered),
    ...style,
  };
  return (
    <Tag {...rest} style={merged}>
      {children}
    </Tag>
  );
}
