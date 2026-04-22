'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  detectSkillInputs,
  saveSessionAsSkill,
  compileSkill,
  previewCompile,
  type DetectInputsResult,
  type UserSkillRow,
  type CompilationResult,
} from '@cepage/client-api';
import type { JsonSchema } from '@cepage/shared-core';
import { ParameterEditor } from './ParameterEditor.js';

// 3-step dialog that turns a live session into a reusable skill.
//
//   Step 1 — Identity: title, slug, summary, icon, category, tags
//   Step 2 — Inputs:   edit the auto-detected inputsSchema
//   Step 3 — Outputs:  edit the suggested outputsSchema + preview
//
// The Save button hits POST /api/v1/sessions/:id/save-as-skill which
// persists a UserSkill row — it then shows up in the Library and can be
// run from anywhere via the typed skill contract.

export type SaveAsSkillDialogProps = {
  open: boolean;
  sessionId: string | null;
  suggestedTitle?: string;
  onClose: () => void;
  onSaved: (skill: UserSkillRow) => void;
};

type Step = 'identity' | 'inputs' | 'outputs' | 'parameters';
type SaveMode = 'raw' | 'compile';

const CATEGORIES = [
  'Automation',
  'Content',
  'Data & Analytics',
  'Dev Tools',
  'Growth',
  'Messaging',
  'Operations',
  'Research',
  'Social',
  'Other',
];

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function pretty(schema: JsonSchema): string {
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return '{}';
  }
}

function safeParse(text: string): { ok: true; value: JsonSchema } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    return { ok: true, value: parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function SaveAsSkillDialog({
  open,
  sessionId,
  suggestedTitle,
  onClose,
  onSaved,
}: SaveAsSkillDialogProps) {
  const [saveMode, setSaveMode] = useState<SaveMode>('raw');
  const [step, setStep] = useState<Step>('identity');
  const [detection, setDetection] = useState<DetectInputsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(suggestedTitle ?? '');
  const [slug, setSlug] = useState('');
  const [summary, setSummary] = useState('');
  const [icon, setIcon] = useState('✨');
  const [category, setCategory] = useState<string>('Automation');
  const [tagsRaw, setTagsRaw] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'workspace' | 'public'>('private');

  const [inputsText, setInputsText] = useState('{}');
  const [outputsText, setOutputsText] = useState('{}');

  const [compilePreview, setCompilePreview] = useState<CompilationResult | null>(null);
  const [compileInputsSchema, setCompileInputsSchema] = useState<JsonSchema>({ type: 'object', properties: {} });
  const [compileError, setCompileError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCompileError(null);
    setStep('identity');
    setDetection(null);
    setBusy(false);
    setCompilePreview(null);

    if (saveMode === 'raw') {
      void (async () => {
        const res = await detectSkillInputs(sessionId);
        if (cancelled) return;
        setLoading(false);
        if (!res.success) {
          setError(res.error.message);
          return;
        }
        setDetection(res.data);
        setInputsText(pretty(res.data.inputsSchema));
        setOutputsText(pretty(res.data.outputsSchema));
        // Do not read `title` from the effect closure: apply suggested title only
        // if the user still has not typed anything (avoids race with slow network).
        if (suggestedTitle) {
          setTitle((t) => (t.trim() ? t : suggestedTitle));
        }
      })();
    } else {
      void (async () => {
        const res = await previewCompile(sessionId, 'opencode');
        if (cancelled) return;
        setLoading(false);
        if (!res.success) {
          setError(res.error.message);
          setCompileError(res.error.message);
          return;
        }
        setCompilePreview(res.data);
        setCompileInputsSchema(res.data.skill.inputsSchema ?? { type: 'object', properties: {} });
        setTitle((t) => (t.trim() ? t : (res.data.skill.title ?? suggestedTitle ?? '')));
        setSummary((s) => (s.trim() ? s : (res.data.skill.summary ?? '')));
        if (res.data.skill.icon) setIcon(res.data.skill.icon);
        if (res.data.skill.category) setCategory(res.data.skill.category);
        if (res.data.skill.tags?.length) setTagsRaw(res.data.skill.tags.join(', '));
        if (suggestedTitle) {
          setTitle((t) => (t.trim() ? t : suggestedTitle));
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, saveMode, suggestedTitle]);

  const derivedSlug = useMemo(() => (slug ? slugify(slug) : slugify(title)), [slug, title]);

  if (!open) return null;

  const parsedInputs = safeParse(inputsText);
  const parsedOutputs = safeParse(outputsText);
  const canSave =
    Boolean(title.trim()) &&
    Boolean(summary.trim()) &&
    Boolean(sessionId) &&
    (saveMode === 'raw'
      ? parsedInputs.ok && parsedOutputs.ok
      : compilePreview !== null);

  const onSave = async (): Promise<void> => {
    if (!sessionId || !canSave || busy) return;
    setBusy(true);
    setError(null);
    setCompileError(null);

    if (saveMode === 'raw') {
      const tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await saveSessionAsSkill(sessionId, {
        slug: derivedSlug,
        title: title.trim(),
        summary: summary.trim(),
        icon: icon.trim() || undefined,
        category,
        tags,
        inputsSchema: parsedInputs.ok ? parsedInputs.value : undefined,
        outputsSchema: parsedOutputs.ok ? parsedOutputs.value : undefined,
        visibility,
      });
      setBusy(false);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      onSaved(res.data);
    } else {
      const res = await compileSkill({
        sessionId,
        agentType: 'opencode',
        mode: 'publish',
      });
      setBusy(false);
      if (!res.success) {
        setError(res.error.message);
        setCompileError(res.error.message);
        return;
      }
      onSaved(res.data.skill as unknown as UserSkillRow);
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Save this workflow as a skill</h2>
          <button type="button" onClick={onClose} style={linkBtnStyle}>
            ✕
          </button>
        </header>
        <p style={{ margin: '6px 0 0', color: 'var(--z-fg-muted)', fontSize: 13 }}>
          Publish this session to your Library. You can run it again later, share a link, or call
          it from Cursor / Claude Code / Codex via MCP.
        </p>

        <div style={modeToggleRow}>
          {(
            [
              ['raw', 'Save as Skill'],
              ['compile', 'Compile with Parameters'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSaveMode(id);
                setStep('identity');
                setError(null);
                setCompileError(null);
              }}
              style={modeToggleStyle(saveMode === id)}
            >
              {label}
            </button>
          ))}
        </div>

        <nav style={tabsRow}>
          {(
            saveMode === 'raw'
              ? (
                [
                  ['identity', '1. Identity'],
                  ['inputs', '2. Inputs'],
                  ['outputs', '3. Outputs'],
                ] as const
              )
              : (
                [
                  ['identity', '1. Identity'],
                  ['parameters', '2. Parameters'],
                ] as const
              )
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStep(id)}
              style={tabStyle(step === id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div style={bodyStyle}>
          {loading ? (
            <p style={{ padding: 20, color: 'var(--z-fg-muted)' }}>
              {saveMode === 'compile' ? 'Compiling preview…' : 'Inspecting session…'}
            </p>
          ) : error && !compileError ? (
            <p style={{ padding: 20, color: 'var(--z-fg-status)' }}>{error}</p>
          ) : step === 'identity' ? (
            <IdentityStep
              title={title}
              setTitle={setTitle}
              slug={derivedSlug}
              setSlug={setSlug}
              summary={summary}
              setSummary={setSummary}
              icon={icon}
              setIcon={setIcon}
              category={category}
              setCategory={setCategory}
              tagsRaw={tagsRaw}
              setTagsRaw={setTagsRaw}
              visibility={visibility}
              setVisibility={setVisibility}
            />
          ) : step === 'inputs' ? (
            <SchemaStep
              label="Inputs JSON Schema"
              value={inputsText}
              onChange={setInputsText}
              parsed={parsedInputs}
              hint={
                detection?.detected.length
                  ? `Detected ${detection.detected.length} placeholder(s) from the session: ${detection.detected
                      .map((d) => `{{${d.name}}}`)
                      .join(', ')}`
                  : 'No {{variables}} detected in session text. You can still define inputs manually.'
              }
            />
          ) : step === 'outputs' ? (
            <SchemaStep
              label="Outputs JSON Schema"
              value={outputsText}
              onChange={setOutputsText}
              parsed={parsedOutputs}
              hint="Defaults wrap the session scaffold result (sessionId, mode, workspaceDir). Adjust to expose any other structured data your workflow produces."
            />
          ) : (
            <CompileParametersStep
              preview={compilePreview}
              schema={compileInputsSchema}
              onSchemaChange={setCompileInputsSchema}
            />
          )}
        </div>

        <footer style={footerStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {error ? (
              <span style={{ color: 'var(--z-fg-status)', fontSize: 12 }}>{error}</span>
            ) : (
              <span style={{ color: 'var(--z-fg-muted)', fontSize: 12 }}>
                Slug: <code>{derivedSlug || '—'}</code>
              </span>
            )}
            {compileError ? (
              <button
                type="button"
                onClick={() => {
                  setSaveMode('raw');
                  setCompileError(null);
                  setError(null);
                  setStep('identity');
                  setInputsText(pretty(compileInputsSchema));
                  if (compilePreview?.skill.outputsSchema) {
                    setOutputsText(pretty(compilePreview.skill.outputsSchema));
                  }
                }}
                style={fallbackBtnStyle}
              >
                Save without compilation
              </button>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step !== 'identity' ? (
              <button type="button" onClick={() => setStep('identity')} style={secondaryBtnStyle}>
                ← Back
              </button>
            ) : null}
            {saveMode === 'raw' ? (
              step !== 'outputs' ? (
                <button
                  type="button"
                  onClick={() => setStep(step === 'identity' ? 'inputs' : 'outputs')}
                  style={primaryBtnStyle}
                  disabled={!title.trim() || !summary.trim()}
                >
                  Next →
                </button>
              ) : (
                <button type="button" onClick={onSave} style={primaryBtnStyle} disabled={!canSave || busy}>
                  {busy ? 'Saving…' : 'Save skill'}
                </button>
              )
            ) : (
              step !== 'parameters' ? (
                <button
                  type="button"
                  onClick={() => setStep('parameters')}
                  style={primaryBtnStyle}
                  disabled={!title.trim() || !summary.trim()}
                >
                  Next →
                </button>
              ) : (
                <button type="button" onClick={onSave} style={primaryBtnStyle} disabled={!canSave || busy}>
                  {busy ? 'Saving…' : 'Compile & save'}
                </button>
              )
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function IdentityStep(props: {
  title: string;
  setTitle: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  summary: string;
  setSummary: (v: string) => void;
  icon: string;
  setIcon: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  tagsRaw: string;
  setTagsRaw: (v: string) => void;
  visibility: 'private' | 'workspace' | 'public';
  setVisibility: (v: 'private' | 'workspace' | 'public') => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10 }}>
        <Field label="Icon">
          <input value={props.icon} onChange={(e) => props.setIcon(e.target.value)} style={inputStyle} maxLength={4} />
        </Field>
        <Field label="Title">
          <input
            value={props.title}
            onChange={(e) => props.setTitle(e.target.value)}
            style={inputStyle}
            placeholder="Weekly Stripe digest"
          />
        </Field>
      </div>
      <Field label="Slug (URL-safe identifier, auto-generated)">
        <input
          value={props.slug}
          onChange={(e) => props.setSlug(e.target.value)}
          style={inputStyle}
          placeholder="weekly-stripe-digest"
        />
      </Field>
      <Field label="Summary">
        <textarea
          value={props.summary}
          onChange={(e) => props.setSummary(e.target.value)}
          rows={3}
          style={textareaStyle}
          placeholder="Generate a digest of last week's Stripe activity and post it to Slack."
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Category">
          <select value={props.category} onChange={(e) => props.setCategory(e.target.value)} style={inputStyle}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Visibility">
          <select
            value={props.visibility}
            onChange={(e) => props.setVisibility(e.target.value as 'private' | 'workspace' | 'public')}
            style={inputStyle}
          >
            <option value="private">Private (only me)</option>
            <option value="workspace">Workspace</option>
            <option value="public">Public</option>
          </select>
        </Field>
      </div>
      <Field label="Tags (comma-separated)">
        <input
          value={props.tagsRaw}
          onChange={(e) => props.setTagsRaw(e.target.value)}
          style={inputStyle}
          placeholder="stripe, slack, digest"
        />
      </Field>
    </div>
  );
}

function SchemaStep(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  parsed: { ok: true; value: JsonSchema } | { ok: false; error: string };
  hint: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 260 }}>
      <div>
        <label style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{props.label}</label>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--z-fg-muted)' }}>{props.hint}</p>
      </div>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          ...textareaStyle,
          fontFamily: 'var(--z-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          fontSize: 12,
          minHeight: 260,
          resize: 'vertical',
          borderColor: props.parsed.ok ? 'var(--z-border-input)' : 'var(--z-fg-status, #d95a5a)',
        }}
        spellCheck={false}
      />
      {!props.parsed.ok ? (
        <span style={{ color: 'var(--z-fg-status)', fontSize: 12 }}>Invalid JSON: {props.parsed.error}</span>
      ) : null}
    </div>
  );
}

function CompileParametersStep(props: {
  preview: CompilationResult | null;
  schema: JsonSchema;
  onSchemaChange: (schema: JsonSchema) => void;
}) {
  if (!props.preview) {
    return (
      <p style={{ padding: 20, color: 'var(--z-fg-muted)' }}>
        No compilation preview available.
      </p>
    );
  }

  const { report } = props.preview;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>Compilation Preview</h4>
        <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
          <p style={{ margin: '4px 0' }}>
            Detected {report.parameters.length} parameter(s) • {report.graphStats.nodes} nodes,{' '}
            {report.graphStats.edges} edges • Estimated cost: {report.estimatedCost}
          </p>
          {report.warnings.length > 0 ? (
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              {report.warnings.map((w) => (
                <span key={w} style={{ color: 'var(--z-fg-warn, #d97706)' }}>
                  {w}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Parameters</h4>
        <ParameterEditor schema={props.schema} onChange={props.onSchemaChange} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1300,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.55)',
};

const modalStyle: CSSProperties = {
  width: 'min(720px, 94vw)',
  maxHeight: '88vh',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: 'auto auto auto 1fr auto',
  gap: 12,
  padding: 20,
  background:
    'linear-gradient(180deg, var(--z-dialog-gradient-top) 0%, var(--z-dialog-gradient-bot) 100%)',
  color: 'var(--z-fg)',
  border: '1px solid var(--z-dialog-border)',
  borderRadius: 14,
  boxShadow: 'var(--z-dialog-shadow)',
};

const bodyStyle: CSSProperties = { minHeight: 0, overflow: 'auto', padding: '4px 2px' };

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingTop: 8,
  borderTop: '1px solid var(--z-section-border)',
};

const tabsRow: CSSProperties = { display: 'flex', gap: 6, paddingBottom: 4 };

const tabStyle = (active: boolean): CSSProperties => ({
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-section-border)',
  background: active ? 'var(--z-accent-subtle, rgba(90,140,255,0.15))' : 'transparent',
  color: active ? 'var(--z-accent, #5a8cff)' : 'var(--z-fg)',
  fontSize: 13,
  cursor: 'pointer',
});

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
};

const primaryBtnStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--z-accent, #5a8cff)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--z-section-border)',
  background: 'transparent',
  color: 'var(--z-fg)',
  fontSize: 13,
  cursor: 'pointer',
};

const linkBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--z-fg-muted)',
  fontSize: 14,
  cursor: 'pointer',
};

const modeToggleRow: CSSProperties = {
  display: 'flex',
  gap: 6,
  paddingBottom: 4,
};

const modeToggleStyle = (active: boolean): CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--z-section-border)',
  background: active ? 'var(--z-accent-subtle, rgba(90,140,255,0.15))' : 'transparent',
  color: active ? 'var(--z-accent, #5a8cff)' : 'var(--z-fg)',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
});

const fallbackBtnStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-fg-status, #d95a5a)',
  background: 'transparent',
  color: 'var(--z-fg-status, #d95a5a)',
  fontSize: 12,
  cursor: 'pointer',
  width: 'fit-content',
};
