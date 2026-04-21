import {
  applyNodeAgentSelection,
  agentTypeSchema,
  readNodeAgentSelection,
  readWorkflowSubgraphContent,
  type GraphNode,
  type WorkflowSubgraphContent,
} from '@cepage/shared-core';
import { useI18n } from '../I18nProvider';
import {
  buttonStyle,
  Field,
  inputStyle,
  labelStyle,
  Section,
  stackStyle,
  textareaStyle,
  toggleLabelStyle,
} from './layout';
import { bindingRows, type BindingRow, formatOption, lines, trim, writeBindingRows } from './normalize';
import type { StructuredNodeEditorProps } from './types';

export function SubgraphEditor({ raw, onPatch }: StructuredNodeEditorProps) {
  const { t } = useI18n();
  const subgraph = readWorkflowSubgraphContent(raw.content);
  if (!subgraph) return null;
  const nodeSelection = readNodeAgentSelection(subgraph);

  const patch = (next: Partial<WorkflowSubgraphContent>) => {
    onPatch({ ...subgraph, ...next });
  };
  const patchSelection = (
    next:
      | { mode: 'inherit' }
      | {
          mode: 'locked';
          selection: {
            type: NonNullable<WorkflowSubgraphContent['execution']['type']>;
            model?: WorkflowSubgraphContent['execution']['model'];
          };
        },
  ) => {
    onPatch(
      applyNodeAgentSelection('sub_graph', subgraph as GraphNode['content'], {
        mode: next.mode,
        ...('selection' in next ? { selection: next.selection } : {}),
      }),
    );
  };
  const rows = bindingRows(subgraph.inputMap);
  const patchRows = (next: BindingRow[]) => {
    patch({ inputMap: writeBindingRows(next) });
  };

  return (
    <div style={stackStyle}>
      <Section title={t('ui.node.structuredReference')}>
        <Field label={t('ui.node.structuredWorkflowRefKind')}>
          <select
            className="nodrag"
            value={subgraph.workflowRef.kind}
            onChange={(event) => {
              const kind = event.target.value as WorkflowSubgraphContent['workflowRef']['kind'];
              patch({
                workflowRef:
                  kind === 'library'
                    ? {
                        kind,
                        sessionId: subgraph.workflowRef.sessionId,
                        ...(subgraph.workflowRef.kind === 'library' && subgraph.workflowRef.versionTag
                          ? { versionTag: subgraph.workflowRef.versionTag }
                          : {}),
                      }
                    : {
                        kind,
                        sessionId: subgraph.workflowRef.sessionId,
                      },
              });
            }}
            style={inputStyle}
          >
            {['session', 'library'].map((value) => (
              <option key={value} value={value}>
                {formatOption(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('ui.node.structuredWorkflowId')}>
          <input
            key={`workflow:${subgraph.workflowRef.sessionId}`}
            className="nodrag"
            defaultValue={subgraph.workflowRef.sessionId}
            onBlur={(event) => {
              const value = trim(event.target.value);
              if (!value) return;
              patch({
                workflowRef:
                  subgraph.workflowRef.kind === 'library'
                    ? { ...subgraph.workflowRef, sessionId: value }
                    : { kind: 'session', sessionId: value },
              });
            }}
            style={inputStyle}
          />
        </Field>

        {subgraph.workflowRef.kind === 'library' ? (
          <Field label={t('ui.node.structuredVersionTag')}>
            <input
              key={`version:${subgraph.workflowRef.versionTag ?? ''}`}
              className="nodrag"
              defaultValue={subgraph.workflowRef.versionTag ?? ''}
              onBlur={(event) =>
                patch({
                  workflowRef:
                    subgraph.workflowRef.kind === 'library'
                      ? {
                          kind: 'library',
                          sessionId: subgraph.workflowRef.sessionId,
                          versionTag: trim(event.target.value),
                        }
                      : subgraph.workflowRef,
                })
              }
              style={inputStyle}
            />
          </Field>
        ) : null}

        <Field label={t('ui.node.structuredEntryNodeId')}>
          <input
            key={`entry:${subgraph.entryNodeId ?? ''}`}
            className="nodrag"
            defaultValue={subgraph.entryNodeId ?? ''}
            onBlur={(event) => patch({ entryNodeId: trim(event.target.value) })}
            style={inputStyle}
          />
        </Field>
      </Section>

      <Section title={t('ui.node.structuredBindings')}>
        <div style={stackStyle}>
          {rows.map((row, index) => (
            <div
              key={`${row.key}:${index}`}
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
                  {t('ui.node.structuredBindingKey')} {index + 1}
                </div>
                <button
                  type="button"
                  className="nodrag"
                  onClick={() => patchRows(rows.filter((_, current) => current !== index))}
                  style={buttonStyle}
                >
                  {t('ui.node.structuredRemoveBinding')}
                </button>
              </div>

              <Field label={t('ui.node.structuredBindingKey')}>
                <input
                  key={`binding-key:${index}:${row.key}`}
                  className="nodrag"
                  defaultValue={row.key}
                  onBlur={(event) => {
                    const value = trim(event.target.value);
                    if (!value) return;
                    patchRows(rows.map((entry, current) => (current === index ? { ...entry, key: value } : entry)));
                  }}
                  style={inputStyle}
                />
              </Field>

              <Field label={t('ui.node.structuredBindingTemplate')}>
                <textarea
                  key={`binding-template:${index}:${row.template}`}
                  className="nodrag nowheel"
                  defaultValue={row.template}
                  onBlur={(event) => {
                    const value = trim(event.target.value);
                    if (!value) return;
                    patchRows(
                      rows.map((entry, current) => (current === index ? { ...entry, template: value } : entry)),
                    );
                  }}
                  style={textareaStyle}
                />
              </Field>

              <Field label={t('ui.node.structuredBindingFormat')}>
                <select
                  className="nodrag"
                  value={row.format}
                  onChange={(event) =>
                    patchRows(
                      rows.map((entry, current) =>
                        current === index
                          ? { ...entry, format: event.target.value as BindingRow['format'] }
                          : entry,
                      ),
                    )
                  }
                  style={inputStyle}
                >
                  {['text', 'json'].map((value) => (
                    <option key={value} value={value}>
                      {formatOption(value)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="nodrag"
          onClick={() =>
            patchRows([
              ...rows,
              {
                key: `input_${rows.length + 1}`,
                template: '{{loop.item_text}}',
                format: 'text',
              },
            ])
          }
          style={buttonStyle}
        >
          {t('ui.node.structuredAddBinding')}
        </button>
      </Section>

      <Section title={t('ui.node.structuredExecution')}>
        <label style={toggleLabelStyle}>
          <input
            className="nodrag"
            type="checkbox"
            checked={Boolean(subgraph.execution.newExecution)}
            onChange={(event) =>
              patch({
                execution: {
                  ...subgraph.execution,
                  newExecution: event.target.checked || undefined,
                },
              })
            }
          />
          {t('ui.node.structuredExecutionNew')}
        </label>

        <Field label={t('ui.node.structuredExecutionType')}>
          <select
            className="nodrag"
            value={nodeSelection?.mode === 'locked' ? (nodeSelection.selection?.type ?? '') : ''}
            onChange={(event) => {
              const type = trim(event.target.value) as WorkflowSubgraphContent['execution']['type'];
              if (!type) {
                patchSelection({ mode: 'inherit' });
                return;
              }
              patchSelection({
                mode: 'locked',
                selection: {
                  type,
                  ...(nodeSelection?.selection?.model ?? subgraph.execution.model
                    ? { model: nodeSelection?.selection?.model ?? subgraph.execution.model }
                    : {}),
                },
              });
            }}
            style={inputStyle}
          >
            <option value="">{t('ui.node.structuredInherited')}</option>
            {agentTypeSchema.options.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title={t('ui.node.structuredOutputs')}>
        <Field label={t('ui.node.structuredExpectedOutputs')}>
          <textarea
            key={`outputs:${(subgraph.expectedOutputs ?? []).join('\n')}`}
            className="nodrag nowheel"
            defaultValue={(subgraph.expectedOutputs ?? []).join('\n')}
            onBlur={(event) => {
              const next = lines(event.target.value);
              patch({ expectedOutputs: next.length > 0 ? next : undefined });
            }}
            style={textareaStyle}
          />
        </Field>
      </Section>
    </div>
  );
}
