'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from './I18nProvider';

type SidebarSectionProps = {
  title: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  children: ReactNode;
  contentStyle?: CSSProperties;
  sectionStyle?: CSSProperties;
};

export function SidebarSection({
  title,
  defaultOpen = false,
  summary = null,
  children,
  contentStyle,
  sectionStyle,
}: SidebarSectionProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      style={{
        padding: 8,
        borderBottom: '1px solid var(--z-border)',
        display: 'grid',
        gap: 8,
        ...sectionStyle,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? t('ui.sidebar.collapseSection') : t('ui.sidebar.expandSection')}: ${title}`}
        onClick={() => setOpen((value) => !value)}
        style={{
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          display: 'grid',
          gap: 4,
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <strong style={{ color: 'var(--z-sidebar-heading)' }}>{title}</strong>
          <span style={{ color: 'var(--z-fg-subtle)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        </div>
        {summary ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--z-fg-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {summary}
          </div>
        ) : null}
      </button>
      {open ? (
        <div style={{ minHeight: 0, ...contentStyle }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
