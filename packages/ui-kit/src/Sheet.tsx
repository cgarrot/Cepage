import { useEffect, type CSSProperties, type ReactNode } from 'react';

export type SheetSide = 'left' | 'right';

export type SheetProps = {
  open: boolean;
  side?: SheetSide;
  width?: number | string;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
};

export function Sheet({ open, side = 'right', width = 360, onClose, children, ariaLabel }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const overlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'var(--z-overlay)',
    backdropFilter: 'blur(2px)',
    zIndex: 60,
  };

  const panel: CSSProperties = {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: side === 'left' ? 0 : 'auto',
    right: side === 'right' ? 0 : 'auto',
    width,
    maxWidth: '94vw',
    background: 'var(--z-bg-panel)',
    borderLeft: side === 'right' ? '1px solid var(--z-bg-panel-border)' : undefined,
    borderRight: side === 'left' ? '1px solid var(--z-bg-panel-border)' : undefined,
    boxShadow: 'var(--z-bg-panel-shadow)',
    color: 'var(--z-fg)',
    zIndex: 70,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };

  return (
    <>
      <div style={overlay} onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label={ariaLabel} aria-modal style={panel}>
        {children}
      </aside>
    </>
  );
}
