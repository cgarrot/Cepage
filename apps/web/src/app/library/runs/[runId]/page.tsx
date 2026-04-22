'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSkillRun,
  getSkillRun,
  listUserSkills,
  streamSkillRun,
  type SkillRunRow,
  type SkillRunStreamEvent,
  type UserSkillRow,
} from '@cepage/client-api';
import { useI18n } from '@cepage/app-ui';
import {
  btnStyle,
  fmtDate,
  fmtDuration,
  headerStyle,
  monoStyle,
  pageStyle,
  runStatusTone,
  sectionStyle,
} from '../../lib';

// Single skill-run view: live status over SSE, typed inputs / outputs /
// errors, and cross-links to the parent skill and the session that owns
// the execution (when execution mode is "session").

export default function SkillRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = Array.isArray(params?.runId) ? params.runId[0] : params?.runId ?? '';
  const { t, locale } = useI18n();
  const [run, setRun] = useState<SkillRunRow | null>(null);
  const [skill, setSkill] = useState<UserSkillRow | null>(null);
  const [events, setEvents] = useState<SkillRunStreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    const res = await getSkillRun(runId);
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setRun(res.data);
    if (res.data.userSkillId) {
      // Resolve the slug via title lookup is unnecessary — we just need the
      // skill title. Unfortunately the run row carries the DB id. We fall
      // back to a best-effort lookup by id via the skills list.
      // In practice phase-2 adds a /skills/by-id endpoint.
      void fetchSkillForRun(res.data).then(setSkill).catch(() => setSkill(null));
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentRunId = run?.id ?? null;
  // Use a ref to snapshot the status at subscribe time so re-renders
  // from the stream do not re-subscribe mid-flight.
  const initialStatusRef = useRef(run?.status);
  initialStatusRef.current = run?.status ?? initialStatusRef.current;

  useEffect(() => {
    if (!currentRunId) return;
    const initialStatus = initialStatusRef.current;
    if (initialStatus !== 'queued' && initialStatus !== 'running') return;
    const stop = streamSkillRun(currentRunId, (evt) => {
      setEvents((prev) => [...prev, evt]);
      if (evt.type === 'snapshot') setRun(evt.data);
    });
    cleanupRef.current = stop;
    return () => {
      stop();
      cleanupRef.current = null;
    };
  }, [currentRunId]);

  const onCancel = useCallback(async () => {
    if (!run) return;
    const res = await cancelSkillRun(run.id);
    if (res.success) setRun(res.data);
  }, [run]);

  if (loading) {
    return (
      <div style={pageStyle}>
        <p style={{ color: 'var(--z-fg-muted)' }}>…</p>
      </div>
    );
  }
  if (error || !run) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <Link href="/library/runs" style={btnStyle}>
            {t('ui.skillsLibrary.back')}
          </Link>
        </header>
        <p style={{ color: 'var(--z-fg-status)' }}>
          {t('ui.skillsLibrary.loadError', { message: error ?? 'not found' })}
        </p>
      </div>
    );
  }

  const progressLogs = events
    .filter((evt) => evt.type === 'progress')
    .map((evt) => (evt as { data: { message: string } }).data.message);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/library/runs" style={btnStyle}>
          {t('ui.skillsLibrary.back')}
        </Link>
        {skill ? (
          <Link href={`/library/${encodeURIComponent(skill.slug)}`} style={btnStyle}>
            {t('ui.skillsLibrary.backToSkill')}
          </Link>
        ) : null}
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>
            {t('ui.skillsLibrary.runDetailTitle', { id: run.id.slice(0, 8) })}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={runStatusTone(run.status)}>
              {t(`ui.skillsLibrary.runStatus${capitalize(run.status)}` as const)}
            </span>
            {skill ? (
              <Link
                href={`/library/${encodeURIComponent(skill.slug)}`}
                style={{ fontSize: 13, color: 'var(--z-fg-link, #2563eb)' }}
              >
                {skill.title}
              </Link>
            ) : (
              <code style={{ fontSize: 12 }}>{run.skillId}</code>
            )}
            <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
              {t('ui.skillsLibrary.triggeredBy', { source: run.triggeredBy })}
            </span>
            <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
              {fmtDate(run.createdAt, locale)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
              {t('ui.skillsLibrary.durationLabel')}:{' '}
              {run.status === 'running' ? t('ui.skillsLibrary.durationPending') : fmtDuration(run.durationMs)}
            </span>
          </div>
        </div>
        {run.status === 'running' || run.status === 'queued' ? (
          <button type="button" style={btnStyle} onClick={() => void onCancel()}>
            {t('ui.skillsLibrary.cancelRun')}
          </button>
        ) : null}
        {run.sessionId ? (
          <Link
            href={`/?session=${encodeURIComponent(run.sessionId)}`}
            style={btnStyle}
          >
            {t('ui.skillsLibrary.openSession')}
          </Link>
        ) : null}
      </header>

      <section
        style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
        }}
      >
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>{t('ui.skillsLibrary.inputsJson')}</h2>
          <pre style={{ ...monoStyle, margin: 0, maxHeight: 400 }}>
            {JSON.stringify(run.inputs, null, 2)}
          </pre>
        </div>
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>{t('ui.skillsLibrary.outputsJson')}</h2>
          {run.outputs ? (
            <pre style={{ ...monoStyle, margin: 0, maxHeight: 400 }}>
              {JSON.stringify(run.outputs, null, 2)}
            </pre>
          ) : (
            <p style={{ color: 'var(--z-fg-muted)', fontSize: 13 }}>
              {run.status === 'running' ? t('ui.skillsLibrary.running') : '—'}
            </p>
          )}
        </div>
      </section>

      {run.error ? (
        <section
          style={{
            ...sectionStyle,
            marginTop: 14,
            borderColor: 'rgba(220, 38, 38, 0.35)',
            background: 'rgba(220, 38, 38, 0.06)',
          }}
        >
          <h2 style={{ ...sectionTitle, color: 'var(--z-fg-status, #dc2626)' }}>
            {t('ui.skillsLibrary.errorLabel')}
          </h2>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>{run.error.code}</strong>: {run.error.message}
          </p>
          {run.error.details ? (
            <pre style={{ ...monoStyle, marginTop: 8 }}>
              {JSON.stringify(run.error.details, null, 2)}
            </pre>
          ) : null}
        </section>
      ) : null}

      {progressLogs.length > 0 ? (
        <section style={{ ...sectionStyle, marginTop: 14 }}>
          <h2 style={sectionTitle}>{t('ui.skillsLibrary.logsSectionTitle')}</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {progressLogs.map((log, i) => (
              <li key={i}>{log}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}

async function fetchSkillForRun(run: SkillRunRow): Promise<UserSkillRow | null> {
  if (!run.userSkillId) return null;
  // The API exposes user-skills by slug, not by id, so we filter the full
  // list. Phase 2 adds a /skills/by-id endpoint for large libraries.
  try {
    const res = await listUserSkills();
    if (!res.success) return null;
    return res.data.find((row) => row.id === run.userSkillId) ?? null;
  } catch {
    return null;
  }
}

const sectionTitle = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
} as const;
