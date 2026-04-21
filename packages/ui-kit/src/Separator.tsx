import type { CSSProperties } from 'react';

export type SeparatorProps = {
  orientation?: 'horizontal' | 'vertical';
  margin?: number;
  style?: CSSProperties;
};

export function Separator({ orientation = 'horizontal', margin = 0, style }: SeparatorProps) {
  const merged: CSSProperties =
    orientation === 'horizontal'
      ? {
          height: 1,
          width: '100%',
          background: 'var(--z-border-soft)',
          marginTop: margin,
          marginBottom: margin,
        }
      : {
          width: 1,
          alignSelf: 'stretch',
          background: 'var(--z-border-soft)',
          marginLeft: margin,
          marginRight: margin,
        };
  return <div role="separator" style={{ ...merged, ...style }} />;
}
