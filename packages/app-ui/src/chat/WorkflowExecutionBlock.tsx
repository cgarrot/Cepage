'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  IconAlertTriangle,
  IconBranch,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconButton,
  IconX,
} from '@cepage/ui-kit';
import type {
  ChatTimelineAgentStep,
  ChatTimelineExecution,
  ChatTimelineExecutionFallback,
  ChatTimelineExecutionSibling,
  ChatModelRef,
} from '@cepage/state';
import { AgentBadge } from './AgentBadge';
import { BlockShell } from './BlockShell';
import { CodeBlockEnhanced } from './CodeBlockEnhanced';
import { useI18n } from '../I18nProvider';

type WorkflowExecutionBlockProps = {
  item: ChatTimelineExecution;
  streamingOutput: string;
};

const ACTIVE_STATUSES = new Set([
  'pending',
  'booting',
  'running',
  'waiting_input',
  'paused',
]);

function isActive(status: ChatTimelineExecution['status']): boolean {
  return ACTIVE_STATUSES.has(status);
}

function isTerminalFailure(status: ChatTimelineExecution['status']): boolean {
  return status === 'failed';
}

function isCancelled(status: ChatTimelineExecution['status']): boolean {
  return status === 'cancelled';
}

function statusTone(
  status: ChatTimelineExecution['status'],
): 'info' | 'success' | 'danger' | 'neutral' | 'warning' | 'agent' {
  if (isActive(status)) return 'agent';
  if (status === 'completed') return 'success';
  if (isTerminalFailure(status)) return 'danger';
  if (isCancelled(status)) return 'neutral';
  return 'info';
}

function formatModel(model: ChatModelRef | undefined): string {
  if (!model) return '';
  return `${model.providerId}/${model.modelId}`;
}

function diffMs(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) return undefined;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return undefined;
  return e - s;
}

function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remainder}s`;
}

function StepMarker({ step }: { step: ChatTimelineAgentStep }) {
  const status = (step.node.status as string | undefined) ?? 'active';
  let icon;
  let color = 'var(--z-fg-muted)';
  if (status === 'active' || status === 'running') {
    icon = <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--z-accent)' }} />;
    color = 'var(--z-accent)';
  } else if (status === 'completed') {
    icon = <IconCheck size={12} />;
    color = 'var(--z-fg)';
  } else if (status === 'failed' || status === 'errored') {
    icon = <IconX size={12} />;
    color = 'var(--z-danger, #dc2626)';
  } else {
    icon = <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--z-border)' }} />;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color }}>{icon}</span>
  );
}

function SiblingLine({
  sibling,
  index,
  t,
}: {
  sibling: ChatTimelineExecutionSibling;
  index: number;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const label = formatModel(sibling.model) || t('ui.chat.executionUnknownModel');
  const runLabel = t('ui.chat.executionRunLabel', { index: index + 1 });
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--z-fg-muted)',
      }}
    >
      <span style={{ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}>
        {runLabel}
      </span>
      <span>·</span>
      <span style={{ color: 'var(--z-fg)' }}>{label}</span>
      <Badge tone={statusTone(sibling.status)} outline>
        {sibling.status}
      </Badge>
      {sibling.isPrimary ? (
        <Badge tone="neutral" outline>
          {t('ui.chat.executionPrimary')}
        </Badge>
      ) : null}
    </li>
  );
}

function FallbackLine({
  event,
  t,
}: {
  event: ChatTimelineExecutionFallback;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const fromProvider = event.fromModel?.providerId ?? '?';
  const fromModel = event.fromModel?.modelId ?? '?';
  const toProvider = event.toModel?.providerId ?? '?';
  const toModel = event.toModel?.modelId ?? '?';
  const reason = event.reason || t('ui.chat.executionFallbackReasonUnknown');
  const text = t('ui.chat.executionFallbackLine', {
    fromProvider,
    fromModel,
    toProvider,
    toModel,
    reason,
  });
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        fontSize: 12,
        color: 'var(--z-fg-muted)',
      }}
    >
      <IconAlertTriangle size={12} color="var(--z-warning, #b45309)" />
      <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
    </li>
  );
}

/**
 * Unified live block for a workflow execution: one surface that bundles the
 * AgentBadge (configured vs called model), the fallback-chain siblings,
 * the fallback-switch events, the attached agent_step markers, and the
 * streaming output. Auto-expanded while the execution is active, auto-
 * collapsed once terminal — users can toggle manually at any time.
 */
export function WorkflowExecutionBlock({ item, streamingOutput }: WorkflowExecutionBlockProps) {
  const { t } = useI18n();
  const active = isActive(item.status) || item.isStreaming;
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(active);

  // Auto-open while streaming, auto-collapse once terminal (unless the user
  // has manually overridden). Respect the user's toggle on subsequent status
  // changes — we only re-sync with `active` as long as they haven't touched
  // the chevron.
  useEffect(() => {
    if (userToggled) return;
    setOpen(active);
  }, [active, userToggled]);

  const onToggle = () => {
    setOpen((value) => !value);
    setUserToggled(true);
  };

  const hasFallback = item.siblings.length > 1;
  const duration = formatDuration(diffMs(item.startedAt, item.endedAt));

  const headerLabel = useMemo(() => {
    if (active) return t('ui.chat.executionRunning');
    if (item.status === 'completed') return t('ui.chat.executionCompleted');
    if (isTerminalFailure(item.status)) return t('ui.chat.executionFailed');
    if (isCancelled(item.status)) return t('ui.chat.executionCancelled');
    return t('ui.chat.executionRunning');
  }, [active, item.status, t]);

  const collapsedSummary = useMemo(() => {
    const finalLabel = formatModel(item.calledModel) || formatModel(item.configuredModel) || '';
    const parts: string[] = [];
    parts.push(
      t('ui.chat.executionStepsCount', { count: item.steps.length }),
    );
    if (duration) parts.push(duration);
    if (finalLabel) parts.push(finalLabel);
    let base = parts.join(' · ');
    if (hasFallback && item.configuredModel && item.calledModel) {
      base = `${base} · ${t('ui.chat.executionFellBackShort', {
        from: formatModel(item.configuredModel),
        to: formatModel(item.calledModel),
      })}`;
    }
    return base;
  }, [item.calledModel, item.configuredModel, item.steps.length, duration, hasFallback, t]);

  const shellTone = isTerminalFailure(item.status)
    ? 'danger'
    : active
      ? 'accent'
      : item.status === 'completed'
        ? 'success'
        : 'subtle';

  return (
    <BlockShell tone={shellTone} padding={12} style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <IconBranch size={14} color="var(--z-fg-muted)" />
        <span style={{ fontSize: 12, color: 'var(--z-fg-muted)' }}>{headerLabel}</span>
        <AgentBadge
          actor={item.actor}
          agentType={item.agentType}
          {...(item.configuredModel ? { model: item.configuredModel } : {})}
          {...(item.calledModel ? { callModel: item.calledModel } : {})}
        />
        <Badge tone={statusTone(item.status)} outline>
          {item.status}
        </Badge>
        {hasFallback ? (
          <Badge tone="warning" outline>
            {t('ui.chat.executionFallbackBadge', { count: item.siblings.length })}
          </Badge>
        ) : null}
        <IconButton
          size={26}
          label={open ? t('ui.chat.executionCollapse') : t('ui.chat.executionExpand')}
          active={open}
          onClick={onToggle}
          style={{ marginLeft: 'auto' }}
        >
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </IconButton>
      </div>

      {!open ? (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--z-fg-muted)',
          }}
        >
          {collapsedSummary}
        </p>
      ) : null}

      {open ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {hasFallback ? (
            <ul
              style={{
                margin: 0,
                padding: '0 0 0 2px',
                listStyle: 'none',
                display: 'grid',
                gap: 4,
              }}
            >
              {item.siblings.map((sibling, idx) => (
                <SiblingLine key={sibling.runId} sibling={sibling} index={idx} t={t} />
              ))}
            </ul>
          ) : null}

          {item.fallbackEvents.length > 0 ? (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'grid',
                gap: 4,
              }}
            >
              {item.fallbackEvents.map((event) => (
                <FallbackLine key={event.id} event={event} t={t} />
              ))}
            </ul>
          ) : null}

          {item.steps.length > 0 ? (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'grid',
                gap: 4,
              }}
            >
              {item.steps.map((step) => (
                <li
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: 'var(--z-fg)',
                  }}
                >
                  <StepMarker step={step} />
                  {step.label ? <strong>{step.label}</strong> : null}
                  {step.role ? (
                    <Badge tone="neutral" outline>
                      {step.role}
                    </Badge>
                  ) : null}
                  {step.brief ? (
                    <span style={{ color: 'var(--z-fg-muted)' }}>— {step.brief}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {streamingOutput && streamingOutput.trim().length > 0 ? (
            <CodeBlockEnhanced
              code={streamingOutput}
              language={active ? t('ui.chat.executionStreamingLabel') : 'stdout'}
              maxHeight={320}
            />
          ) : null}
        </div>
      ) : null}
    </BlockShell>
  );
}
