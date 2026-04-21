'use client';

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

function extractText(node: ReactNode): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

const fg = { color: 'var(--z-node-fg)' } as const;
const muted = { color: 'var(--z-node-hint-fg)' } as const;

type MarkdownBodyProps = {
  content: string;
  compact?: boolean;
};

export function MarkdownBody({ content, compact = false }: MarkdownBodyProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (raw: string) => {
    const v = raw.trim();
    if (!v) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(v);
        return true;
      }
      const el = document.createElement('textarea');
      el.value = v;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }, []);

  const copyCode = useCallback(
    async (text: string) => {
      const ok = await copy(text);
      if (!ok) return;
      setCopied(text);
      window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    },
    [copy],
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        code({ className, children, ...props }) {
          const raw = extractText(children);
          const isBlock =
            Boolean(className?.includes('language-')) ||
            (raw.includes('\n') && raw.trim().length > 0);
          if (!isBlock) {
            return (
              <code
                className={className}
                style={{
                  ...fg,
                  background: 'var(--z-node-hint-bg)',
                  border: '1px solid var(--z-node-hint-border)',
                  padding: '2px 6px',
                  borderRadius: 6,
                  fontSize: '0.9em',
                  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
                }}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className={className}
              style={{
                display: 'block',
                fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
                fontSize: compact ? 11 : 12,
                color: 'var(--z-node-fg)',
              }}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre({ children, ...props }) {
          const codeText = extractText(children);
          const done = copied === codeText;
          return (
            <div style={{ position: 'relative', margin: compact ? '8px 0' : '12px 0' }}>
              <button
                type="button"
                className="nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyCode(codeText);
                }}
                disabled={!codeText.trim()}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: 8,
                  fontSize: compact ? 10 : 11,
                  padding: compact ? '3px 7px' : '4px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--z-node-hint-border)',
                  background: 'var(--z-node-hint-bg)',
                  color: 'var(--z-node-spawn-path)',
                  cursor: codeText.trim() ? 'pointer' : 'not-allowed',
                  opacity: codeText.trim() ? 1 : 0.5,
                }}
              >
                {done ? 'Copied' : 'Copy'}
              </button>
              <pre
                style={{
                  overflow: 'auto',
                  borderRadius: 10,
                  padding: compact ? 10 : 12,
                  paddingTop: compact ? 32 : 36,
                  background: 'var(--z-node-textarea-bg)',
                  border: '1px solid var(--z-node-header-border)',
                  margin: 0,
                }}
                {...props}
              >
                {children}
              </pre>
            </div>
          );
        },
        h1({ children }) {
          return (
            <h1
              style={{
                ...fg,
                fontSize: compact ? '1.1rem' : '1.25rem',
                fontWeight: 700,
                margin: compact ? '10px 0 6px' : '12px 0 8px',
              }}
            >
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2
              style={{
                ...fg,
                fontSize: compact ? '1rem' : '1.1rem',
                fontWeight: 600,
                margin: compact ? '10px 0 6px' : '12px 0 6px',
              }}
            >
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3
              style={{
                ...fg,
                fontSize: compact ? '0.95rem' : '1rem',
                fontWeight: 600,
                margin: compact ? '8px 0 4px' : '10px 0 4px',
              }}
            >
              {children}
            </h3>
          );
        },
        p({ children }) {
          return (
            <p style={{ ...fg, margin: compact ? '0 0 8px' : '0 0 10px', lineHeight: compact ? 1.55 : 1.45 }}>
              {children}
            </p>
          );
        },
        ul({ children }) {
          return (
            <ul
              style={{
                ...fg,
                margin: compact ? '0 0 8px' : '0 0 10px',
                paddingLeft: compact ? 18 : 20,
                listStyleType: 'disc',
              }}
            >
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol style={{ ...fg, margin: compact ? '0 0 8px' : '0 0 10px', paddingLeft: compact ? 18 : 20 }}>
              {children}
            </ol>
          );
        },
        li({ children }) {
          return <li style={{ ...fg, marginBottom: compact ? 3 : 4, lineHeight: compact ? 1.55 : 1.45 }}>{children}</li>;
        },
        blockquote({ children }) {
          return (
            <blockquote
              style={{
                ...muted,
                borderLeft: '3px solid var(--z-node-header-border)',
                margin: compact ? '0 0 8px' : '0 0 10px',
                paddingLeft: compact ? 10 : 12,
                fontStyle: 'italic',
              }}
            >
              {children}
            </blockquote>
          );
        },
        table({ children }) {
          return (
            <div style={{ overflowX: 'auto', margin: compact ? '8px 0' : '12px 0' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  ...fg,
                  fontSize: compact ? 11 : 12,
                }}
              >
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th
              style={{
                border: '1px solid var(--z-node-header-border)',
                background: 'var(--z-node-hint-bg)',
                padding: compact ? '6px 8px' : '7px 9px',
                textAlign: 'left',
                fontWeight: 700,
              }}
            >
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td
              style={{
                border: '1px solid var(--z-node-header-border)',
                padding: compact ? '6px 8px' : '7px 9px',
                verticalAlign: 'top',
              }}
            >
              {children}
            </td>
          );
        },
        hr() {
          return (
            <hr
              style={{
                margin: compact ? '8px 0' : '12px 0',
                border: 'none',
                borderTop: '1px solid var(--z-node-header-border)',
              }}
            />
          );
        },
        a({ href, children }) {
          return (
            <a href={href} style={{ color: 'var(--z-node-type-default)' }} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
        br() {
          return <br />;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
