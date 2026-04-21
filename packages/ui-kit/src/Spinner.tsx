import type { CSSProperties } from 'react';

export type SpinnerProps = {
  size?: number;
  color?: string;
  thickness?: number;
  label?: string;
};

const KEYFRAMES_ID = '__cepage_spinner_keyframes__';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes cepage-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

export function Spinner({ size = 16, color, thickness = 2, label }: SpinnerProps) {
  ensureKeyframes();
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: '50%',
    border: `${thickness}px solid color-mix(in srgb, ${color ?? 'var(--z-accent)'} 20%, transparent)`,
    borderTopColor: color ?? 'var(--z-accent)',
    animation: 'cepage-spin 0.8s linear infinite',
    boxSizing: 'border-box',
  };
  return <span role="status" aria-label={label ?? 'loading'} style={style} />;
}

const DOT_KEYFRAMES_ID = '__cepage_loading_dots__';

function ensureDotKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DOT_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = DOT_KEYFRAMES_ID;
  style.textContent = `
@keyframes cepage-dot {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-3px); opacity: 1; }
}
`;
  document.head.appendChild(style);
}

export function LoadingDots({ color }: { color?: string }) {
  ensureDotKeyframes();
  const dot: CSSProperties = {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: color ?? 'var(--z-accent)',
    animation: 'cepage-dot 1.2s ease-in-out infinite',
    display: 'inline-block',
  };
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} role="status" aria-label="loading">
      <span style={{ ...dot, animationDelay: '0s' }} />
      <span style={{ ...dot, animationDelay: '0.15s' }} />
      <span style={{ ...dot, animationDelay: '0.3s' }} />
    </span>
  );
}
