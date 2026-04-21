import type { CSSProperties } from 'react';
import {
  readLooseWorkflowManagedFlowContent,
  readWorkflowManagedFlowSummary,
  type WorkflowManagedFlowContent,
  type WorkflowManagedFlowPhase,
} from '@cepage/shared-core';
import { useI18n } from '../I18nProvider';
import {
  buttonStyle,
  chipStyle,
  Field,
  inputStyle,
  labelStyle,
  RuntimeRow,
  Section,
  stackStyle,
  textareaStyle,
  toggleLabelStyle,
} from './layout';
import { formatOption, lines, trim } from './normalize';
import type { StructuredNodeEditorProps } from './types';

const managedPhaseKinds = [
  'loop_phase',
  'agent_phase',
  'validation_phase',
  'derive_input_phase',
  'runtime_verify_phase',
] as const satisfies ReadonlyArray<WorkflowManagedFlowPhase['kind']>;

function normalizeManagedFlowEntry(
  phases: WorkflowManagedFlowContent['phases'],
  entryPhaseId?: string,
): string | undefined {
  if (entryPhaseId && phases.some((phase) => phase.id === entryPhaseId)) {
    return entryPhaseId;
  }
  return phases[0]?.id;
}

function defaultManagedFlowPhase(
  kind: WorkflowManagedFlowPhase['kind'],
  index: number,
): WorkflowManagedFlowPhase {
  const num = index + 1;
  if (kind === 'loop_phase') {
    return {
      id: `loop-${num}`,
      kind,
      nodeId: 'replace-loop-node-id',
    };
  }
  if (kind === 'agent_phase') {
    return {
      id: `agent-${num}`,
      kind,
      nodeId: 'replace-agent-node-id',
      expectedOutputs: [],
    };
  }
  if (kind === 'validation_phase') {
    return {
      id: `validate-${num}`,
      kind,
      validatorNodeId: 'replace-validator-node-id',
      expectedOutputs: [],
    };
  }
  if (kind === 'derive_input_phase') {
    return {
      id: `derive-${num}`,
      kind,
      sourceNodeId: 'replace-source-node-id',
      targetTemplateNodeId: 'replace-template-node-id',
      jsonPath: 'items',
    };
  }
  return {
    id: `verify-${num}`,
    kind: 'runtime_verify_phase',
    nodeId: 'replace-runtime-node-id',
    expectedOutputs: [],
  };
}

export function ManagedFlowEditor({ raw, onPatch }: StructuredNodeEditorProps) {
  const { t } = useI18n();
  const flow = readLooseWorkflowManagedFlowContent(raw.content);
  const runtime = readWorkflowManagedFlowSummary(raw.metadata);
  if (!flow) return null;

  const patch = (next: Partial<WorkflowManagedFlowContent>) => {
    const merged = {
      ...flow,
      ...next,
    };
    const entryPhaseId = normalizeManagedFlowEntry(merged.phases, merged.entryPhaseId);
    onPatch({
      ...merged,
      ...(entryPhaseId ? { entryPhaseId } : {}),
    });
  };

  const updatePhase = (index: number, phase: WorkflowManagedFlowPhase) => {
    const current = flow.phases[index];
    const phases = flow.phases.map((entry, currentIndex) => (currentIndex === index ? phase : entry));
    const entryPhaseId =
      flow.entryPhaseId === current.id
        ? normalizeManagedFlowEntry(phases, phase.id)
        : normalizeManagedFlowEntry(phases, flow.entryPhaseId);
    onPatch({
      ...flow,
      phases,
      ...(entryPhaseId ? { entryPhaseId } : {}),
    });
  };

  const removePhase = (index: number) => {
    if (flow.phases.length <= 1) return;
    const removed = flow.phases[index];
    const phases = flow.phases.filter((_, currentIndex) => currentIndex !== index);
    const entryPhaseId =
      flow.entryPhaseId === removed.id
        ? normalizeManagedFlowEntry(phases, phases[0]?.id)
        : normalizeManagedFlowEntry(phases, flow.entryPhaseId);
    onPatch({
      ...flow,
      phases,
      ...(entryPhaseId ? { entryPhaseId } : {}),
    });
  };

  const addPhase = () => {
    patch({
      phases: [...flow.phases, defaultManagedFlowPhase('agent_phase', flow.phases.length)],
    });
  };

  const phaseCardStyle: CSSProperties = {
    ...stackStyle,
    padding: 10,
    borderRadius: 10,
    border: '1px solid var(--z-node-hint-border)',
    background: 'var(--z-node-textarea-bg)',
  };

  return (
    <div style={stackStyle}>
      {runtime ? (
        <Section title={t('ui.node.structuredRuntime')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={chipStyle}>
              {t('ui.node.structuredStatus')}: {runtime.status}
            </span>
            <span style={chipStyle}>
              {t('ui.node.structuredProgress')}: {runtime.completedPhaseCount}/{runtime.phaseCount}
            </span>
          </div>
          {runtime.currentPhaseId ? (
            <RuntimeRow label={t('ui.node.structuredCurrentPhase')} value={runtime.currentPhaseId} />
          ) : null}
          {runtime.currentPhaseKind ? (
            <RuntimeRow label={t('ui.node.structuredCurrentPhaseKind')} value={runtime.currentPhaseKind} />
          ) : null}
          {runtime.waitDetail || runtime.lastDetail ? (
            <RuntimeRow label={t('ui.node.structuredDetail')} value={runtime.waitDetail ?? runtime.lastDetail ?? ''} />
          ) : null}
        </Section>
      ) : null}

      <Section title={t('ui.node.structuredGeneral')}>
        <Field label={t('ui.node.structuredTitle')}>
          <input
            key={`flow-title:${flow.title ?? ''}`}
            className="nodrag"
            defaultValue={flow.title ?? ''}
            onBlur={(event) => patch({ title: trim(event.target.value) })}
            style={inputStyle}
          />
        </Field>

        <Field label={t('ui.node.structuredSyncMode')}>
          <select
            className="nodrag"
            value={flow.syncMode}
            onChange={(event) => patch({ syncMode: event.target.value as WorkflowManagedFlowContent['syncMode'] })}
            style={inputStyle}
          >
            {['managed', 'mirrored'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredEntryPhase')}>
          <select
            className="nodrag"
            value={normalizeManagedFlowEntry(flow.phases, flow.entryPhaseId) ?? ''}
            onChange={(event) => patch({ entryPhaseId: trim(event.target.value) })}
            style={inputStyle}
          >
            {flow.phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.id}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title={t('ui.node.structuredPhases')}>
        <div style={stackStyle}>
          {flow.phases.map((phase, index) => (
            <div key={`${phase.id}:${index}`} style={phaseCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={labelStyle}>
                  {t('ui.node.structuredPhaseKind')} {index + 1}
                </div>
                <button
                  type="button"
                  className="nodrag"
                  onClick={() => removePhase(index)}
                  style={{
                    ...buttonStyle,
                    opacity: flow.phases.length <= 1 ? 0.5 : 1,
                    cursor: flow.phases.length <= 1 ? 'not-allowed' : 'pointer',
                  }}
                  disabled={flow.phases.length <= 1}
                >
                  {t('ui.node.structuredRemovePhase')}
                </button>
              </div>

              <Field label={t('ui.node.structuredPhaseKind')}>
                <select
                  className="nodrag"
                  value={phase.kind}
                  onChange={(event) => {
                    const next = defaultManagedFlowPhase(
                      event.target.value as WorkflowManagedFlowPhase['kind'],
                      index,
                    );
                    updatePhase(index, {
                      ...next,
                      id: phase.id,
                      ...(phase.title ? { title: phase.title } : {}),
                    });
                  }}
                  style={inputStyle}
                >
                  {managedPhaseKinds.map((value) => (
                    <option key={value} value={value}>
                      {formatOption(value)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t('ui.node.structuredPhaseId')}>
                <input
                  key={`phase-id:${index}:${phase.id}`}
                  className="nodrag"
                  defaultValue={phase.id}
                  onBlur={(event) => {
                    const value = trim(event.target.value);
                    if (!value) return;
                    updatePhase(index, { ...phase, id: value });
                  }}
                  style={inputStyle}
                />
              </Field>

              <Field label={t('ui.node.structuredTitle')}>
                <input
                  key={`phase-title:${index}:${phase.title ?? ''}`}
                  className="nodrag"
                  defaultValue={phase.title ?? ''}
                  onBlur={(event) => updatePhase(index, { ...phase, title: trim(event.target.value) })}
                  style={inputStyle}
                />
              </Field>

              {'nodeId' in phase ? (
                <Field label={t('ui.node.structuredNodeId')}>
                  <input
                    key={`phase-node:${index}:${phase.nodeId}`}
                    className="nodrag"
                    defaultValue={phase.nodeId}
                    onBlur={(event) => {
                      const value = trim(event.target.value);
                      if (!value) return;
                      updatePhase(index, { ...phase, nodeId: value });
                    }}
                    style={inputStyle}
                  />
                </Field>
              ) : null}

              {phase.kind === 'loop_phase' ? (
                <label style={toggleLabelStyle}>
                  <input
                    type="checkbox"
                    checked={phase.forceRestart === true}
                    onChange={(event) => updatePhase(index, { ...phase, forceRestart: event.target.checked || undefined })}
                  />
                  {t('ui.node.structuredForceRestart')}
                </label>
              ) : null}

              {phase.kind === 'agent_phase' || phase.kind === 'runtime_verify_phase' ? (
                <>
                  <Field label={t('ui.node.structuredValidatorNodeId')}>
                    <input
                      key={`phase-validator:${index}:${phase.validatorNodeId ?? ''}`}
                      className="nodrag"
                      defaultValue={phase.validatorNodeId ?? ''}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          validatorNodeId: trim(event.target.value),
                        })
                      }
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredExpectedOutputs')}>
                    <textarea
                      key={`phase-outputs:${index}:${phase.expectedOutputs.join('\n')}`}
                      className="nodrag nowheel"
                      defaultValue={phase.expectedOutputs.join('\n')}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          expectedOutputs: lines(event.target.value),
                        })
                      }
                      style={textareaStyle}
                    />
                  </Field>

                  <label style={toggleLabelStyle}>
                    <input
                      type="checkbox"
                      checked={phase.newExecution === true}
                      onChange={(event) =>
                        updatePhase(index, {
                          ...phase,
                          newExecution: event.target.checked || undefined,
                        })
                      }
                    />
                    {t('ui.node.structuredExecutionNew')}
                  </label>
                </>
              ) : null}

              {phase.kind === 'validation_phase' ? (
                <>
                  <Field label={t('ui.node.structuredValidatorNodeId')}>
                    <input
                      key={`phase-validation:${index}:${phase.validatorNodeId}`}
                      className="nodrag"
                      defaultValue={phase.validatorNodeId}
                      onBlur={(event) => {
                        const value = trim(event.target.value);
                        if (!value) return;
                        updatePhase(index, {
                          ...phase,
                          validatorNodeId: value,
                        });
                      }}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredSourceNodeId')}>
                    <input
                      key={`phase-source:${index}:${phase.sourceNodeId ?? ''}`}
                      className="nodrag"
                      defaultValue={phase.sourceNodeId ?? ''}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          sourceNodeId: trim(event.target.value),
                        })
                      }
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredExpectedOutputs')}>
                    <textarea
                      key={`phase-validation-outputs:${index}:${phase.expectedOutputs.join('\n')}`}
                      className="nodrag nowheel"
                      defaultValue={phase.expectedOutputs.join('\n')}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          expectedOutputs: lines(event.target.value),
                        })
                      }
                      style={textareaStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredPassDetail')}>
                    <input
                      key={`phase-pass-detail:${index}:${phase.passDetail ?? ''}`}
                      className="nodrag"
                      defaultValue={phase.passDetail ?? ''}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          passDetail: trim(event.target.value),
                        })
                      }
                      style={inputStyle}
                    />
                  </Field>
                </>
              ) : null}

              {phase.kind === 'derive_input_phase' ? (
                <>
                  <Field label={t('ui.node.structuredSourceNodeId')}>
                    <input
                      key={`phase-derive-source:${index}:${phase.sourceNodeId}`}
                      className="nodrag"
                      defaultValue={phase.sourceNodeId}
                      onBlur={(event) => {
                        const value = trim(event.target.value);
                        if (!value) return;
                        updatePhase(index, {
                          ...phase,
                          sourceNodeId: value,
                        });
                      }}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredTargetTemplateNodeId')}>
                    <input
                      key={`phase-template:${index}:${phase.targetTemplateNodeId}`}
                      className="nodrag"
                      defaultValue={phase.targetTemplateNodeId}
                      onBlur={(event) => {
                        const value = trim(event.target.value);
                        if (!value) return;
                        updatePhase(index, {
                          ...phase,
                          targetTemplateNodeId: value,
                        });
                      }}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredPath')}>
                    <input
                      key={`phase-json-path:${index}:${phase.jsonPath}`}
                      className="nodrag"
                      defaultValue={phase.jsonPath}
                      onBlur={(event) => {
                        const value = trim(event.target.value);
                        if (!value) return;
                        updatePhase(index, {
                          ...phase,
                          jsonPath: value,
                        });
                      }}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredSummaryPath')}>
                    <input
                      key={`phase-summary-path:${index}:${phase.summaryPath ?? ''}`}
                      className="nodrag"
                      defaultValue={phase.summaryPath ?? ''}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          summaryPath: trim(event.target.value),
                        })
                      }
                      style={inputStyle}
                    />
                  </Field>

                  <Field label={t('ui.node.structuredRestartPhaseId')}>
                    <input
                      key={`phase-restart:${index}:${phase.restartPhaseId ?? ''}`}
                      className="nodrag"
                      defaultValue={phase.restartPhaseId ?? ''}
                      onBlur={(event) =>
                        updatePhase(index, {
                          ...phase,
                          restartPhaseId: trim(event.target.value),
                        })
                      }
                      style={inputStyle}
                    />
                  </Field>
                </>
              ) : null}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="nodrag"
          onClick={addPhase}
          style={buttonStyle}
        >
          {t('ui.node.structuredAddPhase')}
        </button>
      </Section>
    </div>
  );
}
