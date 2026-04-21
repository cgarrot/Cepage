import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

export type TooltipProps = {
  label: string;
  side?: 'top' | 'bottom';
  children: ReactNode;
};

const tipStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 10,
  fontSize: 11,
  padding: '4px 8px',
  borderRadius: 6,
  background: 'var(--z-menu-bg)',
  border: '1px solid var(--z-menu-border)',
  color: 'var(--z-fg)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  boxShadow: 'var(--z-menu-shadow)',
};

/**
 * Lightweight CSS tooltip without portal — adequate for chat UI accent labels.
 * For richer overlays, switch to a portal-based primitive.
 */
export function Tooltip({ label, side = 'top', children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
  };

  const positioning: CSSProperties =
    side === 'top'
      ? { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' }
      : { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' };

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': open ? id : undefined,
      })
    : children;

  return (
    <span
      style={wrapperStyle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {child}
      {open ? (
        <span id={id} role="tooltip" style={{ ...tipStyle, ...positioning }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
