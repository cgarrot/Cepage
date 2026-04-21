'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { workflowCopilotAttachmentDisplayName } from '@cepage/shared-core';
import {
  copyTextToClipboard,
  type ChatTimelineCopilotCheckpoint,
  type ChatTimelineCopilotMessage,
} from '@cepage/state';
import {
  Avatar,
  Badge,
  Button,
  IconAlertTriangle,
  IconBrain,
  IconCheckCircle,
  IconCopy,
  IconImage,
  IconRotateCcw,
  IconSparkles,
  IconUser,
  LoadingDots,
  Spinner,
} from '@cepage/ui-kit';
import { MarkdownBody } from '../MarkdownBody';
import { BlockShell } from './BlockShell';

type CopilotMessageBlockProps = {
  item: ChatTimelineCopilotMessage;
  applying?: boolean;
  onApply?: (messageId: string) => void;
  showAnalysis?: boolean;
  showRawOutput?: boolean;
  /**
   * Checkpoint captured before this user message's ops were applied — only
   * meaningful on `role: 'user'` items. When set and `onRestoreCheckpoint`
   * is provided, a small inline "Restore" pill is rendered in the header
   * (Cursor-style) so the user can revert without leaving the message.
   */
  checkpoint?: ChatTimelineCopilotCheckpoint;
  /** Flag from the store: this checkpoint's restore request is in-flight. */
  restoringCheckpoint?: boolean;
  onRestoreCheckpoint?: (checkpointId: string) => void;
  /** Compose the chat strings used for clipboard / accessibility labels. */
  labels: {
    you: string;
    assistant: string;
    sending: string;
    thinking: string;
    analysis: string;
    summary: string;
    warnings: string;
    applied: string;
    apply: string;
    applying: string;
    output: string;
    copy: string;
    /** "Checkpoint" noun shown in the tooltip header of the restore pill. */
    checkpoint?: string;
    /** Restore button / tooltip verb. */
    restore?: string;
    /** Label used while the restore request is in-flight. */
    restoring?: string;
  };
};

/**
 * Renders a single Copilot message in the chat timeline. The block adapts
 * to the message role: `user` shows the user's prompt + any attachments,
 * `assistant` reveals analysis (collapsed when long), summary, warnings,
 * apply receipt, and the Apply CTA when ops are pending. Mirrors the visual
 * structure of {@link WorkflowCopilotPanel} so users see the same content
 * inline in the unified chat.
 */
export function CopilotMessageBlock({
  item,
  applying = false,
  onApply,
  showAnalysis = true,
  showRawOutput = true,
  checkpoint,
  restoringCheckpoint = false,
  onRestoreCheckpoint,
  labels,
}: CopilotMessageBlockProps) {
  const isAssistant = item.role === 'assistant';
  const pending = item.status === 'pending';
  const tone: 'accent' | 'subtle' = isAssistant ? 'accent' : 'subtle';
  const roleIcon = isAssistant ? <IconSparkles size={12} /> : <IconUser size={12} />;
  const roleLabel = isAssistant ? labels.assistant : labels.you;
  const time = useMemo(() => new Date(item.createdAt).toLocaleTimeString(), [item.createdAt]);
  const rawOutput = item.rawOutput?.trim() ?? '';
  const thinkingOutput = item.thinkingOutput?.trim() ?? '';
  const showThinking = isAssistant && thinkingOutput.length > 0;
  // Track open state explicitly so we can keep the panel expanded while the
  // assistant streams reasoning, then collapse it the first time the run
  // leaves `pending`. After auto-collapse the user can still toggle it.
  const [thinkingOpen, setThinkingOpen] = useState(pending);
  useEffect(() => {
    if (pending) {
      setThinkingOpen(true);
      return;
    }
    setThinkingOpen(false);
  }, [pending]);
  // Only surface the raw envelope when there is no structured content to
  // render (parse failed, or message is still streaming). Once analysis,
  // reply, summary, warnings, or ops are present, the raw output is just a
  // debug duplicate and should stay hidden behind a manual toggle elsewhere.
  const hasStructuredContent =
    Boolean(item.text?.trim()) ||
    Boolean(item.analysis?.trim()) ||
    item.summary.length > 0 ||
    item.warnings.length > 0 ||
    item.opCount > 0;
  const showRaw = showRawOutput && rawOutput.length > 0 && (pending || !hasStructuredContent);
  const canApply =
    isAssistant && !item.apply && item.opCount > 0 && typeof onApply === 'function';

  const onCopy = () => {
    void copyTextToClipboard(item.text || rawOutput || '');
  };

  return (
    <BlockShell tone={tone} bordered padding={14} style={{ display: 'grid', gap: 8 }}>
      <div style={metaRowStyle}>
        <div style={metaLeftStyle}>
          <Avatar
            role={isAssistant ? 'agent' : 'human'}
            label={roleLabel.charAt(0)}
            size={22}
            icon={roleIcon}
          />
          <Badge tone={isAssistant ? 'agent' : 'info'}>{roleLabel}</Badge>
          {item.model ? (
            <span style={metaModelStyle}>
              {item.model.providerId} · {item.model.modelId}
            </span>
          ) : null}
          <span style={metaTimeStyle}>{time}</span>
          {pending ? (
            <span style={pendingMetaStyle}>
              <Spinner size={14} />
              <LoadingDots />
              <span style={pendingMetaLabelStyle}>{labels.sending}</span>
            </span>
          ) : null}
        </div>
        <div style={metaActionsStyle}>
          {item.role === 'user' && checkpoint && onRestoreCheckpoint ? (
            <CheckpointRestorePill
              checkpoint={checkpoint}
              restoring={restoringCheckpoint}
              onRestore={onRestoreCheckpoint}
              labels={{
                checkpoint: labels.checkpoint ?? 'Checkpoint',
                restore: labels.restore ?? 'Restore',
                restoring: labels.restoring ?? 'Restoring…',
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={onCopy}
            aria-label={labels.copy}
            title={labels.copy}
            style={iconButtonStyle}
          >
            <IconCopy size={12} />
          </button>
        </div>
      </div>

      {showThinking ? (
        <details
          open={thinkingOpen}
          onToggle={(event) => setThinkingOpen(event.currentTarget.open)}
          style={thinkingBoxStyle}
        >
          <summary style={thinkingSummaryStyle}>
            <IconBrain size={12} />
            <span style={sectionLabelStyle}>
              {pending ? `${labels.thinking}…` : labels.thinking}
            </span>
            {pending ? <LoadingDots /> : null}
          </summary>
          <pre style={thinkingStreamStyle}>{thinkingOutput}</pre>
        </details>
      ) : null}

      {isAssistant && showAnalysis && item.analysis ? (
        <details style={analysisStyle}>
          <summary style={sectionLabelStyle}>{labels.analysis}</summary>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{item.analysis}</div>
        </details>
      ) : null}

      {item.text ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          <MarkdownBody content={item.text} compact />
        </div>
      ) : null}

      {item.role === 'user' && item.attachments.length > 0 ? (
        <div style={attachmentsRowStyle}>
          {item.attachments.map((attachment, idx) => {
            const label = workflowCopilotAttachmentDisplayName(attachment);
            return attachment.mime.startsWith('image/') ? (
              <img
                key={`${item.id}:att:${idx}`}
                src={attachment.data}
                alt={label}
                style={attachmentImageStyle}
              />
            ) : (
              <div key={`${item.id}:att:${idx}`} style={attachmentChipStyle}>
                <IconImage size={12} />
                <span style={attachmentLabelStyle}>{label}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {showRaw ? (
        <details open={pending || !item.text} style={outputWrapStyle}>
          <summary style={outputSummaryStyle}>
            {pending ? `${labels.output} · ${labels.sending}` : labels.output}
          </summary>
          <pre style={outputStyle}>{rawOutput}</pre>
        </details>
      ) : null}

      {item.summary.length > 0 ? (
        <section>
          <div style={sectionLabelStyle}>{labels.summary}</div>
          <ul style={listStyle}>
            {item.summary.map((line, index) => (
              <li key={`${item.id}:summary:${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {item.warnings.length > 0 ? (
        <section style={warningsBoxStyle}>
          <div style={warningsTitleStyle}>
            <IconAlertTriangle size={12} />
            <span style={sectionLabelStyle}>{labels.warnings}</span>
          </div>
          <ul style={listStyle}>
            {item.warnings.map((line, index) => (
              <li key={`${item.id}:warning:${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {item.apply ? (
        <section style={appliedBoxStyle}>
          <div style={appliedTitleStyle}>
            <IconCheckCircle size={12} />
            <span style={sectionLabelStyle}>{labels.applied}</span>
          </div>
          <ul style={listStyle}>
            {item.apply.summary.map((line, index) => (
              <li key={`${item.id}:apply:${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {canApply ? (
        <div style={ctaRowStyle}>
          <Button size="sm" onClick={() => onApply!(item.message.id)}>
            {applying ? labels.applying : labels.apply}
          </Button>
        </div>
      ) : null}

      {item.error ? <div style={errorStyle}>{item.error}</div> : null}
    </BlockShell>
  );
}

/**
 * Cursor-style "Restore" pill attached to a user message. Appears inline in
 * the message header next to the copy button, with a tooltip showing the
 * checkpoint hash and an optional summary of what will be reverted.
 *
 * Visual contract:
 *  - Idle: short hash + rotate-counter-clockwise icon + "Restore" label.
 *  - Restoring: spinner + "Restoring…" label, button disabled.
 *  - Already restored: greyed out label instead of button; tooltip shows
 *    the restore time so the user knows the state is frozen.
 */
function CheckpointRestorePill({
  checkpoint,
  restoring,
  onRestore,
  labels,
}: {
  checkpoint: ChatTimelineCopilotCheckpoint;
  restoring: boolean;
  onRestore: (checkpointId: string) => void;
  labels: { checkpoint: string; restore: string; restoring: string };
}) {
  const ckptId = checkpoint.checkpoint.id;
  const short = ckptId.slice(0, 8);
  const alreadyRestored = Boolean(checkpoint.restoredAt);
  // Tooltip: "Checkpoint #abcd1234 · 5 ops" / "… · restored at 14:02:11".
  const tooltip = useMemo(() => {
    const parts: string[] = [`${labels.checkpoint} #${short}`];
    if (checkpoint.summary.length > 0) {
      parts.push(`${checkpoint.summary.length} ops`);
    }
    if (checkpoint.restoredAt) {
      parts.push(
        `restored ${new Date(checkpoint.restoredAt).toLocaleTimeString()}`,
      );
    }
    return parts.join(' · ');
  }, [labels.checkpoint, short, checkpoint.summary.length, checkpoint.restoredAt]);

  if (alreadyRestored) {
    return (
      <span style={restorePillRestoredStyle} title={tooltip}>
        <IconRotateCcw size={11} />
        <span style={pillHashStyle}>#{short}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onRestore(ckptId)}
      disabled={restoring}
      title={tooltip}
      aria-label={tooltip}
      style={restoring ? restorePillDisabledStyle : restorePillStyle}
    >
      {restoring ? <Spinner size={11} /> : <IconRotateCcw size={11} />}
      <span style={pillHashStyle}>#{short}</span>
      <span style={pillLabelStyle}>
        {restoring ? labels.restoring : labels.restore}
      </span>
    </button>
  );
}

const metaRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

const metaLeftStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const metaModelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--z-fg-muted)',
  fontVariantNumeric: 'tabular-nums',
};

const metaTimeStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--z-fg-subtle)',
};

const iconButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--z-fg-muted)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
};

const metaActionsStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const restorePillBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px dashed var(--z-border)',
  background: 'var(--z-bg-app)',
  color: 'var(--z-fg-muted)',
  fontSize: 11,
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
};

const restorePillStyle: CSSProperties = restorePillBaseStyle;

const restorePillDisabledStyle: CSSProperties = {
  ...restorePillBaseStyle,
  cursor: 'progress',
  opacity: 0.7,
};

const restorePillRestoredStyle: CSSProperties = {
  ...restorePillBaseStyle,
  cursor: 'default',
  opacity: 0.55,
  fontStyle: 'italic',
};

const pillHashStyle: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace',
  color: 'var(--z-fg-subtle)',
};

const pillLabelStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 600,
};

const analysisStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-subtle)',
  background: 'var(--z-bg-sidebar)',
  border: '1px solid var(--z-border)',
  borderRadius: 8,
  padding: 8,
};

const thinkingBoxStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-subtle)',
  background: 'var(--z-bg-sidebar)',
  border: '1px solid var(--z-border)',
  borderRadius: 8,
  padding: 8,
  display: 'grid',
  gap: 6,
};

const thinkingSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--z-fg-muted)',
  listStyle: 'none',
};

const thinkingStreamStyle: CSSProperties = {
  margin: '4px 0 0',
  padding: 0,
  background: 'transparent',
  whiteSpace: 'pre-wrap',
  fontSize: 12,
  color: 'var(--z-fg-subtle)',
  fontFamily:
    'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace',
  maxHeight: 240,
  overflow: 'auto',
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--z-fg-muted)',
};

const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'grid',
  gap: 2,
  fontSize: 12.5,
};

const warningsBoxStyle: CSSProperties = {
  background: 'rgba(202, 138, 4, 0.08)',
  border: '1px solid rgba(202, 138, 4, 0.4)',
  borderRadius: 8,
  padding: 8,
  display: 'grid',
  gap: 4,
};

const warningsTitleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: 'rgb(202, 138, 4)',
};

const appliedBoxStyle: CSSProperties = {
  background: 'rgba(22, 163, 74, 0.08)',
  border: '1px solid rgba(22, 163, 74, 0.4)',
  borderRadius: 8,
  padding: 8,
  display: 'grid',
  gap: 4,
};

const appliedTitleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: 'rgb(22, 163, 74)',
};

const attachmentsRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const attachmentImageStyle: CSSProperties = {
  maxWidth: 220,
  maxHeight: 160,
  borderRadius: 6,
  border: '1px solid var(--z-border)',
};

const attachmentChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  fontSize: 11,
};

const attachmentLabelStyle: CSSProperties = {
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const outputWrapStyle: CSSProperties = {
  border: '1px solid var(--z-border)',
  borderRadius: 8,
  padding: '6px 8px',
  background: 'var(--z-bg-app)',
};

const outputSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  fontSize: 11,
  color: 'var(--z-fg-muted)',
};

const outputStyle: CSSProperties = {
  margin: '6px 0 0',
  padding: 0,
  background: 'transparent',
  whiteSpace: 'pre-wrap',
  fontSize: 12,
  color: 'var(--z-fg-subtle)',
  fontFamily:
    'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

const ctaRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: 'rgb(220, 38, 38)',
  background: 'rgba(220, 38, 38, 0.08)',
  border: '1px solid rgba(220, 38, 38, 0.4)',
  borderRadius: 8,
  padding: 8,
};

const pendingMetaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--z-fg-muted)',
};

const pendingMetaLabelStyle: CSSProperties = {
  fontStyle: 'normal',
};
