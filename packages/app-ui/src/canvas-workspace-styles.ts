export const chipBtn = {
  border: '1px solid var(--z-border-lang)',
  background: 'var(--z-lang-bg)',
  color: 'var(--z-lang-fg)',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export const chipBtnActive = {
  ...chipBtn,
  border: '1px solid var(--z-border-lang-active)',
  background: 'var(--z-lang-bg-active)',
  color: 'var(--z-fg)',
} as const;

export const tabLabelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
} as const;

export const tabBadgeStyle = {
  minWidth: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 6px',
  borderRadius: 999,
  background: 'var(--z-node-run-border)',
  color: 'var(--z-bg-app)',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
} as const;

export const panelToggleBtn = {
  flexShrink: 0,
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  lineHeight: 1,
  fontSize: 16,
  borderRadius: 8,
  border: '1px solid var(--z-border-lang)',
  background: 'var(--z-lang-bg)',
  color: 'var(--z-lang-fg)',
  cursor: 'pointer',
} as const;

export const panelSecondaryBtn = {
  border: '1px solid var(--z-border)',
  background: 'transparent',
  color: 'var(--z-fg)',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export const panelCompactBtn = {
  border: '1px solid var(--z-border)',
  background: 'transparent',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '5px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export const panelPrimaryBtn = {
  border: '1px solid var(--z-btn-primary-border)',
  background: 'var(--z-btn-primary-bg)',
  color: 'var(--z-btn-primary-fg)',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export const sidebarInput = {
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 12,
  width: '100%',
} as const;

export const colorInput = {
  width: 40,
  height: 32,
  padding: 0,
  border: '1px solid var(--z-border-input)',
  borderRadius: 8,
  background: 'transparent',
  cursor: 'pointer',
} as const;

export const sidebarPrimaryBtn = {
  border: '1px solid var(--z-btn-primary-border)',
  background: 'var(--z-btn-primary-bg)',
  color: 'var(--z-btn-primary-fg)',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export const sidebarSecondaryBtn = {
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export const sidebarListBtn = {
  border: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
  color: 'var(--z-fg)',
  borderRadius: 10,
  padding: '8px 10px',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'grid',
  gap: 4,
} as const;
