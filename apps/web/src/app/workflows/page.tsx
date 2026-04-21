'use client';

import {
  deleteArchivedSession,
  duplicateSession,
  exportWorkflow,
  listSessions,
  patchSessionStatus,
  type SessionLibraryRow,
} from '@cepage/client-api';
import { NewSessionFromSkillDialog, useI18n } from '@cepage/app-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

function downloadJson(name: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function workflowFileName(sessionId: string): string {
  return `workflow-${sessionId}.json`;
}

export default function WorkflowsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [rows, setRows] = useState<SessionLibraryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await listSessions({
      status: filter,
      q: debouncedQ.trim() || undefined,
    });
    setLoading(false);
    if (!res.success) {
      setErr(res.error.message);
      return;
    }
    setRows(res.data.items);
    setTotal(res.data.total);
  }, [filter, debouncedQ]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  const onExport = async (id: string) => {
    setBusy(`ex:${id}`);
    setActionErr(null);
    const res = await exportWorkflow(id);
    setBusy(null);
    if (!res.success) {
      setActionErr(t('ui.library.actionError', { message: res.error.message }));
      return;
    }
    downloadJson(workflowFileName(id), res.data);
  };

  const onDuplicate = async (id: string) => {
    const raw = window.prompt(t('ui.library.duplicatePrompt'));
    if (raw === null) return;
    const name = raw.trim();
    setBusy(`dup:${id}`);
    setActionErr(null);
    const res = await duplicateSession(id, name || undefined);
    setBusy(null);
    if (!res.success) {
      setActionErr(t('ui.library.actionError', { message: res.error.message }));
      return;
    }
    void load();
  };

  const onArchive = async (id: string) => {
    setBusy(`ar:${id}`);
    setActionErr(null);
    const res = await patchSessionStatus(id, 'archived');
    setBusy(null);
    if (!res.success) {
      setActionErr(t('ui.library.actionError', { message: res.error.message }));
      return;
    }
    void load();
  };

  const onRestore = async (id: string) => {
    setBusy(`rs:${id}`);
    setActionErr(null);
    const res = await patchSessionStatus(id, 'active');
    setBusy(null);
    if (!res.success) {
      setActionErr(t('ui.library.actionError', { message: res.error.message }));
      return;
    }
    void load();
  };

  const onDelete = async (id: string) => {
    if (!window.confirm(t('ui.library.deleteConfirm'))) return;
    setBusy(`del:${id}`);
    setActionErr(null);
    const res = await deleteArchivedSession(id);
    setBusy(null);
    if (!res.success) {
      setActionErr(t('ui.library.actionError', { message: res.error.message }));
      return;
    }
    void load();
  };

  const btnStyle: CSSProperties = {
    marginRight: 8,
    marginBottom: 4,
    padding: '6px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--z-btn-ghost-border)',
    background: 'var(--z-btn-ghost-bg)',
    color: 'var(--z-btn-ghost-fg)',
    cursor: 'pointer',
  };

  const tabBtn = (active: boolean): CSSProperties => ({
    ...btnStyle,
    borderColor: active ? 'var(--z-btn-solid-border)' : 'var(--z-btn-ghost-border)',
    background: active ? 'var(--z-btn-solid-bg)' : 'var(--z-btn-ghost-bg)',
    color: active ? 'var(--z-btn-solid-fg)' : 'var(--z-btn-ghost-fg)',
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--z-bg-app)',
        color: 'var(--z-fg)',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0, flex: '1 1 auto' }}>{t('ui.library.title')}</h1>
        <button
          type="button"
          style={{
            ...btnStyle,
            borderColor: 'var(--z-btn-solid-border)',
            background: 'var(--z-btn-solid-bg)',
            color: 'var(--z-btn-solid-fg)',
          }}
          onClick={() => setPickerOpen(true)}
        >
          {t('ui.library.newFromSkill')}
        </button>
        <Link
          href="/"
          style={{
            ...btnStyle,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          {t('ui.library.backCanvas')}
        </Link>
      </header>

      <NewSessionFromSkillDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCreated={(result) => {
          setPickerOpen(false);
          router.push(`/?session=${encodeURIComponent(result.sessionId)}`);
        }}
      />

      <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <button type="button" style={tabBtn(filter === 'active')} onClick={() => setFilter('active')}>
          {t('ui.library.tabActive')}
        </button>
        <button type="button" style={tabBtn(filter === 'archived')} onClick={() => setFilter('archived')}>
          {t('ui.library.tabArchived')}
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ui.library.searchPlaceholder')}
          style={{
            flex: '1 1 220px',
            minWidth: 180,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--z-border-input)',
            background: 'var(--z-input-bg)',
            color: 'var(--z-fg)',
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--z-fg-muted)' }}>
          {t('ui.library.total', { count: String(total) })}
        </span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--z-fg-muted)' }}>…</p>
      ) : err ? (
        <p style={{ color: 'var(--z-fg-status)' }}>{t('ui.library.loadError')}: {err}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--z-fg-muted)' }}>{t('ui.library.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((row) => (
            <li
              key={row.id}
              style={{
                border: '1px solid var(--z-section-border)',
                background: 'var(--z-section-bg)',
                borderRadius: 10,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ fontSize: 15 }}>{row.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{row.id.slice(0, 8)}…</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--z-fg-section)', marginTop: 6 }}>
                {t('ui.library.updated')}: {fmt(row.updatedAt)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--z-fg-muted)', marginTop: 4 }}>
                {t('ui.library.workspace')}:{' '}
                {row.workspace?.workingDirectory ?? t('ui.library.noWorkspace')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--z-fg-muted)', marginTop: 4 }}>
                {t('ui.library.counts', {
                  nodes: String(row.counts.nodes),
                  edges: String(row.counts.edges),
                  runs: String(row.counts.agentRuns),
                })}
              </div>
              <div style={{ marginTop: 12 }}>
                <Link
                  href={`/?session=${encodeURIComponent(row.id)}`}
                  style={{ ...btnStyle, textDecoration: 'none', display: 'inline-block' }}
                >
                  {t('ui.library.open')}
                </Link>
                <button
                  type="button"
                  style={btnStyle}
                  disabled={busy !== null}
                  onClick={() => void onExport(row.id)}
                >
                  {busy === `ex:${row.id}` ? t('ui.library.busyExport') : t('ui.library.export')}
                </button>
                <button
                  type="button"
                  style={btnStyle}
                  disabled={busy !== null}
                  onClick={() => void onDuplicate(row.id)}
                >
                  {t('ui.library.duplicate')}
                </button>
                {filter === 'active' ? (
                  <button
                    type="button"
                    style={btnStyle}
                    disabled={busy !== null}
                    onClick={() => void onArchive(row.id)}
                  >
                    {t('ui.library.archive')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      style={btnStyle}
                      disabled={busy !== null}
                      onClick={() => void onRestore(row.id)}
                    >
                      {t('ui.library.restore')}
                    </button>
                    <button
                      type="button"
                      style={btnStyle}
                      disabled={busy !== null}
                      onClick={() => void onDelete(row.id)}
                    >
                      {t('ui.library.delete')}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {actionErr ? (
        <p style={{ marginTop: 16, color: 'var(--z-fg-status)' }}>{actionErr}</p>
      ) : null}
    </div>
  );
}
