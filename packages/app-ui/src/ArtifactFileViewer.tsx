'use client';

import { type RunArtifactFileSnapshot, type RunArtifactsBundle } from '@cepage/shared-core';
import { useI18n } from './I18nProvider';
import { MarkdownBody } from './MarkdownBody';

export type ArtifactFileView = {
  path: string;
  change: RunArtifactsBundle['files'][number] | null;
  current: RunArtifactFileSnapshot;
};

type ArtifactFileViewerProps = {
  file: ArtifactFileView;
  markdown?: boolean;
};

export function ArtifactFileViewer({
  file,
  markdown = false,
}: ArtifactFileViewerProps) {
  const { t } = useI18n();
  const change = file.change;
  return (
    <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--z-fg)' }}>{file.path}</div>
      {change?.before ? <SnapshotBlock title={t('ui.sidebar.fileBefore')} snapshot={change.before} markdown={markdown} /> : null}
      <SnapshotBlock
        title={change?.kind === 'deleted' ? t('ui.sidebar.fileDeleted') : t('ui.sidebar.fileAfter')}
        snapshot={file.current}
        markdown={markdown}
      />
    </div>
  );
}

function SnapshotBlock({
  title,
  snapshot,
  markdown,
}: {
  title: string;
  snapshot: RunArtifactFileSnapshot;
  markdown: boolean;
}) {
  const { t } = useI18n();
  if (snapshot.kind === 'missing') {
    return (
      <div style={blockStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={emptyStyle}>{t('ui.sidebar.fileDeleted')}</div>
      </div>
    );
  }
  if (snapshot.kind === 'binary') {
    return (
      <div style={blockStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={emptyStyle}>{t('ui.sidebar.binaryFile')}</div>
      </div>
    );
  }
  return (
    <div style={blockStyle}>
      <div style={titleStyle}>
        {title}
        {snapshot.truncated ? <span style={{ opacity: 0.65 }}> ({t('ui.sidebar.truncated')})</span> : null}
      </div>
      {markdown ? (
        <div style={markdownStyle}>
          <MarkdownBody content={snapshot.text} />
        </div>
      ) : (
        <pre style={codeStyle}>{snapshot.text}</pre>
      )}
    </div>
  );
}

const blockStyle = {
  display: 'grid',
  gap: 6,
} as const;

const titleStyle = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.7,
  color: 'var(--z-fg-subtle)',
} as const;

const codeStyle = {
  margin: 0,
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  overflow: 'auto',
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

const markdownStyle = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  overflow: 'auto',
} as const;

const emptyStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--z-fg-muted)',
} as const;
