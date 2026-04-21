'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getWorkspaceFileMeta,
  getWorkspaceFileUrl,
  type WorkspaceFileMeta,
} from '@cepage/client-api';
import {
  Badge,
  Button,
  IconAlertTriangle,
  IconButton,
  IconClock,
  IconCopy,
  IconDownload,
  IconExternal,
  IconFile,
  IconImage,
  IconMusic,
  IconRefresh,
  IconVideo,
  Spinner,
  Surface,
  Tooltip,
} from '@cepage/ui-kit';
import { copyTextToClipboard, findWorkspaceFileEntry, useWorkspaceStore } from '@cepage/state';
import type { WorkspaceFileEntry, WorkspaceFileTab } from '@cepage/state';
import { useI18n } from '../I18nProvider';
import { MarkdownBody } from '../MarkdownBody';
import { toRawGraphNodes } from './types';

type FileViewerProps = {
  tab: WorkspaceFileTab;
  onRevealInStudio?: () => void;
};

const MAX_INLINE_TEXT_BYTES = 1_000_000;

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; meta?: WorkspaceFileMeta }
  | { kind: 'ready'; meta: WorkspaceFileMeta; text: string | null }
  | { kind: 'error'; message: string; code?: string; meta?: WorkspaceFileMeta };

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}
function isVideo(mime: string): boolean {
  return mime.startsWith('video/');
}
function isAudio(mime: string): boolean {
  return mime.startsWith('audio/');
}
function isPdf(mime: string): boolean {
  return mime === 'application/pdf';
}
function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Multi-format viewer used by the workspace tabs in the main chat area.
 *
 * Loads `/sessions/:id/workspace/file/meta` to determine the MIME, then
 * either renders the binary directly (images, video, audio, PDF) or fetches
 * the text body and pretty-prints it (markdown, code, plain text).
 */
export function FileViewer({ tab, onRevealInStudio }: FileViewerProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [reloadTick, setReloadTick] = useState(0);
  const storeNodes = useWorkspaceStore((s) => s.nodes);
  const entry = useMemo<WorkspaceFileEntry | null>(
    () => findWorkspaceFileEntry(toRawGraphNodes(storeNodes), tab.path),
    [storeNodes, tab.path],
  );
  const isPendingArtifact = entry?.status === 'declared' || entry?.status === 'missing';

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    void (async () => {
      const metaRes = await getWorkspaceFileMeta(tab.sessionId, tab.path);
      if (cancelled) return;
      if (!metaRes.success) {
        setStatus({
          kind: 'error',
          message: metaRes.error.message,
          code: metaRes.error.message,
        });
        return;
      }
      const meta = metaRes.data;
      if (!meta.isText || meta.size > MAX_INLINE_TEXT_BYTES) {
        setStatus({ kind: 'ready', meta, text: null });
        return;
      }
      setStatus({ kind: 'loading', meta });
      try {
        const url = getWorkspaceFileUrl(tab.sessionId, tab.path);
        const res = await fetch(url, { credentials: 'include' });
        if (cancelled) return;
        if (!res.ok) {
          setStatus({
            kind: 'error',
            message: `${res.status} ${res.statusText || 'Request failed'}`,
            meta,
          });
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        setStatus({ kind: 'ready', meta, text });
      } catch (errorValue) {
        if (cancelled) return;
        const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
        setStatus({ kind: 'error', message, meta });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.sessionId, tab.path, reloadTick]);

  const onRefresh = () => setReloadTick((value) => value + 1);
  const onCopy = () => void copyTextToClipboard(tab.path);

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div style={titleColumnStyle}>
          <div style={titleStyle}>
            <FileTypeIcon meta={status.kind === 'ready' || status.kind === 'loading' ? status.meta : undefined} path={tab.path} />
            <strong style={{ fontSize: 14 }}>{tab.title}</strong>
            {status.kind === 'ready' || status.kind === 'loading' ? (
              status.meta ? (
                <Badge tone="neutral" outline>
                  {status.meta.mime}
                </Badge>
              ) : null
            ) : null}
            {status.kind === 'ready' && status.meta ? (
              <Badge tone="info" outline>
                {formatBytes(status.meta.size)}
              </Badge>
            ) : null}
          </div>
          <code style={pathStyle} title={tab.path}>
            {tab.path}
          </code>
        </div>
        <div style={actionsStyle}>
          <Tooltip label={t('ui.simple.resultCopyPath')}>
            <IconButton size={28} label={t('ui.simple.resultCopyPath')} onClick={onCopy}>
              <IconCopy size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t('ui.viewer.refresh')}>
            <IconButton size={28} label={t('ui.viewer.refresh')} onClick={onRefresh}>
              <IconRefresh size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t('ui.viewer.download')}>
            <a
              href={getWorkspaceFileUrl(tab.sessionId, tab.path, { download: true })}
              download={tab.title}
              style={downloadLinkStyle}
              aria-label={t('ui.viewer.download')}
            >
              <IconDownload size={14} />
            </a>
          </Tooltip>
          {onRevealInStudio ? (
            <Tooltip label={t('ui.simple.resultOpenStudio')}>
              <IconButton
                size={28}
                label={t('ui.simple.resultOpenStudio')}
                onClick={onRevealInStudio}
              >
                <IconExternal size={14} />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <div style={bodyStyle}>
        <ViewerBody
          status={status}
          tab={tab}
          entry={entry}
          isPendingArtifact={isPendingArtifact}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

function FileTypeIcon({ meta, path }: { meta?: WorkspaceFileMeta; path: string }) {
  const mime = meta?.mime ?? '';
  if (isImage(mime)) return <IconImage size={14} color="var(--z-fg-muted)" />;
  if (isVideo(mime)) return <IconVideo size={14} color="var(--z-fg-muted)" />;
  if (isAudio(mime)) return <IconMusic size={14} color="var(--z-fg-muted)" />;
  if (isMarkdown(path)) return <IconFile size={14} color="var(--z-fg-muted)" />;
  return <IconFile size={14} color="var(--z-fg-muted)" />;
}

type ViewerBodyProps = {
  status: Status;
  tab: WorkspaceFileTab;
  entry: WorkspaceFileEntry | null;
  isPendingArtifact: boolean;
  onRefresh: () => void;
};

function ViewerBody({ status, tab, entry, isPendingArtifact, onRefresh }: ViewerBodyProps) {
  const { t } = useI18n();
  if (status.kind === 'idle' || status.kind === 'loading') {
    return (
      <div style={centeredStyle}>
        <Spinner size={18} />
        <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{t('ui.viewer.loading')}</span>
      </div>
    );
  }

  if (status.kind === 'error') {
    const isMissing =
      isPendingArtifact ||
      status.code === 'WORKSPACE_FILE_NOT_FOUND' ||
      status.message === 'WORKSPACE_FILE_NOT_FOUND';
    if (isMissing) {
      return (
        <Surface variant="card" tone="default" padding={16} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconClock size={16} color="var(--z-fg-muted)" />
            <strong>{t('ui.viewer.pendingTitle')}</strong>
          </div>
          <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
            {t('ui.viewer.pendingHint')}
          </div>
          {entry?.summary ? (
            <div style={{ fontSize: 12 }}>{entry.summary}</div>
          ) : null}
          <div>
            <Button size="sm" variant="secondary" onClick={onRefresh}>
              <IconRefresh size={12} /> {t('ui.viewer.retry')}
            </Button>
          </div>
        </Surface>
      );
    }
    return (
      <Surface variant="card" tone="danger" padding={16} style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IconAlertTriangle size={16} color="var(--z-fg)" />
          <strong>{t('ui.viewer.errorTitle')}</strong>
        </div>
        <div style={{ fontSize: 12 }}>{status.message}</div>
        <div>
          <Button size="sm" variant="secondary" onClick={onRefresh}>
            <IconRefresh size={12} /> {t('ui.viewer.retry')}
          </Button>
        </div>
      </Surface>
    );
  }

  const { meta, text } = status;
  const url = getWorkspaceFileUrl(tab.sessionId, tab.path);

  if (isImage(meta.mime)) {
    return (
      <div style={mediaWrapperStyle}>
        <img
          src={url}
          alt={tab.title}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>
    );
  }

  if (isVideo(meta.mime)) {
    return (
      <div style={mediaWrapperStyle}>
        <video src={url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
      </div>
    );
  }

  if (isAudio(meta.mime)) {
    return (
      <div style={{ ...mediaWrapperStyle, alignItems: 'center' }}>
        <audio src={url} controls style={{ width: '100%' }} />
      </div>
    );
  }

  if (isPdf(meta.mime)) {
    return (
      <iframe
        src={url}
        title={tab.title}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'var(--z-bg-app)',
        }}
      />
    );
  }

  if (text == null) {
    return (
      <Surface variant="card" tone="default" padding={16} style={{ display: 'grid', gap: 8 }}>
        <div>{t('ui.viewer.binary')}</div>
        <div style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>
          {t('ui.viewer.binaryHint', { size: formatBytes(meta.size) })}
        </div>
        <div>
          <a
            href={getWorkspaceFileUrl(tab.sessionId, tab.path, { download: true })}
            download={tab.title}
            style={downloadButtonStyle}
          >
            <IconDownload size={12} /> {t('ui.viewer.download')}
          </a>
        </div>
      </Surface>
    );
  }

  if (isMarkdown(tab.path)) {
    return (
      <div style={markdownWrapperStyle}>
        <MarkdownBody content={text} />
      </div>
    );
  }

  return <pre style={codeStyle}>{text}</pre>;
}

const containerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  flex: 1,
  minHeight: 0,
  background: 'var(--z-bg-app)',
} as const;

const headerStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--z-border)',
  background: 'var(--z-bg-sidebar)',
} as const;

const titleColumnStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
  minWidth: 0,
  flex: 1,
} as const;

const titleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap' as const,
  minWidth: 0,
} as const;

const pathStyle = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: 'block',
} as const;

const actionsStyle = {
  display: 'inline-flex',
  gap: 6,
  alignItems: 'center',
  flexShrink: 0,
} as const;

const downloadLinkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid var(--z-border)',
  color: 'var(--z-fg)',
  background: 'transparent',
  textDecoration: 'none',
} as const;

const bodyStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column' as const,
} as const;

const centeredStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
} as const;

const mediaWrapperStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  minHeight: 0,
  width: '100%',
} as const;

const markdownWrapperStyle = {
  flex: 1,
  minHeight: 0,
  background: 'var(--z-node-textarea-bg)',
  borderRadius: 12,
  padding: 16,
  overflow: 'auto',
} as const;

const codeStyle = {
  margin: 0,
  padding: 12,
  background: 'var(--z-node-textarea-bg)',
  borderRadius: 12,
  color: 'var(--z-fg)',
  overflow: 'auto',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
} as const;

const downloadButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--z-border)',
  color: 'var(--z-fg)',
  background: 'transparent',
  textDecoration: 'none',
  fontSize: 12,
} as const;
