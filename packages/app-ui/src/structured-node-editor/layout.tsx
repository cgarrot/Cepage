import type { CSSProperties, ReactNode } from 'react';

export const stackStyle = {
  display: 'grid',
  gap: 12,
} satisfies CSSProperties;

export const sectionStyle = {
  ...stackStyle,
  padding: 12,
  borderRadius: 12,
  background: 'var(--z-node-hint-bg)',
  border: '1px solid var(--z-node-hint-border)',
} satisfies CSSProperties;

export const fieldStyle = {
  display: 'grid',
  gap: 6,
} satisfies CSSProperties;

export const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--z-node-id-fg)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
} satisfies CSSProperties;

export const inputStyle = {
  width: '100%',
  minWidth: 0,
  borderRadius: 10,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-node-fg)',
  padding: '9px 10px',
  fontSize: 12,
  lineHeight: 1.4,
  outline: 'none',
} satisfies CSSProperties;

export const textareaStyle = {
  ...inputStyle,
  minHeight: 92,
  resize: 'vertical',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} satisfies CSSProperties;

export const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 999,
  background: 'var(--z-node-textarea-bg)',
  border: '1px solid var(--z-node-hint-border)',
  fontSize: 12,
  color: 'var(--z-node-chip-fg)',
} satisfies CSSProperties;

export const buttonStyle = {
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-node-fg)',
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
} satisfies CSSProperties;

export const toggleLabelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--z-node-fg)',
} satisfies CSSProperties;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={labelStyle}>{title}</div>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

export function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--z-node-fg)' }}>{value}</div>
    </div>
  );
}
