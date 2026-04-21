import {
  readWorkflowControllerSummary,
  type WorkflowLoopContent,
  type WorkflowLoopSource,
} from '@cepage/shared-core';
import { useI18n } from '../I18nProvider';
import {
  chipStyle,
  Field,
  inputStyle,
  RuntimeRow,
  Section,
  stackStyle,
  textareaStyle,
} from './layout';
import {
  defaultSource,
  formatOption,
  lines,
  positive,
  readLooseWorkflowLoopContent,
  trim,
} from './normalize';
import type { StructuredNodeEditorProps } from './types';

export function LoopEditor({ raw, onPatch }: StructuredNodeEditorProps) {
  const { t } = useI18n();
  const loop = readLooseWorkflowLoopContent(raw.content);
  const controller = readWorkflowControllerSummary(raw.metadata);
  if (!loop) return null;

  const patch = (next: Partial<WorkflowLoopContent>) => {
    onPatch({ ...loop, ...next });
  };
  const patchSource = (next: WorkflowLoopSource) => {
    patch({ source: next });
  };

  const source = loop.source;
  const simpleList =
    source.kind === 'inline_list'
    && source.items.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');

  return (
    <div style={stackStyle}>
      {controller ? (
        <Section title={t('ui.node.structuredRuntime')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={chipStyle}>
              {t('ui.node.structuredStatus')}: {controller.status}
            </span>
            {controller.totalItems != null ? (
              <span style={chipStyle}>
                {t('ui.node.structuredProgress')}:{' '}
                {controller.currentIndex != null ? controller.currentIndex + 1 : 0}/{controller.totalItems}
              </span>
            ) : null}
          </div>
          {controller.currentItemLabel ? (
            <RuntimeRow label={t('ui.node.structuredCurrentItem')} value={controller.currentItemLabel} />
          ) : null}
          {controller.lastDecision ? (
            <RuntimeRow label={t('ui.node.structuredLastDecision')} value={controller.lastDecision} />
          ) : null}
        </Section>
      ) : null}

      <Section title={t('ui.node.structuredGeneral')}>
        <Field label={t('ui.node.structuredMode')}>
          <select
            className="nodrag"
            value={loop.mode}
            onChange={(event) => patch({ mode: event.target.value as WorkflowLoopContent['mode'] })}
            style={inputStyle}
          >
            {['for_each', 'while'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredItemLabel')}>
          <input
            key={`itemLabel:${loop.itemLabel ?? ''}`}
            className="nodrag"
            defaultValue={loop.itemLabel ?? ''}
            onBlur={(event) => patch({ itemLabel: trim(event.target.value) })}
            style={inputStyle}
          />
        </Field>

        <Field label={t('ui.node.structuredBodyNodeId')}>
          <input
            key={`body:${loop.bodyNodeId}`}
            className="nodrag"
            defaultValue={loop.bodyNodeId}
            onBlur={(event) => {
              const value = trim(event.target.value);
              if (!value) return;
              patch({ bodyNodeId: value });
            }}
            style={inputStyle}
          />
        </Field>

        <Field label={t('ui.node.structuredValidatorNodeId')}>
          <input
            key={`validator:${loop.validatorNodeId ?? ''}`}
            className="nodrag"
            defaultValue={loop.validatorNodeId ?? ''}
            onBlur={(event) => patch({ validatorNodeId: trim(event.target.value) })}
            style={inputStyle}
          />
        </Field>
      </Section>

      <Section title={t('ui.node.structuredSource')}>
        <Field label={t('ui.node.structuredSourceKind')}>
          <select
            className="nodrag"
            value={source.kind}
            onChange={(event) => patchSource(defaultSource(event.target.value as WorkflowLoopSource['kind']))}
            style={inputStyle}
          >
            {['input_parts', 'json_file', 'inline_list', 'future_source'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        {source.kind === 'input_parts' ? (
          <>
            <Field label={t('ui.node.structuredTemplateNodeId')}>
              <input
                key={`template:${source.templateNodeId}`}
                className="nodrag"
                defaultValue={source.templateNodeId}
                onBlur={(event) => patchSource({ ...source, templateNodeId: event.target.value.trim() })}
                style={inputStyle}
              />
            </Field>
            <Field label={t('ui.node.structuredBoundNodeId')}>
              <input
                key={`bound:${source.boundNodeId ?? ''}`}
                className="nodrag"
                defaultValue={source.boundNodeId ?? ''}
                onBlur={(event) => patchSource({ ...source, boundNodeId: trim(event.target.value) })}
                style={inputStyle}
              />
            </Field>
          </>
        ) : null}

        {source.kind === 'json_file' ? (
          <>
            <Field label={t('ui.node.structuredFileNodeId')}>
              <input
                key={`file:${source.fileNodeId ?? ''}`}
                className="nodrag"
                defaultValue={source.fileNodeId ?? ''}
                onBlur={(event) => patchSource({ ...source, fileNodeId: trim(event.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label={t('ui.node.structuredRelativePath')}>
              <input
                key={`path:${source.relativePath ?? ''}`}
                className="nodrag"
                defaultValue={source.relativePath ?? ''}
                onBlur={(event) => patchSource({ ...source, relativePath: trim(event.target.value) })}
                style={inputStyle}
              />
            </Field>
          </>
        ) : null}

        {source.kind === 'future_source' ? (
          <Field label={t('ui.node.structuredSourceKey')}>
            <input
              key={`sourceKey:${source.sourceKey}`}
              className="nodrag"
              defaultValue={source.sourceKey}
              onBlur={(event) => patchSource({ ...source, sourceKey: event.target.value.trim() })}
              style={inputStyle}
            />
          </Field>
        ) : null}

        {source.kind === 'inline_list' ? (
          simpleList ? (
            <Field label={t('ui.node.structuredInlineItems')}>
              <textarea
                key={`items:${source.items.join('\n')}`}
                className="nodrag nowheel"
                defaultValue={source.items.map(String).join('\n')}
                onBlur={(event) => {
                  const items = lines(event.target.value);
                  if (items.length === 0) return;
                  patchSource({ kind: 'inline_list', items });
                }}
                style={textareaStyle}
              />
            </Field>
          ) : (
            <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--z-node-hint-fg)' }}>
              {t('ui.node.structuredUseJsonHint')}
            </div>
          )
        ) : null}
      </Section>

      <Section title={t('ui.node.structuredExecution')}>
        <Field label={t('ui.node.structuredAdvancePolicy')}>
          <select
            className="nodrag"
            value={loop.advancePolicy}
            onChange={(event) =>
              patch({ advancePolicy: event.target.value as WorkflowLoopContent['advancePolicy'] })
            }
            style={inputStyle}
          >
            {['only_on_pass', 'always_advance'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredBlockedPolicy')}>
          <select
            className="nodrag"
            value={loop.blockedPolicy}
            onChange={(event) =>
              patch({ blockedPolicy: event.target.value as WorkflowLoopContent['blockedPolicy'] })
            }
            style={inputStyle}
          >
            {['pause_controller', 'request_human', 'skip_item', 'stop_controller'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredWithinItem')}>
          <select
            className="nodrag"
            value={loop.sessionPolicy.withinItem}
            onChange={(event) =>
              patch({
                sessionPolicy: {
                  ...loop.sessionPolicy,
                  withinItem: event.target.value as WorkflowLoopContent['sessionPolicy']['withinItem'],
                },
              })
            }
            style={inputStyle}
          >
            {['reuse_execution', 'new_execution'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredBetweenItems')}>
          <select
            className="nodrag"
            value={loop.sessionPolicy.betweenItems}
            onChange={(event) =>
              patch({
                sessionPolicy: {
                  ...loop.sessionPolicy,
                  betweenItems: event.target.value as WorkflowLoopContent['sessionPolicy']['betweenItems'],
                },
              })
            }
            style={inputStyle}
          >
            {['reuse_execution', 'new_execution'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredMaxAttempts')}>
          <input
            key={`attempts:${loop.maxAttemptsPerItem ?? ''}`}
            className="nodrag"
            defaultValue={loop.maxAttemptsPerItem ?? ''}
            inputMode="numeric"
            onBlur={(event) => patch({ maxAttemptsPerItem: positive(event.target.value) })}
            style={inputStyle}
          />
        </Field>

        <Field label={t('ui.node.structuredMaxIterations')}>
          <input
            key={`iterations:${loop.maxIterations ?? ''}`}
            className="nodrag"
            defaultValue={loop.maxIterations ?? ''}
            inputMode="numeric"
            onBlur={(event) => patch({ maxIterations: positive(event.target.value) })}
            style={inputStyle}
          />
        </Field>
      </Section>
    </div>
  );
}
