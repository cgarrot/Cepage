'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listSkillRuns,
  listUserSkills,
  type SkillRunRow,
  type UserSkillRow,
} from '@cepage/client-api';
import { useI18n } from '@cepage/app-ui';
import {
  btnStyle,
  fmtDate,
  fmtDuration,
  headerStyle,
  pageStyle,
  runStatusTone,
  sectionStyle,
} from '../lib';

// Run history across every skill. Filterable by skill and status so users
// can investigate failures or audit automated schedules.

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

type StatusFilter = 'all' | (typeof STATUSES)[number];

export default function SkillRunsPage() {
  const { t, locale } = useI18n();
  const [runs, setRuns] = useState<SkillRunRow[]>([]);
  const [skills, setSkills] = useState<UserSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [runsRes, skillsRes] = await Promise.all([
      listSkillRuns({ limit: 200 }),
      listUserSkills(),
    ]);
    setLoading(false);
    if (!runsRes.success) {
      setError(runsRes.error.message);
      return;
    }
    setRuns(runsRes.data);
    if (skillsRes.success) setSkills(skillsRes.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const skillById = useMemo(() => {
    const map = new Map<string, UserSkillRow>();
    for (const s of skills) map.set(s.id, s);
    return map;
  }, [skills]);

  const filtered = useMemo(() => {
    return runs.filter((run) => {
      if (skillFilter !== 'all' && run.skillId !== skillFilter) return false;
      if (statusFilter !== 'all' && run.status !== statusFilter) return false;
      return true;
    });
  }, [runs, skillFilter, statusFilter]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('ui.skillsLibrary.runsTab')}</h1>
          <p style={{ margin: 0, color: 'var(--z-fg-muted)', fontSize: 13 }}>
            {t('ui.skillsLibrary.subtitle')}
          </p>
        </div>
        <Link href="/library" style={btnStyle}>
          {t('ui.skillsLibrary.back')}
        </Link>
      </header>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <select
          value={skillFilter}
          onChange={(e) => setSkillFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">{t('ui.skillsLibrary.allKinds')}</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={selectStyle}
        >
          <option value="all">{t('ui.skillsLibrary.allVisibility')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`ui.skillsLibrary.runStatus${capitalize(s)}` as const)}
            </option>
          ))}
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
        <p style={{ color: 'var(--z-fg-muted)' }}>{t('ui.skillsLibrary.emptyRuns')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {filtered.map((run) => {
            const skill = run.userSkillId ? skillById.get(run.userSkillId) : undefined;
            return (
              <li key={run.id}>
                <article style={{ ...sectionStyle, display: 'grid', gap: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={runStatusTone(run.status)}>
                      {t(`ui.skillsLibrary.runStatus${capitalize(run.status)}` as const)}
                    </span>
                    <strong>
                      {skill ? skill.title : run.skillId}
                    </strong>
                    <code style={{ fontSize: 12 }}>{run.id.slice(0, 8)}…</code>
                    <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                      {t('ui.skillsLibrary.triggeredBy', { source: run.triggeredBy })}
                    </span>
                    <span
                      style={{ fontSize: 12, color: 'var(--z-fg-muted)', marginLeft: 'auto' }}
                    >
                      {fmtDate(run.createdAt, locale)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                      {t('ui.skillsLibrary.durationLabel')}: {fmtDuration(run.durationMs)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link href={`/library/runs/${run.id}`} style={btnStyle}>
                      {t('ui.skillsLibrary.openRun')}
                    </Link>
                    {skill ? (
                      <Link href={`/library/${encodeURIComponent(skill.slug)}`} style={btnStyle}>
                        {t('ui.skillsLibrary.open')}
                      </Link>
                    ) : null}
                    {run.sessionId ? (
                      <Link
                        href={`/?session=${encodeURIComponent(run.sessionId)}`}
                        style={btnStyle}
                      >
                        {t('ui.skillsLibrary.openSession')}
                      </Link>
                    ) : null}
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

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
} as const;
