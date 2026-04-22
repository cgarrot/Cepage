'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteUserSkill, listUserSkills, type UserSkillRow } from '@cepage/client-api';
import { useI18n } from '@cepage/app-ui';
import {
  btnSolidStyle,
  btnStyle,
  countInputs,
  countOutputs,
  extractTags,
  fmtDate,
  headerStyle,
  matchesQuery,
  pageStyle,
  sectionStyle,
  tagStyle,
  uniqueCategories,
  uniqueKinds,
} from './lib';

// Library index: grid + filters + search over DB-backed UserSkill rows.
// Clicking a card navigates to /library/[slug] where the auto-form from the
// inputsSchema lets users actually run the skill.

type VisibilityFilter = 'all' | 'private' | 'workspace' | 'public';

export default function LibraryPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<UserSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState<'all' | string>('all');
  const [kind, setKind] = useState<'all' | string>('all');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listUserSkills();
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setRows(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (category !== 'all' && row.category !== category) return false;
      if (kind !== 'all' && row.kind !== kind) return false;
      if (visibility !== 'all' && row.visibility !== visibility) return false;
      return matchesQuery(row, debouncedQuery);
    });
  }, [rows, category, kind, visibility, debouncedQuery]);

  const categories = useMemo(() => uniqueCategories(rows), [rows]);
  const kinds = useMemo(() => uniqueKinds(rows), [rows]);

  const onDelete = useCallback(
    async (skill: UserSkillRow) => {
      if (!window.confirm(t('ui.skillsLibrary.deleteConfirm', { title: skill.title }))) return;
      const res = await deleteUserSkill(skill.slug);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      await load();
    },
    [load, t],
  );

  const onOpen = useCallback(
    (slug: string) => {
      router.push(`/library/${encodeURIComponent(slug)}`);
    },
    [router],
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('ui.skillsLibrary.title')}</h1>
          <p style={{ margin: 0, color: 'var(--z-fg-muted)', fontSize: 13, maxWidth: 640 }}>
            {t('ui.skillsLibrary.subtitle')}
          </p>
        </div>
        <Link href="/workflows" style={btnStyle}>
          {t('ui.skillsLibrary.back')}
        </Link>
        <Link href="/library/schedules" style={btnStyle}>
          {t('ui.skillsLibrary.schedules')}
        </Link>
        <Link href="/library/webhooks" style={btnStyle}>
          {t('ui.skillsLibrary.webhooks')}
        </Link>
      </header>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ui.skillsLibrary.searchPlaceholder')}
          style={{
            flex: '1 1 260px',
            minWidth: 220,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--z-border-input)',
            background: 'var(--z-input-bg)',
            color: 'var(--z-fg)',
          }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={selectStyle}
        >
          <option value="all">{t('ui.skillsLibrary.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={selectStyle}>
          <option value="all">{t('ui.skillsLibrary.allKinds')}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as VisibilityFilter)}
          style={selectStyle}
        >
          <option value="all">{t('ui.skillsLibrary.allVisibility')}</option>
          <option value="private">private</option>
          <option value="workspace">workspace</option>
          <option value="public">public</option>
        </select>
        <span style={{ fontSize: 13, color: 'var(--z-fg-muted)' }}>
          {t('ui.skillsLibrary.countBadge', { count: String(filtered.length) })}
        </span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--z-fg-muted)' }}>…</p>
      ) : error ? (
        <p style={{ color: 'var(--z-fg-status)' }}>
          {t('ui.skillsLibrary.loadError', { message: error })}
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--z-fg-muted)' }}>{t('ui.skillsLibrary.empty')}</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}
        >
          {filtered.map((row) => {
            const tags = extractTags(row);
            const inputsCount = countInputs(row);
            const outputsCount = countOutputs(row);
            return (
              <li key={row.id}>
                <article style={{ ...sectionStyle, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{row.icon ?? '🪄'}</span>
                    <button
                      type="button"
                      onClick={() => onOpen(row.slug)}
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        color: 'var(--z-fg)',
                        cursor: 'pointer',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.title}
                    </button>
                    {row.deprecated ? (
                      <span
                        style={{
                          ...tagStyle,
                          color: 'var(--z-fg-status, #dc2626)',
                          borderColor: 'rgba(220, 38, 38, 0.35)',
                        }}
                      >
                        {t('ui.skillsLibrary.deprecatedBadge')}
                      </span>
                    ) : null}
                  </div>
                  <code style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>{row.slug}</code>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--z-fg-section)',
                      margin: 0,
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 3,
                      overflow: 'hidden',
                    }}
                  >
                    {row.summary}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {row.category ? <span style={tagStyle}>{row.category}</span> : null}
                    <span style={tagStyle}>{row.kind}</span>
                    <span style={tagStyle}>{row.visibility}</span>
                    <span style={tagStyle}>v{row.version}</span>
                    {tags.slice(0, 3).map((tag) => (
                      <span key={tag} style={tagStyle}>#{tag}</span>
                    ))}
                    {tags.length > 3 ? <span style={tagStyle}>+{tags.length - 3}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                    {t('ui.skillsLibrary.inputsCount', { count: String(inputsCount) })} ·{' '}
                    {t('ui.skillsLibrary.outputsCount', { count: String(outputsCount) })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>
                    {t('ui.skillsLibrary.updated')}: {fmtDate(row.updatedAt, locale)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={btnSolidStyle}
                      onClick={() => onOpen(row.slug)}
                    >
                      {t('ui.skillsLibrary.open')}
                    </button>
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={() => void onDelete(row)}
                    >
                      {t('ui.skillsLibrary.delete')}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
} as const;
