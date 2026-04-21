'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { PanelResizeHandle } from 'react-resizable-panels';

type ResizerProps = {
  direction?: 'horizontal' | 'vertical';
};

/**
 * Themeable resize handle for {@link PanelGroup}. We render a
 * {@link PanelResizeHandle} (which carries the actual pointer + a11y logic)
 * and paint a 1px guide that thickens and adopts the active accent color when
 * the user hovers or actively drags it.
 */
export function Resizer({ direction = 'horizontal' }: ResizerProps) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const isHorizontal = direction === 'horizontal';
  const active = hovered || dragging;
  const lineSize = active ? 3 : 1;
  const color = active ? 'var(--z-accent-strong)' : 'var(--z-border)';

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
    background: 'transparent',
    width: isHorizontal ? 6 : '100%',
    height: isHorizontal ? '100%' : 6,
    cursor: isHorizontal ? 'col-resize' : 'row-resize',
    flexShrink: 0,
    outline: 'none',
  };

  const lineStyle: CSSProperties = {
    margin: 'auto',
    width: isHorizontal ? lineSize : '100%',
    height: isHorizontal ? '100%' : lineSize,
    background: color,
    transition: 'background 120ms ease, width 120ms ease, height 120ms ease',
    borderRadius: 1,
  };

  return (
    <PanelResizeHandle
      style={wrapperStyle}
      onDragging={(value: boolean) => setDragging(value)}
    >
      <div
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{ display: 'flex', width: '100%', height: '100%' }}
      >
        <div style={lineStyle} />
      </div>
    </PanelResizeHandle>
  );
}
