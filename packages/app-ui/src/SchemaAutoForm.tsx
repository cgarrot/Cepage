'use client';

import { useMemo, type CSSProperties } from 'react';
import type { JsonSchema } from '@cepage/shared-core';

// Minimal but reasonable JSON Schema auto-form. It supports the shapes the
// Save-as-skill wizard emits (string / number / integer / boolean / enum /
// array of primitives / object with flat properties). For anything more
// exotic we fall back to a raw JSON textarea so power users can still run
// the skill. The goal is to stay dependency-free: no @rjsf/* transitive
// churn and no React-Hook-Form — just typed controlled inputs wired to a
// single `onChange(value)`.

export type SchemaAutoFormProps = {
  schema: JsonSchema | null | undefined;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors?: Record<string, string | undefined>;
  disabled?: boolean;
  locale?: string;
};

export function SchemaAutoForm({
  schema,
  value,
  onChange,
  errors,
  disabled,
  locale = 'en',
}: SchemaAutoFormProps) {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const keys = Object.keys(properties);

  const isUnsupportedShape = useMemo(() => {
    if (!schema) return true;
    if (schema.type !== 'object' && schema.type !== undefined) return true;
    return false;
  }, [schema]);

  if (isUnsupportedShape) {
    return (
      <RawJsonField
        value={value}
        onChange={(next) => onChange((next ?? {}) as Record<string, unknown>)}
        disabled={disabled}
      />
    );
  }

  if (keys.length === 0) {
    return (
      <p style={{ color: 'var(--z-fg-muted)', fontSize: 13, margin: 0 }}>
        {locale === 'fr' ? 'Aucune entrée requise.' : 'No inputs required.'}
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {keys.map((key) => {
        const child = properties[key];
        return (
          <SchemaField
            key={key}
            name={key}
            schema={child}
            value={(value as Record<string, unknown>)[key]}
            isRequired={required.has(key)}
            error={errors?.[key]}
            disabled={disabled}
            onChange={(next) => {
              const copy = { ...(value as Record<string, unknown>) };
              if (next === undefined) delete copy[key];
              else copy[key] = next;
              onChange(copy);
            }}
          />
        );
      })}
    </div>
  );
}

type FieldProps = {
  name: string;
  schema: JsonSchema;
  value: unknown;
  isRequired: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (next: unknown) => void;
};

function SchemaField({ name, schema, value, isRequired, error, disabled, onChange }: FieldProps) {
  const title = schema.title ?? name;
  const description = schema.description;
  const labelNode = (
    <div>
      <label style={labelStyle}>
        {title}
        {isRequired ? <span style={{ color: 'var(--z-fg-status, #dc2626)' }}> *</span> : null}
      </label>
      {description ? <div style={helpStyle}>{description}</div> : null}
    </div>
  );

  const control = renderControl(schema, value, onChange, disabled);

  return (
    <div style={fieldStyle}>
      {labelNode}
      {control}
      {error ? <div style={errorStyle}>{error}</div> : null}
    </div>
  );
}

function renderControl(
  schema: JsonSchema,
  value: unknown,
  onChange: (next: unknown) => void,
  disabled: boolean | undefined,
) {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;

  if (enumValues) {
    const current = value === undefined || value === null ? '' : String(value);
    return (
      <select
        value={current}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const match = enumValues.find((v) => String(v) === raw);
          onChange(match ?? raw);
        }}
        style={inputStyle}
      >
        <option value="">—</option>
        {enumValues.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }

  const type = schema.type;

  if (type === 'boolean') {
    return (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{ color: 'var(--z-fg-muted)' }}>true / false</span>
      </label>
    );
  }

  if (type === 'integer' || type === 'number') {
    const asString = value === undefined || value === null ? '' : String(value);
    return (
      <input
        type="number"
        inputMode={type === 'integer' ? 'numeric' : 'decimal'}
        step={type === 'integer' ? 1 : 'any'}
        value={asString}
        disabled={disabled}
        min={schema.minimum}
        max={schema.maximum}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const num = type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
          if (Number.isNaN(num)) {
            onChange(raw);
          } else {
            onChange(num);
          }
        }}
        style={inputStyle}
      />
    );
  }

  if (type === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    const itemType = items?.type ?? 'string';
    // We only support arrays of primitives for now; anything else gets the raw
    // JSON fallback below.
    if (itemType === 'string' || itemType === 'integer' || itemType === 'number') {
      const asList = Array.isArray(value)
        ? (value as unknown[]).map((v) => (v === null || v === undefined ? '' : String(v))).join('\n')
        : '';
      return (
        <textarea
          value={asList}
          disabled={disabled}
          rows={3}
          placeholder={
            itemType === 'string' ? 'one value per line' : 'one number per line'
          }
          onChange={(e) => {
            const lines = e.target.value
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0);
            if (itemType === 'string') {
              onChange(lines);
            } else {
              const nums = lines.map((l) =>
                itemType === 'integer' ? parseInt(l, 10) : parseFloat(l),
              );
              onChange(nums);
            }
          }}
          style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}
        />
      );
    }
    return <RawJsonField value={value} onChange={onChange} disabled={disabled} />;
  }

  if (type === 'object') {
    return <RawJsonField value={value} onChange={onChange} disabled={disabled} />;
  }

  // Default: string. Multiline for longer fields, single-line otherwise.
  const isLong = typeof schema.maxLength === 'number' ? schema.maxLength > 120 : false;
  const current = value === undefined || value === null ? '' : String(value);
  if (isLong) {
    return (
      <textarea
        value={current}
        disabled={disabled}
        rows={4}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        style={inputStyle}
      />
    );
  }
  return (
    <input
      type="text"
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      style={inputStyle}
    />
  );
}

type RawProps = {
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
};

function RawJsonField({ value, onChange, disabled }: RawProps) {
  const text = useMemo(() => {
    if (value === undefined) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }, [value]);
  return (
    <textarea
      value={text}
      disabled={disabled}
      rows={6}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.trim() === '') {
          onChange(undefined);
          return;
        }
        try {
          onChange(JSON.parse(raw));
        } catch {
          onChange(raw);
        }
      }}
      style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}
    />
  );
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--z-fg)',
};

const helpStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-muted)',
  marginTop: 2,
};

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--z-border-input)',
  background: 'var(--z-input-bg)',
  color: 'var(--z-fg)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--z-fg-status, #dc2626)',
};
