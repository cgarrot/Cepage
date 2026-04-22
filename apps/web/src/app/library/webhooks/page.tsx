'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
  type WebhookRow,
} from '@cepage/client-api';
import { useI18n } from '@cepage/app-ui';
import {
  btnSolidStyle,
  btnStyle,
  headerStyle,
  pageStyle,
  sectionStyle,
  tagStyle,
} from '../lib';

const ALL_EVENTS: string[] = [
  '*',
  'skill-run.started',
  'skill-run.succeeded',
  'skill-run.failed',
  'skill-run.cancelled',
  'skill-run.progress',
  'webhook.ping',
];

export default function WebhooksPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listWebhooks();
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setRows(res.data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = useCallback(
    async (row: WebhookRow) => {
      const res = await updateWebhook(row.id, { active: !row.active });
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      await load();
    },
    [load],
  );

  const onDelete = useCallback(
    async (row: WebhookRow) => {
      if (!window.confirm(t('ui.webhooks.deleteConfirm', { url: row.url }))) {
        return;
      }
      const res = await deleteWebhook(row.id);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      await load();
    },
    [load, t],
  );

  const onRotate = useCallback(
    async (row: WebhookRow) => {
      if (!window.confirm(t('ui.webhooks.rotateConfirm', { url: row.url }))) {
        return;
      }
      const res = await updateWebhook(row.id, { secretAction: 'rotate' });
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      if (res.data.secret) {
        alert(t('ui.webhooks.secretRevealed', { secret: res.data.secret }));
      }
      await load();
    },
    [load, t],
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('ui.webhooks.title')}</h1>
          <p style={{ margin: 0, color: 'var(--z-fg-muted)', fontSize: 13, maxWidth: 640 }}>
            {t('ui.webhooks.subtitle')}
          </p>
        </div>
        <Link href="/library" style={btnStyle}>
          {t('ui.skillsLibrary.back')}
        </Link>
        <button
          type="button"
          style={btnSolidStyle}
          onClick={() => setCreateOpen(true)}
        >
          {t('ui.webhooks.newWebhook')}
        </button>
      </header>

      {createOpen ? (
        <CreateWebhookInline
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
        <p style={{ color: 'var(--z-fg-muted)' }}>{t('ui.webhooks.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <li key={row.id}>
              <article style={{ ...sectionStyle, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15 }}>{row.url}</strong>
                  <span
                    style={{
                      ...tagStyle,
                      color: row.active
                        ? 'var(--z-fg-status-success, #16a34a)'
                        : 'var(--z-fg-muted)',
                    }}
                  >
                    {row.active ? 'active' : 'inactive'}
                  </span>
                  {row.skillId ? <span style={tagStyle}>{row.skillId}</span> : null}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(row.events ?? []).map((ev) => (
                    <span key={ev} style={tagStyle}>
                      {ev}
                    </span>
                  ))}
                </div>
                {row.description ? (
                  <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{row.description}</div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={btnStyle} onClick={() => void onToggle(row)}>
                    {row.active ? t('ui.webhooks.deactivate') : t('ui.webhooks.activate')}
                  </button>
                  <button type="button" style={btnStyle} onClick={() => void onRotate(row)}>
                    {t('ui.webhooks.rotateSecret')}
                  </button>
                  <button type="button" style={btnStyle} onClick={() => void onDelete(row)}>
                    {t('ui.webhooks.delete')}
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type CreateInlineProps = {
  onCancel: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
};

function CreateWebhookInline({ onCancel, onCreated, onError }: CreateInlineProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['*']);
  const [busy, setBusy] = useState(false);

  const toggleEvent = useCallback((ev: string) => {
    setSelectedEvents((prev) => {
      if (ev === '*') {
        return prev.includes('*') ? [] : ['*'];
      }
      const withoutStar = prev.filter((e) => e !== '*');
      if (withoutStar.includes(ev)) {
        const next = withoutStar.filter((e) => e !== ev);
        return next.length === 0 ? ['*'] : next;
      }
      return [...withoutStar, ev];
    });
  }, []);

  const onSubmit = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true);
    const events = selectedEvents.includes('*') ? ['*'] : selectedEvents;
    const res = await createWebhook({
      url: url.trim(),
      events,
      description: description.trim() || undefined,
      active: true,
    });
    setBusy(false);
    if (!res.success) {
      onError(res.error.message);
      return;
    }
    if (res.data.secret) {
      alert(t('ui.webhooks.secretRevealed', { secret: res.data.secret }));
    }
    onCreated();
  }, [url, description, selectedEvents, onCreated, onError, t]);

  return (
    <section style={{ ...sectionStyle, display: 'grid', gap: 10, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t('ui.webhooks.newWebhook')}</h2>
      <label style={fieldLabelStyle}>
        {t('ui.webhooks.url')}
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={inputStyle}
          placeholder="https://example.com/webhook"
        />
      </label>
      <label style={fieldLabelStyle}>
        {t('ui.webhooks.description')}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle}
          placeholder={t('ui.webhooks.descriptionPlaceholder')}
        />
      </label>
      <div style={fieldLabelStyle}>
        {t('ui.webhooks.events')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          {ALL_EVENTS.map((ev) => (
            <label
              key={ev}
              style={{
                fontSize: 13,
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selectedEvents.includes(ev)}
                onChange={() => toggleEvent(ev)}
              />
              {ev}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={btnSolidStyle}
          onClick={() => void onSubmit()}
          disabled={!url.trim() || busy}
        >
          {busy ? t('ui.webhooks.creating') : t('ui.webhooks.create')}
        </button>
        <button type="button" style={btnStyle} onClick={onCancel}>
          {t('ui.webhooks.cancel')}
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
