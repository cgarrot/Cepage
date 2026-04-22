'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { listUserSkills, type UserSkillRow } from '@cepage/client-api';
import { useI18n } from './I18nProvider';

// Global command palette (Cmd/Ctrl+K). Behavior:
//  - Shows static navigation items (Library, Runs, Schedules, Workflows, Canvas).
//  - Fetches DB-backed skills and lets the user jump straight into Run or
//    Detail.
//  - Arrow keys + Enter to act, Esc to close.
//
// Lives globally by mounting it once in Providers; any page can call Cmd+K
// to reach anything in Cepage.

type CommandItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  keywords?: string[];
  run: () => void;
};

export function CommandPalette() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [skills, setSkills] = useState<UserSkillRow[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loadedOnceRef = useRef(false);

  // Global hotkey: Cmd/Ctrl+K opens, Escape closes. When input elements
  // have focus, we still consume the chord (matches VS Code / Linear).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      const ev = e as globalThis.KeyboardEvent;
      const cmd = ev.metaKey || ev.ctrlKey;
      if (cmd && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        setOpen((v) => !v);
      } else if (ev.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Lazy-load the list of skills the first time the palette opens. We
  // only refresh on each open() afterward if the user asks for it via
  // Cmd+R; for now a single fetch per session is enough.
  useEffect(() => {
    if (!open || loadedOnceRef.current) return;
    loadedOnceRef.current = true;
    void listUserSkills().then((res) => {
      if (res.success) setSkills(res.data);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const navigate = useCallback((path: string) => {
    setOpen(false);
    if (typeof window !== 'undefined') window.location.assign(path);
  }, []);

  const navItems: CommandItem[] = useMemo(
    () => [
      {
        id: 'go-library',
        title: t('ui.commandPalette.goLibrary'),
        subtitle: '/library',
        icon: '📚',
        keywords: ['library', 'skills', 'bibliothèque'],
        run: () => navigate('/library'),
      },
      {
        id: 'go-runs',
        title: t('ui.commandPalette.goRuns'),
        subtitle: '/library/runs',
        icon: '⏱',
        keywords: ['runs', 'history', 'historique'],
        run: () => navigate('/library/runs'),
      },
      {
        id: 'go-schedules',
        title: t('ui.commandPalette.goSchedules'),
        subtitle: '/library/schedules',
        icon: '📅',
        keywords: ['schedules', 'cron', 'planifications'],
        run: () => navigate('/library/schedules'),
      },
      {
        id: 'go-workflows',
        title: t('ui.commandPalette.goWorkflows'),
        subtitle: '/workflows',
        icon: '🗂',
        keywords: ['sessions', 'workflows'],
        run: () => navigate('/workflows'),
      },
      {
        id: 'go-canvas',
        title: t('ui.commandPalette.goCanvas'),
        subtitle: '/',
        icon: '🎨',
        keywords: ['canvas', 'studio'],
        run: () => navigate('/'),
      },
    ],
    [t, navigate],
  );

  const skillItems: CommandItem[] = useMemo(
    () =>
      skills.flatMap((skill) => [
        {
          id: `open-${skill.slug}`,
          title: skill.title,
          subtitle: `${t('ui.commandPalette.openSkill')} — ${skill.slug}`,
          icon: skill.icon ?? '🪄',
          keywords: [skill.title, skill.slug, skill.category ?? '', ...(skill.tags ?? [])],
          run: () => navigate(`/library/${encodeURIComponent(skill.slug)}`),
        },
        {
          id: `run-${skill.slug}`,
          title: t('ui.commandPalette.runSkillPrefix', { title: skill.title }),
          subtitle: `${skill.slug}`,
          icon: '▶️',
          keywords: [skill.title, skill.slug, 'run', 'exécuter'],
          run: () => navigate(`/library/${encodeURIComponent(skill.slug)}#run`),
        },
      ]),
    [skills, t, navigate],
  );

  const items = useMemo(() => [...navItems, ...skillItems], [navItems, skillItems]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((item) => {
      const bag = [item.title, item.subtitle ?? '', ...(item.keywords ?? [])];
      return bag.some((h) => typeof h === 'string' && h.toLowerCase().includes(q));
    });
  }, [items, query]);

  useEffect(() => {
    setIndex((current) => Math.min(Math.max(current, 0), Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((v) => Math.min(v + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((v) => Math.max(v - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[index];
      if (item) item.run();
    }
  };

  if (!open) return null;

  return (
    <div
      style={backdropStyle}
      role="dialog"
      aria-modal="true"
      aria-label={t('ui.commandPalette.title')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div style={panelStyle}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('ui.commandPalette.placeholder')}
          style={inputStyle}
        />
        <ul style={listStyle}>
          {filtered.length === 0 ? (
            <li style={emptyStyle}>{t('ui.commandPalette.empty')}</li>
          ) : (
            filtered.map((item, i) => {
              const active = i === index;
              return (
                <li
                  key={item.id}
                  style={{
                    ...rowStyle,
                    background: active ? 'var(--z-section-bg)' : 'transparent',
                    borderColor: active ? 'var(--z-btn-solid-border)' : 'transparent',
                  }}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => item.run()}
                >
                  <span aria-hidden style={{ fontSize: 16, width: 20, textAlign: 'center' }}>
                    {item.icon ?? '•'}
                  </span>
                  <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</div>
                    {item.subtitle ? (
                      <div style={subtitleStyle}>{item.subtitle}</div>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
        <div style={footerStyle}>
          <span>
            <kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> {t('ui.commandPalette.hintNav')}
          </span>
          <span>
            <kbd style={kbdStyle}>↵</kbd> {t('ui.commandPalette.hintOpen')}
          </span>
          <span>
            <kbd style={kbdStyle}>Esc</kbd> {t('ui.commandPalette.hintClose')}
          </span>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  backdropFilter: 'blur(2px)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '10vh 16px',
};

const panelStyle: CSSProperties = {
  width: '100%',
  maxWidth: 560,
  background: 'var(--z-bg-app)',
  color: 'var(--z-fg)',
  border: '1px solid var(--z-section-border)',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
  overflow: 'hidden',
  display: 'grid',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  fontSize: 15,
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--z-section-border)',
  color: 'var(--z-fg)',
  outline: 'none',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  padding: 6,
  margin: 0,
  maxHeight: '50vh',
  overflow: 'auto',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  border: '1px solid transparent',
};

const subtitleStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  gap: 14,
  padding: '8px 14px',
  borderTop: '1px solid var(--z-section-border)',
  fontSize: 11,
  color: 'var(--z-fg-muted)',
};

const kbdStyle: CSSProperties = {
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--z-section-border)',
  background: 'var(--z-section-bg)',
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  fontSize: 10,
  color: 'var(--z-fg)',
  marginRight: 4,
};

const emptyStyle: CSSProperties = {
  padding: '14px 12px',
  fontSize: 13,
  color: 'var(--z-fg-muted)',
  textAlign: 'center',
};
