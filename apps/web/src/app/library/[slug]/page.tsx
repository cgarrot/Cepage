'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelSkillRun,
  createSkillRun,
  getUserSkill,
  listSkillRunsForSkill,
  streamSkillRun,
  validateUserSkillInputs,
  type SkillRunRow,
  type SkillRunStreamEvent,
  type UserSkillRow,
} from '@cepage/client-api';
import { SchemaAutoForm, useI18n } from '@cepage/app-ui';
import {
  btnSolidStyle,
  btnStyle,
  countInputs,
  countOutputs,
  extractTags,
  fmtDate,
  fmtDuration,
  headerStyle,
  monoStyle,
  pageStyle,
  runStatusTone,
  sectionStyle,
  tagStyle,
} from '../lib';

type Tab = 'run' | 'about' | 'schema' | 'runs';

// Snippets for "Copy API call" — 5 channels that reuse the same typed
// skill contract. We show real slug and a plausible input payload so
// users can paste straight into their code. Shown under the Run form.

function curlSnippet(slug: string, inputs: unknown): string {
  return [
    `curl -X POST http://localhost:3000/api/v1/skills/${slug}/runs?wait=true \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${JSON.stringify({ inputs }).replace(/'/g, "'\\''")}'`,
  ].join('\n');
}

function fetchSnippet(slug: string, inputs: unknown): string {
  return [
    `await fetch('/api/v1/skills/${slug}/runs?wait=true', {`,
    `  method: 'POST',`,
    `  headers: { 'Content-Type': 'application/json' },`,
    `  body: JSON.stringify(${JSON.stringify({ inputs }, null, 2).replace(/\n/g, '\n  ')}),`,
    `}).then((r) => r.json());`,
  ].join('\n');
}

function tsSdkSnippet(slug: string, inputs: unknown): string {
  return [
    `import { Cepage } from '@cepage/sdk';`,
    ``,
    `const cepage = new Cepage({ baseUrl: process.env.CEPAGE_URL });`,
    `const { outputs } = await cepage.skills['${slug}'].run(${JSON.stringify(inputs, null, 2)});`,
  ].join('\n');
}

function pythonSdkSnippet(slug: string, inputs: unknown): string {
  return [
    `from cepage import Cepage`,
    ``,
    `cepage = Cepage(base_url=os.environ["CEPAGE_URL"])`,
    `result = cepage.skills["${slug}"].run(${JSON.stringify(inputs)})`,
    `print(result.outputs)`,
  ].join('\n');
}

function cliSnippet(slug: string, inputs: unknown): string {
  const pairs = Object.entries(inputs as Record<string, unknown>)
    .map(([key, val]) => {
      if (typeof val === 'string') return `--${key} ${JSON.stringify(val)}`;
      return `--${key} '${JSON.stringify(val)}'`;
    })
    .join(' ');
  return `cepage skill run ${slug} ${pairs}`.trim();
}

function mcpSnippet(slug: string): string {
  return [
    `{`,
    `  "mcpServers": {`,
    `    "cepage": {`,
    `      "command": "npx",`,
    `      "args": ["@cepage/mcp", "--base-url", "http://localhost:3000"]`,
    `    }`,
    `  }`,
    `}`,
    ``,
    `# Then call the tool named: cepage.${slug}`,
  ].join('\n');
}

export default function SkillDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug ?? '';
  const router = useRouter();
  const { t, locale } = useI18n();

  const [skill, setSkill] = useState<UserSkillRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('run');

  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<SkillRunRow | null>(null);
  const [events, setEvents] = useState<SkillRunStreamEvent[]>([]);
  const eventCleanupRef = useRef<(() => void) | null>(null);

  const [recentRuns, setRecentRuns] = useState<SkillRunRow[]>([]);
  const [copyMode, setCopyMode] = useState<'curl' | 'fetch' | 'ts' | 'py' | 'cli' | 'mcp' | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    const res = await getUserSkill(slug);
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setSkill(res.data);
    // Hydrate default inputs from schema if the user hasn't typed yet.
    setInputs((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const defaults: Record<string, unknown> = {};
      const props = (res.data.inputsSchema as { properties?: Record<string, { default?: unknown }> } | null)?.properties;
      if (props) {
        for (const [key, child] of Object.entries(props)) {
          if (child && 'default' in child && child.default !== undefined) {
            defaults[key] = child.default;
          }
        }
      }
      return defaults;
    });
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRuns = useCallback(async () => {
    if (!slug) return;
    const res = await listSkillRunsForSkill(slug, 20);
    if (res.success) setRecentRuns(res.data);
  }, [slug]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    return () => {
      if (eventCleanupRef.current) eventCleanupRef.current();
      eventCleanupRef.current = null;
    };
  }, []);

  const onRun = useCallback(async () => {
    if (!skill) return;
    setRunning(true);
    setRunError(null);
    setFieldErrors({});
    setEvents([]);
    setActiveRun(null);

    // Validate client-side first so we can show per-field errors. We still
    // rely on server validation as the source of truth.
    const validation = await validateUserSkillInputs(skill.slug, inputs);
    if (validation.success && validation.data.ok === false) {
      const next: Record<string, string | undefined> = {};
      for (const err of validation.data.errors) {
        const name = err.path.replace(/^\.?\//, '').split('/').pop();
        if (name) next[name] = err.message;
      }
      setFieldErrors(next);
      setRunError(t('ui.skillsLibrary.validationFailed'));
      setRunning(false);
      return;
    }

    const res = await createSkillRun(
      skill.slug,
      { inputs, triggeredBy: 'ui' },
      { wait: false },
    );
    if (!res.success) {
      setRunError(res.error.message);
      setRunning(false);
      return;
    }
    setActiveRun(res.data);
    // Subscribe to the SSE stream. The stream pushes the final snapshot
    // right away so we don't need polling.
    const stop = streamSkillRun(res.data.id, (evt) => {
      setEvents((prev) => [...prev, evt]);
      if (evt.type === 'snapshot') setActiveRun(evt.data);
      if (evt.type === 'succeeded' || evt.type === 'failed' || evt.type === 'cancelled') {
        setRunning(false);
        void loadRuns();
      }
    });
    eventCleanupRef.current = stop;
  }, [skill, inputs, t, loadRuns]);

  const onCancel = useCallback(async () => {
    if (!activeRun) return;
    await cancelSkillRun(activeRun.id);
  }, [activeRun]);

  const snippetInputs = useMemo(() => {
    if (Object.keys(inputs).length > 0) return inputs;
    const props = (skill?.inputsSchema as { properties?: Record<string, JsonSchemaChild> } | null)
      ?.properties;
    if (!props) return {};
    const sample: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(props)) {
      sample[key] = sampleValue(child);
    }
    return sample;
  }, [inputs, skill]);

  const copySnippet = (mode: 'curl' | 'fetch' | 'ts' | 'py' | 'cli' | 'mcp') => {
    if (!skill) return;
    let text = '';
    switch (mode) {
      case 'curl':
        text = curlSnippet(skill.slug, snippetInputs);
        break;
      case 'fetch':
        text = fetchSnippet(skill.slug, snippetInputs);
        break;
      case 'ts':
        text = tsSdkSnippet(skill.slug, snippetInputs);
        break;
      case 'py':
        text = pythonSdkSnippet(skill.slug, snippetInputs);
        break;
      case 'cli':
        text = cliSnippet(skill.slug, snippetInputs);
        break;
      case 'mcp':
        text = mcpSnippet(skill.slug);
        break;
    }
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopyFlash(true);
        window.setTimeout(() => setCopyFlash(false), 1500);
      })
      .catch(() => setCopyFlash(false));
    setCopyMode(mode);
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <p style={{ color: 'var(--z-fg-muted)' }}>…</p>
      </div>
    );
  }
  if (error || !skill) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <Link href="/library" style={btnStyle}>
            {t('ui.skillsLibrary.back')}
          </Link>
        </header>
        <p style={{ color: 'var(--z-fg-status)' }}>
          {t('ui.skillsLibrary.loadError', { message: error ?? 'not found' })}
        </p>
      </div>
    );
  }

  const tags = extractTags(skill);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/library" style={btnStyle}>
          {t('ui.skillsLibrary.back')}
        </Link>
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4, minWidth: 0 }}>
          <h1
            style={{
              fontSize: 22,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 28 }}>{skill.icon ?? '🪄'}</span>
            {skill.title}
            {skill.deprecated ? (
              <span style={{ ...tagStyle, color: 'var(--z-fg-status)' }}>
                {t('ui.skillsLibrary.deprecatedBadge')}
              </span>
            ) : null}
          </h1>
          <code style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
            {skill.slug} · v{skill.version}
          </code>
          <p style={{ margin: 0, color: 'var(--z-fg-section)', fontSize: 13, maxWidth: 720 }}>
            {skill.summary}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skill.category ? <span style={tagStyle}>{skill.category}</span> : null}
            <span style={tagStyle}>{skill.kind}</span>
            <span style={tagStyle}>{skill.visibility}</span>
            {tags.map((tag) => (
              <span key={tag} style={tagStyle}>
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <TabButton tab={tab} target="run" onSelect={setTab} label={t('ui.skillsLibrary.runNow')} />
        <TabButton tab={tab} target="runs" onSelect={setTab} label={t('ui.skillsLibrary.runsTab')} />
        <TabButton tab={tab} target="schema" onSelect={setTab} label={t('ui.skillsLibrary.schemaTab')} />
        <TabButton tab={tab} target="about" onSelect={setTab} label={t('ui.skillsLibrary.aboutTab')} />
      </nav>

      {tab === 'run' ? (
        <section
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
          }}
        >
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>{t('ui.skillsLibrary.inputsSectionTitle')}</h2>
            <SchemaAutoForm
              schema={skill.inputsSchema}
              value={inputs}
              onChange={setInputs}
              errors={fieldErrors}
              disabled={running}
              locale={locale}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={btnSolidStyle}
                disabled={running}
                onClick={() => void onRun()}
              >
                {running ? t('ui.skillsLibrary.runBusy') : t('ui.skillsLibrary.runNow')}
              </button>
              {activeRun && activeRun.status === 'running' ? (
                <button type="button" style={btnStyle} onClick={() => void onCancel()}>
                  {t('ui.skillsLibrary.cancelRun')}
                </button>
              ) : null}
              <CopyApiDropdown onCopy={copySnippet} activeMode={copyMode} flash={copyFlash} t={t} />
            </div>
            {runError ? (
              <p style={{ marginTop: 10, color: 'var(--z-fg-status)' }}>{runError}</p>
            ) : null}
          </div>
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>{t('ui.skillsLibrary.outputsSectionTitle')}</h2>
            {activeRun ? (
              <RunSnapshot run={activeRun} events={events} t={t} locale={locale} router={router} />
            ) : (
              <p style={{ color: 'var(--z-fg-muted)', fontSize: 13 }}>
                {t('ui.skillsLibrary.emptyRuns')}
              </p>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'runs' ? (
        <section style={{ display: 'grid', gap: 10 }}>
          {recentRuns.length === 0 ? (
            <p style={{ color: 'var(--z-fg-muted)' }}>{t('ui.skillsLibrary.emptyRuns')}</p>
          ) : (
            recentRuns.map((run) => (
              <article key={run.id} style={{ ...sectionStyle, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={runStatusTone(run.status)}>
                    {t(`ui.skillsLibrary.runStatus${capitalize(run.status)}` as const)}
                  </span>
                  <code style={{ fontSize: 12 }}>{run.id.slice(0, 8)}…</code>
                  <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                    {t('ui.skillsLibrary.triggeredBy', { source: run.triggeredBy })}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
                    {fmtDate(run.createdAt, locale)}
                  </span>
                  <span
                    style={{ fontSize: 12, color: 'var(--z-fg-muted)', marginLeft: 'auto' }}
                  >
                    {t('ui.skillsLibrary.durationLabel')}: {fmtDuration(run.durationMs)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link href={`/library/runs/${run.id}`} style={btnStyle}>
                    {t('ui.skillsLibrary.openRun')}
                  </Link>
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
            ))
          )}
        </section>
      ) : null}

      {tab === 'schema' ? (
        <section
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
          }}
        >
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>
              {t('ui.skillsLibrary.inputsSectionTitle')} ({countInputs(skill)})
            </h2>
            <pre style={{ ...monoStyle, margin: 0 }}>
              {JSON.stringify(skill.inputsSchema, null, 2)}
            </pre>
          </div>
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>
              {t('ui.skillsLibrary.outputsSectionTitle')} ({countOutputs(skill)})
            </h2>
            <pre style={{ ...monoStyle, margin: 0 }}>
              {JSON.stringify(skill.outputsSchema, null, 2)}
            </pre>
          </div>
        </section>
      ) : null}

      {tab === 'about' ? (
        <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)' }}>
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>{t('ui.skillsLibrary.summaryLabel')}</h2>
            <p style={{ fontSize: 13, color: 'var(--z-fg-section)', margin: 0 }}>{skill.summary}</p>
            <dl style={dlStyle}>
              <dt>{t('ui.skillsLibrary.slugLabel')}</dt>
              <dd>
                <code>{skill.slug}</code>
              </dd>
              <dt>{t('ui.skillsLibrary.kind')}</dt>
              <dd>{skill.kind}</dd>
              <dt>{t('ui.skillsLibrary.category')}</dt>
              <dd>{skill.category ?? '—'}</dd>
              <dt>{t('ui.skillsLibrary.visibility')}</dt>
              <dd>{skill.visibility}</dd>
              <dt>{t('ui.skillsLibrary.version')}</dt>
              <dd>v{skill.version}</dd>
              <dt>{t('ui.skillsLibrary.source')}</dt>
              <dd>
                {skill.sourceSessionId ? (
                  <Link
                    href={`/?session=${encodeURIComponent(skill.sourceSessionId)}`}
                    style={{ color: 'var(--z-fg-link, #2563eb)' }}
                  >
                    {t('ui.skillsLibrary.sourceSession')}
                  </Link>
                ) : (
                  t('ui.skillsLibrary.sourceLibrary')
                )}
              </dd>
              <dt>{t('ui.skillsLibrary.created')}</dt>
              <dd>{fmtDate(skill.createdAt, locale)}</dd>
              <dt>{t('ui.skillsLibrary.updated')}</dt>
              <dd>{fmtDate(skill.updatedAt, locale)}</dd>
            </dl>
          </div>
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>{t('ui.skillsLibrary.schedules')}</h2>
            <p style={{ fontSize: 13, color: 'var(--z-fg-muted)', margin: 0 }}>
              {t('ui.skillsLibrary.schedulesEmpty')}
            </p>
            <Link
              href={`/library/schedules?skill=${encodeURIComponent(skill.slug)}`}
              style={{ ...btnStyle, marginTop: 10 }}
            >
              {t('ui.skillsLibrary.schedulesLink')}
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type JsonSchemaChild = {
  type?: string;
  default?: unknown;
  enum?: unknown[];
  items?: { type?: string };
  examples?: unknown[];
};

function sampleValue(child: JsonSchemaChild): unknown {
  if (child.default !== undefined) return child.default;
  if (Array.isArray(child.examples) && child.examples.length > 0) return child.examples[0];
  if (Array.isArray(child.enum) && child.enum.length > 0) return child.enum[0];
  switch (child.type) {
    case 'string':
      return 'example';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array': {
      const itemType = child.items?.type ?? 'string';
      return itemType === 'string' ? ['example'] : [0];
    }
    case 'object':
      return {};
    default:
      return null;
  }
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}

function TabButton({
  tab,
  target,
  label,
  onSelect,
}: {
  tab: Tab;
  target: Tab;
  label: string;
  onSelect: (tab: Tab) => void;
}) {
  const active = tab === target;
  return (
    <button
      type="button"
      onClick={() => onSelect(target)}
      style={{
        ...btnStyle,
        borderColor: active ? 'var(--z-btn-solid-border)' : 'var(--z-btn-ghost-border)',
        background: active ? 'var(--z-btn-solid-bg)' : 'var(--z-btn-ghost-bg)',
        color: active ? 'var(--z-btn-solid-fg)' : 'var(--z-btn-ghost-fg)',
      }}
    >
      {label}
    </button>
  );
}

function RunSnapshot({
  run,
  events,
  t,
  locale,
  router,
}: {
  run: SkillRunRow;
  events: SkillRunStreamEvent[];
  t: ReturnType<typeof useI18n>['t'];
  locale: string;
  router: ReturnType<typeof useRouter>;
}) {
  const progressLogs = events
    .filter((evt) => evt.type === 'progress')
    .map((evt) => (evt as { data: { message: string } }).data.message);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={runStatusTone(run.status)}>
          {t(`ui.skillsLibrary.runStatus${capitalize(run.status)}` as const)}
        </span>
        <code style={{ fontSize: 12 }}>{run.id.slice(0, 8)}…</code>
        <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
          {t('ui.skillsLibrary.durationLabel')}: {fmtDuration(run.durationMs)}
        </span>
        <Link
          href={`/library/runs/${run.id}`}
          style={{ ...btnStyle, marginLeft: 'auto' }}
        >
          {t('ui.skillsLibrary.openRun')}
        </Link>
        {run.sessionId ? (
          <button
            type="button"
            style={btnStyle}
            onClick={() => router.push(`/?session=${encodeURIComponent(run.sessionId ?? '')}`)}
          >
            {t('ui.skillsLibrary.openSession')}
          </button>
        ) : null}
      </div>
      {run.outputs ? (
        <pre style={{ ...monoStyle, margin: 0, maxHeight: 240 }}>
          {JSON.stringify(run.outputs, null, 2)}
        </pre>
      ) : null}
      {run.error ? (
        <div
          style={{
            border: '1px solid rgba(220, 38, 38, 0.45)',
            background: 'rgba(220, 38, 38, 0.08)',
            borderRadius: 8,
            padding: 10,
            fontSize: 13,
            color: 'var(--z-fg-status, #dc2626)',
          }}
        >
          <strong>{run.error.code}</strong>: {run.error.message}
        </div>
      ) : null}
      {progressLogs.length > 0 ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--z-fg-muted)' }}>
            {t('ui.skillsLibrary.logsSectionTitle')}
          </summary>
          <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12 }}>
            {progressLogs.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {/* locale is unused for now but reserved for future per-locale duration */}
      <span hidden>{locale}</span>
    </div>
  );
}

function CopyApiDropdown({
  onCopy,
  activeMode,
  flash,
  t,
}: {
  onCopy: (mode: 'curl' | 'fetch' | 'ts' | 'py' | 'cli' | 'mcp') => void;
  activeMode: 'curl' | 'fetch' | 'ts' | 'py' | 'cli' | 'mcp' | null;
  flash: boolean;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" style={btnStyle} onClick={() => setOpen((v) => !v)}>
        {flash ? '✓ Copied' : t('ui.skillsLibrary.copyApi')}
        {activeMode ? ` (${activeMode})` : ''}
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            background: 'var(--z-bg-app)',
            border: '1px solid var(--z-section-border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            zIndex: 10,
            minWidth: 180,
            padding: 4,
          }}
        >
          {(
            [
              ['curl', 'cURL'],
              ['fetch', 'fetch (JS)'],
              ['ts', 'TypeScript SDK'],
              ['py', 'Python SDK'],
              ['cli', 'cepage CLI'],
              ['mcp', 'MCP config'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onCopy(k);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: 12,
                border: 'none',
                background: 'transparent',
                color: 'var(--z-fg)',
                cursor: 'pointer',
                borderRadius: 6,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const sectionTitle = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
} as const;

const dlStyle = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: 12,
  rowGap: 6,
  marginTop: 12,
  fontSize: 13,
} as const;
