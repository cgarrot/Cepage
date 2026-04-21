import {
  type WorkflowDecisionValidatorContent,
  type WorkflowValidatorCheck,
} from '@cepage/shared-core';
import { useI18n } from '../I18nProvider';
import {
  buttonStyle,
  chipStyle,
  Field,
  inputStyle,
  labelStyle,
  Section,
  stackStyle,
  textareaStyle,
} from './layout';
import {
  defaultCheck,
  formatOption,
  lines,
  readLooseWorkflowDecisionValidatorContent,
} from './normalize';
import type { StructuredNodeEditorProps } from './types';

export function DecisionEditor({ raw, onPatch }: StructuredNodeEditorProps) {
  const { t } = useI18n();
  const decision = readLooseWorkflowDecisionValidatorContent(raw.content);
  if (!decision) return null;

  const patch = (next: Partial<WorkflowDecisionValidatorContent>) => {
    onPatch({ ...decision, ...next });
  };

  const updateCheck = (index: number, next: WorkflowValidatorCheck) => {
    patch({
      checks: decision.checks.map((check, current) => (current === index ? next : check)),
    });
  };

  return (
    <div style={stackStyle}>
      <Section title={t('ui.node.structuredValidation')}>
        <Field label={t('ui.node.structuredMode')}>
          <div style={chipStyle}>{decision.mode}</div>
        </Field>

        <Field label={t('ui.node.structuredPassAction')}>
          <select
            className="nodrag"
            value={decision.passAction}
            onChange={(event) =>
              patch({ passAction: event.target.value as WorkflowDecisionValidatorContent['passAction'] })
            }
            style={inputStyle}
          >
            {['pass', 'retry_same_item', 'retry_new_execution', 'block', 'request_human', 'complete'].map(
              (value) => (
                <option key={value} value={value}>
                  {formatOption(value)}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label={t('ui.node.structuredFailAction')}>
          <select
            className="nodrag"
            value={decision.failAction}
            onChange={(event) =>
              patch({ failAction: event.target.value as WorkflowDecisionValidatorContent['failAction'] })
            }
            style={inputStyle}
          >
            {['pass', 'retry_same_item', 'retry_new_execution', 'block', 'request_human', 'complete'].map(
              (value) => (
                <option key={value} value={value}>
                  {formatOption(value)}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label={t('ui.node.structuredBlockAction')}>
          <select
            className="nodrag"
            value={decision.blockAction}
            onChange={(event) =>
              patch({ blockAction: event.target.value as WorkflowDecisionValidatorContent['blockAction'] })
            }
            style={inputStyle}
          >
            {['pass', 'retry_same_item', 'retry_new_execution', 'block', 'request_human', 'complete'].map(
              (value) => (
                <option key={value} value={value}>
                  {formatOption(value)}
                </option>
              ),
            )}
          </select>
        </Field>
      </Section>

      <Section title={t('ui.node.structuredGeneral')}>
        <Field label={t('ui.node.structuredRequirements')}>
          <textarea
            key={`requirements:${decision.requirements.join('\n')}`}
            className="nodrag nowheel"
            defaultValue={decision.requirements.join('\n')}
            onBlur={(event) => patch({ requirements: lines(event.target.value) })}
            style={textareaStyle}
          />
        </Field>

        <Field label={t('ui.node.structuredEvidence')}>
          <textarea
            key={`evidence:${decision.evidenceFrom.join('\n')}`}
            className="nodrag nowheel"
            defaultValue={decision.evidenceFrom.join('\n')}
            onBlur={(event) => patch({ evidenceFrom: lines(event.target.value) })}
            style={textareaStyle}
          />
        </Field>
      </Section>

      <Section title={t('ui.node.structuredChecks')}>
        <div style={stackStyle}>
          {decision.checks.map((check, index) => (
            <div
              key={`${check.kind}:${index}`}
              style={{
                ...stackStyle,
                padding: 10,
                borderRadius: 10,
                border: '1px solid var(--z-node-hint-border)',
                background: 'var(--z-node-textarea-bg)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={labelStyle}>
                  {t('ui.node.structuredCheckKind')} {index + 1}
                </div>
                <button
                  type="button"
                  className="nodrag"
                  onClick={() => patch({ checks: decision.checks.filter((_, current) => current !== index) })}
                  style={buttonStyle}
                >
                  {t('ui.node.structuredRemoveCheck')}
                </button>
              </div>

              <Field label={t('ui.node.structuredCheckKind')}>
                <select
                  className="nodrag"
                  value={check.kind}
                  onChange={(event) =>
                    updateCheck(index, defaultCheck(event.target.value as WorkflowValidatorCheck['kind']))
                  }
                  style={inputStyle}
                >
                  {[
                    'path_exists',
                    'path_nonempty',
                    'file_contains',
                    'file_last_line_equals',
                    'json_array_nonempty',
                    'json_path_exists',
                    'json_path_nonempty',
                    'json_path_array_nonempty',
                  ].map((value) => (
                    <option key={value} value={value}>
                      {formatOption(value)}
                    </option>
                  ))}
                </select>
              </Field>

              {'path' in check ? (
                <Field label={t('ui.node.structuredPath')}>
                  <input
                    key={`check-path:${index}:${check.path}`}
                    className="nodrag"
                    defaultValue={check.path}
                    onBlur={(event) => updateCheck(index, { ...check, path: event.target.value.trim() })}
                    style={inputStyle}
                  />
                </Field>
              ) : null}

              {check.kind === 'file_contains' || check.kind === 'file_last_line_equals' ? (
                <Field label={t('ui.node.structuredText')}>
                  <input
                    key={`check-text:${index}:${check.text}`}
                    className="nodrag"
                    defaultValue={check.text}
                    onBlur={(event) => updateCheck(index, { ...check, text: event.target.value.trim() })}
                    style={inputStyle}
                  />
                </Field>
              ) : null}

              {check.kind === 'json_path_exists'
              || check.kind === 'json_path_nonempty'
              || check.kind === 'json_path_array_nonempty' ? (
                <Field label="JSON path">
                  <input
                    key={`check-json-path:${index}:${check.jsonPath}`}
                    className="nodrag"
                    defaultValue={check.jsonPath}
                    onBlur={(event) => updateCheck(index, { ...check, jsonPath: event.target.value.trim() })}
                    style={inputStyle}
                  />
                </Field>
                ) : null}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="nodrag"
          onClick={() => patch({ checks: [...decision.checks, defaultCheck('path_exists')] })}
          style={buttonStyle}
        >
          {t('ui.node.structuredAddCheck')}
        </button>
      </Section>
    </div>
  );
}
