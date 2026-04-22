'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createScheduledSkillRun,
  deleteScheduledSkillRun,
  listScheduledSkillRuns,
  listUserSkills,
  runScheduledSkillRunNow,
  updateScheduledSkillRun,
  type ScheduledSkillRunRow,
  type UserSkillRow,
} from '@cepage/client-api';
import { useI18n, SchemaAutoForm } from '@cepage/app-ui';
import {
  btnSolidStyle,
  btnStyle,
  fmtDate,
  headerStyle,
  pageStyle,
  sectionStyle,
  tagStyle,
} from '../lib';

// Schedules UI: list, create, pause, resume, run-now, delete. Lean on the
// existing `scheduled-skill-runs` API that already plugs into the daemon's
// cron worker. For the typed skill contract, we'll add a second lane in
// phase 2 that executes skills directly via POST /skills/:slug/runs; for
// now we keep the session-mode behavior so v1 stays backward compatible.

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at 9am', cron: '0 9 * * *' },
  { label: 'Every monday 9am', cron: '0 9 * * 1' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every morning 6am', cron: '0 6 * * *' },
];

export default function SchedulesPage() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ScheduledSkillRunRow[]>([]);
  const [skills, setSkills] = useState<UserSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [rowsRes, skillsRes] = await Promise.all([
      listScheduledSkillRuns(),
      listUserSkills(),
    ]);
    setLoading(false);
    if (!rowsRes.success) {
      setError(rowsRes.error.message);
      return;
    }
    setRows(rowsRes.data.items);
    if (skillsRes.success) setSkills(skillsRes.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const skillBySlug = useMemo(() => {
    const map = new Map<string, UserSkillRow>();
    for (const skill of skills) map.set(skill.slug, skill);
    return map;
  }, [skills]);

  const onToggle = useCallback(
    async (row: ScheduledSkillRunRow) => {
      const next = row.status === 'active' ? 'paused' : 'active';
      const res = await updateScheduledSkillRun(row.id, { status: next });
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      await load();
    },
    [load],
  );

  const onDelete = useCallback(
    async (row: ScheduledSkillRunRow) => {
      if (!window.confirm(t('ui.schedules.deleteConfirm', { label: row.label ?? row.skillId }))) {
        return;
      }
      const res = await deleteScheduledSkillRun(row.id);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      await load();
    },
    [load, t],
  );

  const onRunNow = useCallback(
    async (row: ScheduledSkillRunRow) => {
      const res = await runScheduledSkillRunNow(row.id);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      await load();
    },
    [load],
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('ui.schedules.title')}</h1>
          <p style={{ margin: 0, color: 'var(--z-fg-muted)', fontSize: 13, maxWidth: 640 }}>
            {t('ui.schedules.subtitle')}
          </p>
        </div>
        <Link href="/library" style={btnStyle}>
          {t('ui.skillsLibrary.back')}
        </Link>
        <button
          type="button"
          style={btnSolidStyle}
          onClick={() => setCreateOpen(true)}
          disabled={skills.length === 0}
        >
          {t('ui.schedules.newSchedule')}
        </button>
      </header>

      {createOpen ? (
        <CreateScheduleInline
          skills={skills}
          onCancel={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void load();
          }}
          onError={setError}
        />
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--z-fg-muted)' }}>…</p>
      ) : error ? (
        <p style={{ color: 'var(--z-fg-status)' }}>{error}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--z-fg-muted)' }}>{t('ui.schedules.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {rows.map((row) => {
            const skill = skillBySlug.get(row.skillId);
            return (
              <li key={row.id}>
                <article style={{ ...sectionStyle, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>
                      {row.label ?? skill?.title ?? row.skillId}
                    </strong>
                    <span style={{ ...tagStyle, fontFamily: 'ui-monospace, monospace' }}>
                      {row.cron}
                    </span>
                    <span
                      style={{
                        ...tagStyle,
                        color:
                          row.status === 'active'
                            ? 'var(--z-fg-status-success, #16a34a)'
                            : 'var(--z-fg-muted)',
                      }}
                    >
                      {row.status}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--z-fg-muted)', marginLeft: 'auto' }}>
                      {t('ui.schedules.nextRun')}: {fmtDate(row.nextRunAt, locale)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                    {skill ? (
                      <>
                        {t('ui.skillsLibrary.open')}:{' '}
                        <Link
                          href={`/library/${encodeURIComponent(skill.slug)}`}
                          style={{ color: 'var(--z-fg-link, #2563eb)' }}
                        >
                          {skill.title}
                        </Link>
                      </>
                    ) : (
                      <code>{row.skillId}</code>
                    )}
                  </div>
                  {row.lastError ? (
                    <div style={{ fontSize: 12, color: 'var(--z-fg-status, #dc2626)' }}>
                      {t('ui.schedules.lastError')}: {row.lastError}
                    </div>
                  ) : row.lastRunAt ? (
                    <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                      {t('ui.schedules.lastRun')}: {fmtDate(row.lastRunAt, locale)}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={btnStyle} onClick={() => void onToggle(row)}>
                      {row.status === 'active' ? t('ui.schedules.pause') : t('ui.schedules.resume')}
                    </button>
                    <button type="button" style={btnStyle} onClick={() => void onRunNow(row)}>
                      {t('ui.schedules.runNow')}
                    </button>
                    <button type="button" style={btnStyle} onClick={() => void onDelete(row)}>
                      {t('ui.schedules.delete')}
                    </button>
                    {row.lastSessionId ? (
                      <Link
                        href={`/?session=${encodeURIComponent(row.lastSessionId)}`}
                        style={btnStyle}
                      >
                        {t('ui.schedules.openLastSession')}
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

type CreateInlineProps = {
  skills: UserSkillRow[];
  onCancel: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
};

function CreateScheduleInline({ skills, onCancel, onCreated, onError }: CreateInlineProps) {
  const { t, locale } = useI18n();
  const [skillSlug, setSkillSlug] = useState(skills[0]?.slug ?? '');
  const [label, setLabel] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  const selectedSkill = useMemo(
    () => skills.find((s) => s.slug === skillSlug),
    [skills, skillSlug],
  );

  const onSubmit = useCallback(async () => {
    if (!skillSlug) return;
    setBusy(true);
    const res = await createScheduledSkillRun({
      label: label.trim() || undefined,
      skillId: skillSlug,
      cron: cron.trim(),
      status: 'active',
      inputs,
    });
    setBusy(false);
    if (!res.success) {
      onError(res.error.message);
      return;
    }
    onCreated();
  }, [skillSlug, label, cron, inputs, onCreated, onError]);

  return (
    <section style={{ ...sectionStyle, display: 'grid', gap: 10, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t('ui.schedules.createTitle')}</h2>
      <label style={fieldLabelStyle}>
        {t('ui.schedules.fieldSkill')}
        <select
          value={skillSlug}
          onChange={(e) => {
            setSkillSlug(e.target.value);
            setInputs({});
          }}
          style={inputStyle}
        >
          {skills.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.title} ({s.slug})
            </option>
          ))}
        </select>
      </label>
      <label style={fieldLabelStyle}>
        {t('ui.schedules.fieldLabel')}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
          placeholder={t('ui.schedules.fieldLabelPlaceholder')}
        />
      </label>
      <label style={fieldLabelStyle}>
        {t('ui.schedules.fieldCron')}
        <input
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          style={{
            ...inputStyle,
            fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CRON_PRESETS.map((preset) => (
          <button
            key={preset.cron}
            type="button"
            style={btnStyle}
            onClick={() => setCron(preset.cron)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div style={fieldLabelStyle}>
        {t('ui.schedules.fieldInputs')}
        <SchemaAutoForm
          schema={selectedSkill?.inputsSchema}
          value={inputs}
          onChange={setInputs}
          disabled={busy}
          locale={locale}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={btnSolidStyle}
          onClick={() => void onSubmit()}
          disabled={!skillSlug || !cron.trim() || busy}
        >
          {busy ? t('ui.schedules.creating') : t('ui.schedules.create')}
        </button>
        <button type="button" style={btnStyle} onClick={onCancel}>
          {t('ui.schedules.cancel')}
        </button>
      </div>
    </section>
  );
}

const fieldLabelStyle = {
  display: 'grid',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--z-fg)',
} as const;

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box' as const,
};
