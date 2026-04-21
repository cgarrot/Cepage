'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type CanvasContextMenuItem = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type CanvasContextMenuSection = {
  id: string;
  label?: string;
  items: CanvasContextMenuItem[];
};

type CanvasContextMenuProps = {
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  sections: CanvasContextMenuSection[];
  onClose: () => void;
};

type MenuFrame = {
  x: number;
  y: number;
  maxHeight: number;
};

export function CanvasContextMenu({
  x,
  y,
  title,
  subtitle,
  sections,
  onClose,
}: CanvasContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<MenuFrame>(() => ({
    x,
    y,
    maxHeight: readMenuMaxHeight(),
  }));

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const maxHeight = readMenuMaxHeight();
    setFrame((current) => {
      const next = calculateSmartPosition(x, y, rect.width, Math.min(rect.height, maxHeight));
      if (current.x === next.x && current.y === next.y && current.maxHeight === maxHeight) {
        return current;
      }
      return { ...next, maxHeight };
    });
  }, [x, y]);

  useLayoutEffect(() => {
    updatePosition();
  }, [subtitle, sections, title, updatePosition]);

  useEffect(() => {
    const handleResize = () => updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (containerRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, updatePosition]);

  const menu = (
    <div
      ref={containerRef}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: 'fixed',
        left: frame.x,
        top: frame.y,
        zIndex: 1000,
        minWidth: 260,
        maxWidth: 320,
        maxHeight: frame.maxHeight,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        borderRadius: 14,
        border: `1px solid var(--z-menu-border)`,
        background: 'var(--z-menu-bg)',
        boxShadow: 'var(--z-menu-shadow)',
        color: 'var(--z-fg)',
        overflow: 'hidden',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div
        style={{
          padding: '12px 14px 10px',
          borderBottom: `1px solid var(--z-border-muted)`,
          background: 'var(--z-menu-header-shade)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--z-menu-title)' }}>{title}</div>
        {subtitle ? (
          <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4, color: 'var(--z-fg-section)' }}>
            {subtitle}
          </div>
        ) : null}
      </div>

      <div style={{ minHeight: 0, padding: 8, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {sections.map((section, index) => (
          <div
            key={section.id}
            style={{
              paddingTop: index === 0 ? 0 : 8,
              marginTop: index === 0 ? 0 : 8,
              borderTop: index === 0 ? 'none' : `1px solid var(--z-border-muted)`,
            }}
          >
            {section.label ? (
              <div
                style={{
                  padding: '0 8px 6px',
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  color: 'var(--z-fg-subtle)',
                }}
              >
                {section.label}
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: 4 }}>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gap: 2,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: item.disabled ? 'transparent' : 'var(--z-menu-item-bg)',
                    color: item.disabled ? 'var(--z-fg-disabled)' : 'var(--z-fg)',
                    textAlign: 'left',
                    cursor: item.disabled ? 'default' : 'pointer',
                    opacity: item.disabled ? 0.7 : 1,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  {item.description ? (
                    <span
                      style={{
                        fontSize: 11,
                        lineHeight: 1.35,
                        color: item.disabled ? 'var(--z-fg-disabled)' : 'var(--z-menu-desc)',
                      }}
                    >
                      {item.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(menu, document.body);
}

function readMenuMaxHeight(padding: number = 16): number {
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  return Math.max(120, viewportHeight - padding * 2);
}

function calculateSmartPosition(
  initialX: number,
  initialY: number,
  width: number,
  height: number,
  padding: number = 16,
): { x: number; y: number } {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;

  let x = initialX;
  let y = initialY;

  if (x + width + padding > viewportWidth) {
    x = viewportWidth - width - padding;
  }
  if (y + height + padding > viewportHeight) {
    y = viewportHeight - height - padding;
  }

  return {
    x: Math.max(padding, x),
    y: Math.max(padding, y),
  };
}
