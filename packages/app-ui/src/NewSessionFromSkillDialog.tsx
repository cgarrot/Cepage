'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  createSessionFromSkill,
  getWorkflowSkills,
  type SessionFromSkillResult,
} from '@cepage/client-api';
import type { WorkflowSkill, WorkflowSkillKind } from '@cepage/shared-core';
import { useI18n } from './I18nProvider';

type Filter = 'all' | WorkflowSkillKind;

type NewSessionFromSkillDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (result: SessionFromSkillResult) => void;
};

export function NewSessionFromSkillDialog({ open, onClose, onCreated }: NewSessionFromSkillDialogProps) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<WorkflowSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('workflow_template');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(true);
  const [autoRun, setAutoRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    void (async () => {
      const res = await getWorkflowSkills();
      if (cancelled) return;
      setLoading(false);
      if (!res.success) {
        setLoadErr(res.error.message);
        return;
      }
      const list = res.data.skills.filter((s) => !s.deprecated);
      setSkills(list);
      if (list.length > 0 && !selectedId) {
        const first = list.find((s) => s.kind === 'workflow_template') ?? list[0]!;
        setSelectedId(first.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedId]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (filter !== 'all' && s.kind !== filter) return false;
      if (!q) return true;
      const haystack = `${s.id} ${s.title} ${s.summary} ${s.tags.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [skills, filter, search]);

  const selected = useMemo(
    () => visible.find((s) => s.id === selectedId) ?? null,
    [visible, selectedId],
  );

  if (!open) return null;

  const onSubmit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setSubmitErr(null);
    const res = await createSessionFromSkill(selected.id, {
      copilot: {
        autoApply,
        autoRun,
      },
    });
    setBusy(false);
    if (!res.success) {
      setSubmitErr(res.error.message);
      return;
    }
    onCreated(res.data);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 92vw)',
          maxHeight: '88vh',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'auto auto 1fr auto',
          gap: 12,
          padding: 20,
          background: 'var(--z-section-bg)',
          color: 'var(--z-fg)',
          border: '1px solid var(--z-section-border)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('ui.skillPicker.title')}</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--z-fg-muted)', fontSize: 13 }}>
            {t('ui.skillPicker.desc')}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('ui.skillPicker.searchPlaceholder')}
            style={{
              flex: '1 1 240px',
              minWidth: 200,
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid var(--z-border-input)',
              background: 'var(--z-input-bg)',
              color: 'var(--z-fg)',
            }}
          />
          {(
            [
              ['all', t('ui.skillPicker.filterAll')],
              ['workflow_template', t('ui.skillPicker.filterTemplate')],
              ['operator_playbook', t('ui.skillPicker.filterPlaybook')],
              ['context_doc', t('ui.skillPicker.filterContext')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id as Filter)}
              style={chipStyle(filter === id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1.2fr)',
            gap: 12,
            minHeight: 0,
          }}
        >
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              overflowY: 'auto',
              border: '1px solid var(--z-section-border)',
              borderRadius: 10,
              background: 'var(--z-bg-app)',
            }}
          >
            {loading ? (
              <li style={{ padding: 14, color: 'var(--z-fg-muted)' }}>…</li>
            ) : loadErr ? (
              <li style={{ padding: 14, color: 'var(--z-fg-status)' }}>{loadErr}</li>
            ) : visible.length === 0 ? (
              <li style={{ padding: 14, color: 'var(--z-fg-muted)' }}>{t('ui.skillPicker.empty')}</li>
            ) : (
              visible.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    style={skillRowStyle(s.id === selectedId)}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--z-fg-muted)' }}>{s.kind}</span>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: 'var(--z-fg-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {s.summary}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div
            style={{
              padding: 14,
              border: '1px solid var(--z-section-border)',
              borderRadius: 10,
              overflowY: 'auto',
              background: 'var(--z-bg-app)',
            }}
          >
            {selected ? (
              <SkillDetail skill={selected} />
            ) : (
              <p style={{ color: 'var(--z-fg-muted)', margin: 0 }}>—</p>
            )}
            <hr style={{ border: 'none', borderTop: '1px solid var(--z-section-border)', margin: '14px 0' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
              />
              {t('ui.skillPicker.autoApply')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
                disabled={!autoApply}
              />
              {t('ui.skillPicker.autoRun')}
            </label>
            {submitErr ? (
              <p style={{ color: 'var(--z-fg-status)', fontSize: 12, marginTop: 12 }}>
                {t('ui.skillPicker.error', { message: submitErr })}
              </p>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={ghostButtonStyle()} disabled={busy}>
            {t('ui.skillPicker.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            style={solidButtonStyle()}
            disabled={!selected || busy}
          >
            {busy ? t('ui.skillPicker.busy') : t('ui.skillPicker.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillDetail({ skill }: { skill: WorkflowSkill }) {
  return (
    <div>
      <h3 style={{ margin: 0, fontSize: 15 }}>{skill.title}</h3>
      <div style={{ fontSize: 11, color: 'var(--z-fg-muted)', marginTop: 4 }}>
        {skill.id} · {skill.kind}
        {skill.version ? ` · v${skill.version}` : ''}
      </div>
      <p style={{ fontSize: 13, color: 'var(--z-fg-section)', marginTop: 10 }}>{skill.summary}</p>
      {skill.tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {skill.tags.slice(0, 12).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 999,
                background: 'var(--z-btn-ghost-bg)',
                color: 'var(--z-fg-muted)',
                border: '1px solid var(--z-btn-ghost-border)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {skill.expectedWorkflow?.phases?.length ? (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--z-fg-muted)' }}>
          phases: {skill.expectedWorkflow.phases.join(' → ')}
        </div>
      ) : null}
    </div>
  );
}

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 10px',
    borderRadius: 999,
    fontSize: 12,
    border: `1px solid ${active ? 'var(--z-btn-solid-border)' : 'var(--z-btn-ghost-border)'}`,
    background: active ? 'var(--z-btn-solid-bg)' : 'var(--z-btn-ghost-bg)',
    color: active ? 'var(--z-btn-solid-fg)' : 'var(--z-btn-ghost-fg)',
    cursor: 'pointer',
  };
}

function skillRowStyle(active: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    border: 'none',
    borderBottom: '1px solid var(--z-section-border)',
    background: active ? 'var(--z-btn-solid-bg)' : 'transparent',
    color: active ? 'var(--z-btn-solid-fg)' : 'var(--z-fg)',
    cursor: 'pointer',
  };
}

function solidButtonStyle(): CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 10,
    fontWeight: 600,
    border: '1px solid var(--z-btn-solid-border)',
    background: 'var(--z-btn-solid-bg)',
    color: 'var(--z-btn-solid-fg)',
    cursor: 'pointer',
  };
}

function ghostButtonStyle(): CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 10,
    fontWeight: 600,
    border: '1px solid var(--z-btn-ghost-border)',
    background: 'var(--z-btn-ghost-bg)',
    color: 'var(--z-btn-ghost-fg)',
    cursor: 'pointer',
  };
}
