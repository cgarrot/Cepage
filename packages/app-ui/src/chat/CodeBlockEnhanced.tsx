'use client';

import { useCallback, useState } from 'react';
import { IconButton, IconCheck, IconCopy, Tooltip } from '@cepage/ui-kit';

type CodeBlockEnhancedProps = {
  code: string;
  language?: string;
  filename?: string;
  maxHeight?: number;
  copyable?: boolean;
};

const PRE_STYLE = {
  margin: 0,
  padding: '12px 14px',
  paddingTop: 36,
  fontSize: 12,
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  background: 'var(--z-node-textarea-bg)',
  color: 'var(--z-fg)',
  overflow: 'auto',
  lineHeight: 1.55,
} as const;

/**
 * Pretty code surface for inline code blocks rendered outside of a Markdown
 * tree (tool calls, file diffs, raw outputs). For Markdown content inside
 * messages we keep using {@link MarkdownBody} so list/heading styles apply.
 */
export function CodeBlockEnhanced({
  code,
  language,
  filename,
  maxHeight,
  copyable = true,
}: CodeBlockEnhancedProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!code.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const el = document.createElement('textarea');
        el.value = code;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }, [code]);

  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid var(--z-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'var(--z-bg-sidebar)',
          borderBottom: '1px solid var(--z-border)',
          fontSize: 11,
          color: 'var(--z-fg-muted)',
          fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
        }}
      >
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {language ? <strong style={{ color: 'var(--z-fg)' }}>{language}</strong> : null}
          {filename ? <span>{filename}</span> : null}
        </span>
        {copyable ? (
          <Tooltip label={copied ? 'Copied' : 'Copy'}>
            <IconButton
              size={26}
              label={copied ? 'Copied' : 'Copy code'}
              onClick={onCopy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <pre
        style={{
          ...PRE_STYLE,
          paddingTop: 12,
          maxHeight,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
