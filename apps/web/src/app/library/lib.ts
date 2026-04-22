'use client';

import type { CSSProperties } from 'react';
import type { SkillRunStatus, UserSkillRow } from '@cepage/client-api';

// Shared style primitives and helpers for the /library routes. Keeping them
// in one place lets all three pages (list, detail, runs) look visually
// cohesive without pulling another dependency into the web app.

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--z-bg-app)',
  color: 'var(--z-fg)',
  padding: 24,
  fontFamily: 'system-ui, sans-serif',
};

export const headerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  marginBottom: 20,
};

export const btnStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--z-btn-ghost-border)',
  background: 'var(--z-btn-ghost-bg)',
  color: 'var(--z-btn-ghost-fg)',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

export const btnSolidStyle: CSSProperties = {
  ...btnStyle,
  borderColor: 'var(--z-btn-solid-border)',
  background: 'var(--z-btn-solid-bg)',
  color: 'var(--z-btn-solid-fg)',
};

export const sectionStyle: CSSProperties = {
  border: '1px solid var(--z-section-border)',
  background: 'var(--z-section-bg)',
  borderRadius: 10,
  padding: 14,
};

export const tagStyle: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--z-section-bg)',
  border: '1px solid var(--z-section-border)',
  color: 'var(--z-fg-muted)',
};

export const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: 'pre',
  overflow: 'auto',
};

export function fmtDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m}m ${rest}s`;
}

export function runStatusTone(status: SkillRunStatus): CSSProperties {
  const common: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid var(--z-section-border)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
  switch (status) {
    case 'succeeded':
      return {
        ...common,
        color: 'var(--z-fg-status-success, #16a34a)',
        borderColor: 'rgba(22, 163, 74, 0.35)',
        background: 'rgba(22, 163, 74, 0.08)',
      };
    case 'failed':
      return {
        ...common,
        color: 'var(--z-fg-status-error, #dc2626)',
        borderColor: 'rgba(220, 38, 38, 0.35)',
        background: 'rgba(220, 38, 38, 0.08)',
      };
    case 'cancelled':
      return {
        ...common,
        color: 'var(--z-fg-muted, #6b7280)',
      };
    case 'running':
      return {
        ...common,
        color: 'var(--z-fg-status-info, #2563eb)',
        borderColor: 'rgba(37, 99, 235, 0.35)',
        background: 'rgba(37, 99, 235, 0.08)',
      };
    case 'queued':
    default:
      return {
        ...common,
        color: 'var(--z-fg-muted, #6b7280)',
      };
  }
}

export function countInputs(skill: UserSkillRow): number {
  const props = (skill.inputsSchema as { properties?: Record<string, unknown> } | null)?.properties;
  return props ? Object.keys(props).length : 0;
}

export function countOutputs(skill: UserSkillRow): number {
  const props = (skill.outputsSchema as { properties?: Record<string, unknown> } | null)?.properties;
  return props ? Object.keys(props).length : 0;
}

export function extractTags(skill: UserSkillRow): string[] {
  return Array.isArray(skill.tags) ? skill.tags.filter((t) => typeof t === 'string') : [];
}

export function uniqueCategories(rows: UserSkillRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.category) set.add(row.category);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function uniqueKinds(rows: UserSkillRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.kind) set.add(row.kind);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function matchesQuery(skill: UserSkillRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const haystacks: string[] = [
    skill.title,
    skill.slug,
    skill.summary,
    skill.category ?? '',
    skill.kind ?? '',
    ...extractTags(skill),
  ];
  return haystacks.some((h) => typeof h === 'string' && h.toLowerCase().includes(q));
}
