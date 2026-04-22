'use client';

import { useCallback, useMemo, type CSSProperties } from 'react';
import type { JsonSchema } from '@cepage/shared-core';
import { Input } from '@cepage/ui-kit';
import {
  type SchemaType,
  addProperty,
  changePropertyType,
  parseEnumInput,
  removeProperty,
  renameProperty,
  serializeEnumInput,
  toggleRequired,
  updateProperty,
  validateParameterSchema,
} from './parameter-editor-helpers.js';

export type { SchemaType };

export type ParameterEditorProps = {
  schema: JsonSchema;
  onChange: (schema: JsonSchema) => void;
};

const SUPPORTED_TYPES: SchemaType[] = ['string', 'number', 'integer', 'boolean', 'array'];

export function ParameterEditor({ schema, onChange }: ParameterEditorProps) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const keys = Object.keys(properties);
  const errors = useMemo(() => validateParameterSchema(schema), [schema]);
  const errorsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const err of errors) {
      const list = map.get(err.key) ?? [];
      list.push(err.message);
      map.set(err.key, list);
    }
    return map;
  }, [errors]);

  const handleRename = useCallback(
    (oldKey: string, newKey: string) => {
      onChange(renameProperty(schema, oldKey, newKey));
    },
    [schema, onChange],
  );

  const handleTypeChange = useCallback(
    (key: string, type: SchemaType) => {
      onChange(changePropertyType(schema, key, type));
    },
    [schema, onChange],
  );

  const handleRequiredToggle = useCallback(
    (key: string) => {
      onChange(toggleRequired(schema, key));
    },
    [schema, onChange],
  );

  const handleDefaultChange = useCallback(
    (key: string, value: unknown) => {
      onChange(updateProperty(schema, key, { default: value }));
    },
    [schema, onChange],
  );

  const handleDescriptionChange = useCallback(
    (key: string, description: string) => {
      onChange(updateProperty(schema, key, { description: description || undefined }));
    },
    [schema, onChange],
  );

  const handleEnumChange = useCallback(
    (key: string, raw: string) => {
      const enumValues = parseEnumInput(raw);
      onChange(updateProperty(schema, key, { enum: enumValues }));
    },
    [schema, onChange],
  );

  const handleRemove = useCallback(
    (key: string) => {
      onChange(removeProperty(schema, key));
    },
    [schema, onChange],
  );

  const handleAdd = useCallback(() => {
    let name = 'param';
    let counter = 1;
    while (properties[name]) {
      name = `param${counter}`;
      counter++;
    }
    onChange(addProperty(schema, name, 'string'));
  }, [schema, properties, onChange]);

  const handleArrayItemTypeChange = useCallback(
    (key: string, itemType: 'string' | 'number' | 'integer') => {
      onChange(updateProperty(schema, key, { items: { type: itemType } }));
    },
    [schema, onChange],
  );

  return (
    <div style={rootStyle}>
      <div style={{ display: 'grid', gap: 12 }}>
        {keys.map((key) => {
          const prop = properties[key];
          const type = (prop.type as SchemaType) ?? 'string';
          const isRequired = required.has(key);
          const keyErrors = errorsByKey.get(key) ?? [];

          return (
            <div key={key} style={rowStyle(keyErrors.length > 0)}>
              <div style={rowGridStyle}>
                <div style={cellStyle}>
                  <span style={fieldLabelStyle}>Name</span>
                  <Input
                    value={key}
                    onChange={(e) => handleRename(key, e.target.value)}
                    style={nameInputStyle}
                    placeholder="parameterName"
                  />
                </div>

                <div style={cellStyle}>
                  <span style={fieldLabelStyle}>Type</span>
                  <select
                    value={type}
                    onChange={(e) => handleTypeChange(key, e.target.value as SchemaType)}
                    style={selectStyle}
                  >
                    {SUPPORTED_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ ...cellStyle, justifyContent: 'flex-start', paddingTop: 20 }}>
                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={isRequired}
                      onChange={() => handleRequiredToggle(key)}
                    />
                    <span>Required</span>
                  </label>
                </div>

                <div style={{ ...cellStyle, justifyContent: 'flex-end', paddingTop: 18 }}>
                  <button
                    type="button"
                    onClick={() => handleRemove(key)}
                    style={removeBtnStyle}
                    title="Remove parameter"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div style={rowGridStyle2}>
                <div style={cellStyle}>
                  <span style={fieldLabelStyle}>Description</span>
                  <Input
                    value={prop.description ?? ''}
                    onChange={(e) => handleDescriptionChange(key, e.target.value)}
                    style={inputStyle}
                    placeholder="What does this parameter do?"
                  />
                </div>

                <div style={cellStyle}>
                  <span style={fieldLabelStyle}>Default</span>
                  <DefaultValueInput
                    type={type}
                    value={prop.default}
                    onChange={(v) => handleDefaultChange(key, v)}
                  />
                </div>

                {type !== 'boolean' && type !== 'array' ? (
                  <div style={cellStyle}>
                    <span style={fieldLabelStyle}>Enum (comma-separated)</span>
                    <Input
                      value={serializeEnumInput(prop.enum)}
                      onChange={(e) => handleEnumChange(key, e.target.value)}
                      style={inputStyle}
                      placeholder="value1, value2, value3"
                    />
                  </div>
                ) : null}

                {type === 'array' ? (
                  <div style={cellStyle}>
                    <span style={fieldLabelStyle}>Item type</span>
                    <select
                      value={(prop.items as JsonSchema | undefined)?.type ?? 'string'}
                      onChange={(e) =>
                        handleArrayItemTypeChange(
                          key,
                          e.target.value as 'string' | 'number' | 'integer',
                        )
                      }
                      style={selectStyle}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="integer">integer</option>
                    </select>
                  </div>
                ) : null}
              </div>

              {keyErrors.length > 0 ? (
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {keyErrors.map((msg) => (
                    <span key={msg} style={errorTextStyle}>
                      {msg}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {keys.length === 0 ? (
        <p style={{ color: 'var(--z-fg-muted)', fontSize: 13, margin: '12px 0' }}>
          No parameters defined yet.
        </p>
      ) : null}

      <button type="button" onClick={handleAdd} style={addBtnStyle}>
        + Add parameter
      </button>
    </div>
  );
}

function DefaultValueInput({
  type,
  value,
  onChange,
}: {
  type: SchemaType;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (type === 'boolean') {
    return (
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{String(Boolean(value))}</span>
      </label>
    );
  }

  if (type === 'number' || type === 'integer') {
    const asString = value === undefined || value === null ? '' : String(value);
    return (
      <Input
        type="number"
        inputMode={type === 'integer' ? 'numeric' : 'decimal'}
        step={type === 'integer' ? 1 : 'any'}
        value={asString}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const num = type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
          onChange(Number.isNaN(num) ? raw : num);
        }}
        style={inputStyle}
      />
    );
  }

  if (type === 'array') {
    const asString =
      value === undefined || value === null ? '' : JSON.stringify(value);
    return (
      <Input
        value={asString}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (!raw) {
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(raw));
          } catch {
            onChange(raw);
          }
        }}
        style={inputStyle}
        placeholder='["a", "b"]'
      />
    );
  }

  const current = value === undefined || value === null ? '' : String(value);
  return (
    <Input
      type="text"
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : v);
      }}
      style={inputStyle}
    />
  );
}

const rootStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const rowStyle = (hasError: boolean): CSSProperties => ({
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: `1px solid ${hasError ? 'var(--z-fg-status, #dc2626)' : 'var(--z-border-input)'}`,
  background: 'var(--z-surface-elevated, var(--z-input-bg))',
});

const rowGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr 120px 100px auto',
  gap: 10,
  alignItems: 'start',
};

const rowGridStyle2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 10,
  alignItems: 'start',
};

const cellStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  fontWeight: 500,
};

const nameInputStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
};

const inputStyle: CSSProperties = {
  width: '100%',
};

const selectStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  cursor: 'pointer',
};

const checkboxLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: 'var(--z-fg)',
  cursor: 'pointer',
};

const removeBtnStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--z-fg-status, #dc2626)',
  background: 'transparent',
  color: 'var(--z-fg-status, #dc2626)',
  fontSize: 12,
  cursor: 'pointer',
};

const addBtnStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px dashed var(--z-border-input)',
  background: 'transparent',
  color: 'var(--z-fg-muted)',
  fontSize: 13,
  cursor: 'pointer',
  width: 'fit-content',
};

const errorTextStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-status, #dc2626)',
};
