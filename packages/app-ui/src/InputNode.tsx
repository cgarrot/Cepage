'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  type GraphNode,
  type WorkflowInputAccept,
  type WorkflowInputContent,
  type WorkflowInputPart,
} from '@cepage/shared-core';
import {
  evaluateInputTemplateStartState,
  useWorkspaceStore,
  type AgentRunSelection,
} from '@cepage/state';
import { useI18n } from './I18nProvider';
import { MarkdownBody } from './MarkdownBody';
import { looksLikeMarkdown } from './looksLikeMarkdown';
import { NodeAgentSelectionControl, useNodeAgentSelection } from './NodeAgentSelectionControl';
import { RunMenuButton } from './RunMenuButton';

type InputNodeData = {
  raw: GraphNode;
  text: string;
  workflowInput: WorkflowInputContent | null;
};

type Draft = {
  label: string;
  key: string;
  instructions: string;
  accepts: WorkflowInputAccept[];
  multiple: boolean;
  required: boolean;
};

const ACCEPTS: WorkflowInputAccept[] = ['text', 'image', 'file'];

function shortId(id: string): string {
  return id.slice(0, 8);
}

function trim(value: string): string | undefined {
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

function readDraft(content: WorkflowInputContent | null): Draft {
  if (!content || content.mode !== 'template') {
    return {
      label: 'Input',
      key: '',
      instructions: '',
      accepts: [...ACCEPTS],
      multiple: true,
      required: false,
    };
  }
  return {
    label: content.label ?? 'Input',
    key: content.key ?? '',
    instructions: content.instructions ?? '',
    accepts: content.accepts?.length ? [...content.accepts] : [...ACCEPTS],
    multiple: content.multiple ?? true,
    required: content.required ?? false,
  };
}

function summarizePart(part: WorkflowInputPart): string {
  if (part.type === 'text') return part.text;
  const dims = part.file.width && part.file.height ? ` · ${part.file.width}x${part.file.height}` : '';
  const extract = part.extractedText?.trim();
  return extract ? `${part.file.name}${dims}\n${extract}` : `${part.file.name}${dims}`;
}

export const InputNode = memo(function InputNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { t } = useI18n();
  const { raw, workflowInput, text } = data as InputNodeData;
  const patchNodeData = useWorkspaceStore((s) => s.patchNodeData);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const runFromNode = useWorkspaceStore((s) => s.runFromNode);
  const startState = useWorkspaceStore((s) => s.getInputStartState(id));
  const liveRun = useWorkspaceStore(
    (s) => s.liveRuns.find((entry) => entry.triggerNodeId === id || entry.stepNodeId === id) ?? null,
  );
  const selectedIds = useWorkspaceStore((s) => s.selectedIds);
  const setSelected = useWorkspaceStore((s) => s.setSelected);
  const [draft, setDraft] = useState(() => readDraft(workflowInput));
  const [inlineText, setInlineText] = useState('');
  const [sourceNodeIds, setSourceNodeIds] = useState<string[]>([]);
  const { selection: nodeSelection } = useNodeAgentSelection(id, raw);

  useEffect(() => {
    setDraft(readDraft(workflowInput));
  }, [id, workflowInput]);

  useEffect(() => {
    setInlineText('');
    setSourceNodeIds([]);
  }, [id]);

  const focus = () => {
    if (selectedIds.length > 1 && selectedIds.includes(id)) return;
    setSelected(id);
  };

  const persist = (next: Draft) => {
    if (!workflowInput || workflowInput.mode !== 'template') return;
    const content = {
      mode: 'template' as const,
      label: trim(next.label) ?? 'Input',
      ...(trim(next.key) ? { key: trim(next.key) } : {}),
      accepts: next.accepts,
      multiple: next.multiple,
      required: next.required,
      ...(trim(next.instructions) ? { instructions: trim(next.instructions) } : {}),
    };
    void patchNodeData(id, { content });
  };

  const handleRun = (selection: AgentRunSelection | null = null) => {
    focus();
    const options =
      workflowInput?.mode === 'template'
        ? {
            ...(canInlineText && trim(inlineText) ? { inlineText } : {}),
            ...(selectedSourceIds.length > 0 ? { sourceNodeIds: selectedSourceIds } : {}),
          }
        : undefined;
    void runFromNode(id, selection, options);
  };

  const parts = workflowInput?.mode === 'bound' ? workflowInput.parts : [];
  const summary = workflowInput?.mode === 'bound' ? (workflowInput.summary ?? text) : draft.instructions;
  const showPreview = looksLikeMarkdown(summary) && summary.trim().length > 0;
  const typeLabel = t('nodeType.input');
  const accepts = useMemo(() => new Set(draft.accepts), [draft.accepts]);
  const target = workflowInput?.mode === 'template' ? startState?.target ?? null : null;
  const targetCandidates = target?.candidates ?? [];
  const canInlineText = target?.canInlineText ?? false;
  useEffect(() => {
    if (!canInlineText && inlineText) {
      setInlineText('');
    }
  }, [canInlineText, inlineText]);
  const autoSourceIds =
    !target?.bound && targetCandidates.length === 1
      ? [targetCandidates[0]?.sourceNodeId ?? ''].filter(Boolean)
      : [];
  const explicitSourceIds = sourceNodeIds.filter((nodeId) =>
    targetCandidates.some((candidate) => candidate.sourceNodeId === nodeId),
  );
  const selectedSourceIds = explicitSourceIds.length > 0 ? explicitSourceIds : autoSourceIds;
  const evaluation =
    workflowInput?.mode === 'template' && startState
      ? evaluateInputTemplateStartState(startState, {
          inlineText,
          sourceNodeIds: selectedSourceIds,
        })
      : null;
  const latest = workflowInput?.mode === 'template' ? (startState?.bound ?? []) : [];
  const missing = workflowInput?.mode === 'template' ? (evaluation?.missing ?? startState?.missing ?? []) : [];
  const ready = workflowInput?.mode === 'template' ? (evaluation?.ready ?? false) : false;
  const selectionRequired =
    workflowInput?.mode === 'template'
      ? Boolean(
          target?.required && !target.bound && !trim(inlineText) && targetCandidates.length > 1 && selectedSourceIds.length === 0,
        )
      : false;
  const blockedTitle =
    selectionRequired
      ? t('ui.node.inputSourceSelectionRequired')
      : missing.length > 0
        ? missing.map((item) => item.label).join(', ')
        : t('ui.node.inputStartBlocked');
  const primaryAction =
    workflowInput?.mode !== 'template'
      ? null
      : liveRun?.isActive
        ? {
            label: t('ui.node.inputOpenCurrentRun'),
            disabled: false,
            title: t('ui.node.inputOpenCurrentRun'),
          }
        : liveRun
          ? {
              label: t('ui.node.inputRetryLatestRun'),
              disabled: false,
              title: t('ui.node.inputRetryLatestRun'),
            }
          : {
              label: t('ui.node.inputStart'),
              disabled: !ready,
              title: ready ? t('ui.node.inputStart') : blockedTitle,
            };

  return (
    <div style={{ width: '100%', minWidth: 0, maxWidth: '100%', position: 'relative' }}>
      <button
        type="button"
        aria-label={t('ui.node.delete')}
        title={t('ui.node.delete')}
        className="nodrag nopan"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void removeNode(id);
        }}
        style={deleteButtonStyle}
      >
        &times;
      </button>

      <div
        style={{
          borderRadius: 16,
          border: selected ? '1px solid var(--z-node-border-selected)' : '1px solid var(--z-node-border)',
          background: 'var(--z-node-grad-default)',
          boxShadow: selected ? 'var(--z-node-shadow-selected)' : 'var(--z-node-shadow)',
          color: 'var(--z-node-fg)',
          overflow: 'hidden',
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div style={headerStyle}>
          <span style={{ justifySelf: 'start', color: 'var(--z-node-type-default)' }}>{typeLabel}</span>
          <span style={{ justifySelf: 'center', textTransform: 'none', letterSpacing: 'normal', fontSize: 10 }}>
            {workflowInput?.mode === 'bound' ? t('ui.node.inputBound') : t('ui.node.inputTemplate')}
          </span>
          <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={statusChipStyle}>{t(`nodeStatus.${raw.status}` as 'nodeStatus.active')}</span>
            {workflowInput?.mode === 'template' && primaryAction ? (
              <RunMenuButton
                isSpawnNode={false}
                label={primaryAction.label}
                title={primaryAction.title}
                disabled={primaryAction.disabled}
                selection={nodeSelection}
                onRun={handleRun}
              />
            ) : null}
          </div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <NodeAgentSelectionControl
            nodeId={id}
            raw={raw}
            placeholder={t('ui.node.selectionChoose')}
          />
        </div>

        {workflowInput?.mode === 'bound' ? (
          <div style={{ padding: 12, display: 'grid', gap: 10 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>{workflowInput.label ?? workflowInput.key ?? 'Input'}</div>
              <div style={metaStyle}>
                {workflowInput.key ? `${workflowInput.key} · ` : ''}
                {parts.length} {parts.length === 1 ? t('ui.node.inputPartSingle') : t('ui.node.inputPartMany')}
              </div>
            </div>

            {summary.trim() ? (
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>{t('ui.node.inputSummary')}</div>
                {showPreview ? (
                  <div className="nodrag nowheel" onMouseDown={focus} style={previewBodyStyle}>
                    <MarkdownBody content={summary} />
                  </div>
                ) : (
                  <pre style={codeStyle}>{summary}</pre>
                )}
              </div>
            ) : null}

            <div style={cardStyle}>
              <div style={sectionTitleStyle}>{t('ui.node.inputValues')}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {parts.map((part) => (
                  <div key={part.id} style={partStyle}>
                    <div style={partLabelStyle}>
                      {part.type === 'text' ? t('ui.node.inputText') : part.type === 'image' ? t('ui.node.inputImage') : t('ui.node.inputFile')}
                    </div>
                    <pre style={codeStyle}>{summarizePart(part)}</pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: 12, display: 'grid', gap: 10 }}>
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>{t('ui.node.inputStart')}</div>
              <div style={metaStyle}>
                {ready
                  ? t('ui.node.inputStartReady')
                  : selectionRequired
                    ? t('ui.node.inputSourceSelectionRequired')
                    : t('ui.node.inputStartBlocked')}
              </div>
              {canInlineText ? (
                <div style={fieldGroupStyle}>
                  <label style={fieldLabelStyle}>{t('ui.node.inputInlineValue')}</label>
                  <textarea
                    className="nodrag nowheel"
                    value={inlineText}
                    onFocus={focus}
                    onChange={(event) => setInlineText(event.target.value)}
                    placeholder={t('ui.node.inputInlinePlaceholder')}
                    style={inlineTextareaStyle}
                  />
                  <div style={metaStyle}>{t('ui.node.inputInlineHint')}</div>
                </div>
              ) : null}
              {targetCandidates.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={sectionTitleStyle}>{t('ui.node.inputLinkedSources')}</div>
                  <div style={metaStyle}>{t('ui.node.inputLinkedSourcesHint')}</div>
                  {targetCandidates.map((candidate) => {
                    const active = selectedSourceIds.includes(candidate.sourceNodeId);
                    const auto = active && explicitSourceIds.length === 0 && autoSourceIds.includes(candidate.sourceNodeId);
                    return (
                      <button
                        key={candidate.sourceNodeId}
                        type="button"
                        className="nodrag nopan"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          focus();
                          setSourceNodeIds((prev) => {
                            if (target?.multiple) {
                              return prev.includes(candidate.sourceNodeId)
                                ? prev.filter((entry) => entry !== candidate.sourceNodeId)
                                : [...prev, candidate.sourceNodeId];
                            }
                            return prev.includes(candidate.sourceNodeId) ? [] : [candidate.sourceNodeId];
                          });
                        }}
                        style={active ? candidateActiveStyle : candidateStyle}
                      >
                        <div style={candidateHeaderStyle}>
                          <span style={candidateTitleStyle}>{candidate.label}</span>
                          <span style={partLabelStyle}>
                            {[
                              t(`ui.node.inputAccept.${candidate.kind}` as 'ui.node.inputAccept.text'),
                              auto
                                ? t('ui.node.inputLinkedSourceAuto')
                                : active
                                  ? t('ui.node.inputLinkedSourceSelected')
                                  : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <pre style={codeStyle}>{candidate.summary}</pre>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {missing.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={sectionTitleStyle}>{t('ui.node.inputMissingValues')}</div>
                  {missing.map((item) => (
                    <div key={item.templateNodeId} style={partStyle}>
                      <pre style={codeStyle}>{item.label}</pre>
                    </div>
                  ))}
                </div>
              ) : null}
              {latest.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={sectionTitleStyle}>{t('ui.node.inputLatestValues')}</div>
                  {latest.map((item) => (
                    <div key={item.boundNodeId} style={partStyle}>
                      <div style={partLabelStyle}>
                        {item.isTarget ? t('ui.node.inputStartTarget') : t('ui.node.inputStartReuse')}
                      </div>
                      <pre style={codeStyle}>
                        {[item.label, item.summary].filter(Boolean).join('\n')}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={fieldGroupStyle}>
              <label style={fieldLabelStyle}>{t('ui.node.inputLabel')}</label>
              <input
                className="nodrag nopan"
                value={draft.label}
                onFocus={focus}
                onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
                onBlur={() => persist(draft)}
                placeholder={t('ui.node.inputLabel')}
                style={fieldStyle}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={fieldLabelStyle}>{t('ui.node.inputKey')}</label>
              <input
                className="nodrag nopan"
                value={draft.key}
                onFocus={focus}
                onChange={(event) => setDraft((prev) => ({ ...prev, key: event.target.value }))}
                onBlur={() => persist(draft)}
                placeholder="default"
                style={fieldStyle}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={fieldLabelStyle}>{t('ui.node.inputAccepts')}</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ACCEPTS.map((kind) => {
                  const active = accepts.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="nodrag nopan"
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextAccepts = active
                          ? draft.accepts.filter((entry) => entry !== kind)
                          : [...draft.accepts, kind];
                        const next = {
                          ...draft,
                          accepts: nextAccepts.length > 0 ? nextAccepts : [kind],
                        };
                        setDraft(next);
                        persist(next);
                      }}
                      style={active ? chipActiveStyle : chipStyle}
                    >
                      {t(`ui.node.inputAccept.${kind}` as 'ui.node.inputAccept.text')}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={toggleLabelStyle}>
                <input
                  type="checkbox"
                  checked={draft.multiple}
                  onChange={(event) => {
                    const next = { ...draft, multiple: event.target.checked };
                    setDraft(next);
                    persist(next);
                  }}
                />
                {t('ui.node.inputMultiple')}
              </label>
              <label style={toggleLabelStyle}>
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(event) => {
                    const next = { ...draft, required: event.target.checked };
                    setDraft(next);
                    persist(next);
                  }}
                />
                {t('ui.node.inputRequired')}
              </label>
            </div>

            <div style={fieldGroupStyle}>
              <label style={fieldLabelStyle}>{t('ui.node.inputInstructions')}</label>
              <textarea
                className="nodrag nowheel"
                value={draft.instructions}
                onFocus={focus}
                onChange={(event) => setDraft((prev) => ({ ...prev, instructions: event.target.value }))}
                onBlur={() => persist(draft)}
                placeholder={t('ui.node.inputInstructionsPlaceholder')}
                style={textareaStyle}
              />
            </div>
          </div>
        )}

        <div title={raw.id} style={footerStyle}>
          {workflowInput?.mode === 'bound' && workflowInput.runId ? `${shortId(raw.id)} · ${shortId(workflowInput.runId)}` : shortId(raw.id)}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
});

const deleteButtonStyle = {
  position: 'absolute',
  top: 12,
  left: 0,
  transform: 'translateX(-50%)',
  zIndex: 1,
  width: 22,
  height: 22,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  borderRadius: 999,
  border: '1px solid var(--z-node-header-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-error-fg)',
  fontSize: 14,
  lineHeight: 1,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

const headerStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: 8,
  padding: '10px 12px 8px',
  borderBottom: '1px solid var(--z-node-header-border)',
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.8,
} as const;

const statusChipStyle = {
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-chip-fg)',
  fontSize: 10,
} as const;

const fieldGroupStyle = {
  display: 'grid',
  gap: 6,
} as const;

const fieldLabelStyle = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  color: 'var(--z-fg-subtle)',
} as const;

const fieldStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
} as const;

const textareaStyle = {
  width: '100%',
  minHeight: 110,
  resize: 'vertical' as const,
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
  lineHeight: 1.45,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

const inlineTextareaStyle = {
  ...textareaStyle,
  minHeight: 90,
} as const;

const chipStyle = {
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  color: 'var(--z-node-chip-fg)',
  fontSize: 12,
  cursor: 'pointer',
} as const;

const chipActiveStyle = {
  ...chipStyle,
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
  color: 'var(--z-fg)',
} as const;

const toggleLabelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--z-fg)',
} as const;

const cardStyle = {
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--z-node-hint-border)',
  background: 'var(--z-node-hint-bg)',
  display: 'grid',
  gap: 8,
} as const;

const labelStyle = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--z-fg)',
} as const;

const metaStyle = {
  fontSize: 12,
  color: 'var(--z-fg-subtle)',
} as const;

const sectionTitleStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--z-fg)',
} as const;

const previewBodyStyle = {
  maxHeight: 240,
  overflowY: 'auto' as const,
  overflowX: 'hidden' as const,
  fontSize: 13,
  lineHeight: 1.45,
} as const;

const codeStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
  fontSize: 12,
  lineHeight: 1.45,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  color: 'var(--z-fg)',
} as const;

const candidateStyle = {
  ...cardStyle,
  textAlign: 'left' as const,
  cursor: 'pointer',
};

const candidateActiveStyle = {
  ...candidateStyle,
  border: '1px solid var(--z-node-run-border)',
  background: 'var(--z-node-run-bg)',
};

const candidateHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
} as const;

const candidateTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--z-fg)',
} as const;

const partStyle = {
  padding: 10,
  borderRadius: 10,
  border: '1px solid var(--z-node-hint-border)',
  background: 'rgba(0, 0, 0, 0.04)',
  display: 'grid',
  gap: 6,
} as const;

const partLabelStyle = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  color: 'var(--z-fg-subtle)',
} as const;

const footerStyle = {
  padding: '0 12px 10px',
  color: 'var(--z-node-id-fg)',
  fontSize: 10,
} as const;
