import type { JsonSchema } from '@cepage/shared-core';

export type SchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array';

export type ValidationError = {
  key: string;
  message: string;
};

const SUPPORTED_TYPES: SchemaType[] = ['string', 'number', 'integer', 'boolean', 'array'];

export function makePropertySchema(type: SchemaType): JsonSchema {
  const base: JsonSchema = { type };
  if (type === 'array') {
    base.items = { type: 'string' };
  }
  return base;
}

export function validateParameterSchema(schema: JsonSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  const seen = new Set<string>();

  for (const key of keys) {
    const trimmed = key.trim();
    if (!trimmed) {
      errors.push({ key, message: 'Parameter name cannot be empty.' });
      continue;
    }
    if (seen.has(trimmed)) {
      errors.push({ key, message: `Duplicate parameter name "${trimmed}".` });
    }
    seen.add(trimmed);

    const prop = props[key];
    const type = prop.type as string | undefined;
    if (type && !SUPPORTED_TYPES.includes(type as SchemaType)) {
      errors.push({ key, message: `Unsupported type "${type}".` });
    }

    if (prop.default !== undefined && type) {
      const valid = isDefaultValidForType(prop.default, type as SchemaType);
      if (!valid) {
        errors.push({ key, message: `Default value does not match type "${type}".` });
      }
    }
  }

  return errors;
}

function isDefaultValidForType(value: unknown, type: SchemaType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
}

export function renameProperty(
  schema: JsonSchema,
  oldKey: string,
  newKey: string,
): JsonSchema {
  if (oldKey === newKey) return schema;
  const props = schema.properties ?? {};
  if (newKey in props) return schema;
  const entries = Object.entries(props);
  const nextEntries = entries.map(([k, v]) => (k === oldKey ? [newKey, v] : [k, v]));
  const nextProps = Object.fromEntries(nextEntries);

  const required = schema.required ?? [];
  const nextRequired = required.map((r) => (r === oldKey ? newKey : r));

  return { ...schema, properties: nextProps, required: nextRequired };
}

export function updateProperty(
  schema: JsonSchema,
  key: string,
  patch: Partial<JsonSchema>,
): JsonSchema {
  const props = { ...schema.properties };
  props[key] = { ...props[key], ...patch };
  return { ...schema, properties: props };
}

export function changePropertyType(
  schema: JsonSchema,
  key: string,
  type: SchemaType,
): JsonSchema {
  const fresh = makePropertySchema(type);
  const existing = schema.properties?.[key];
  if (existing) {
    if (existing.title) fresh.title = existing.title;
    if (existing.description) fresh.description = existing.description;
  }
  const props = { ...schema.properties };
  props[key] = fresh;
  return { ...schema, properties: props };
}

export function removeProperty(schema: JsonSchema, key: string): JsonSchema {
  const props = { ...(schema.properties ?? {}) };
  delete props[key];
  const required = (schema.required ?? []).filter((r) => r !== key);
  return { ...schema, properties: props, required };
}

export function addProperty(schema: JsonSchema, key: string, type: SchemaType): JsonSchema {
  const props = { ...(schema.properties ?? {}) };
  props[key] = makePropertySchema(type);
  return { ...schema, properties: props };
}

export function toggleRequired(schema: JsonSchema, key: string): JsonSchema {
  const required = new Set(schema.required ?? []);
  if (required.has(key)) {
    required.delete(key);
  } else {
    required.add(key);
  }
  return { ...schema, required: Array.from(required) };
}

export function parseEnumInput(raw: string): unknown[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.split(',').map((s) => s.trim());
}

export function serializeEnumInput(values: unknown[] | undefined): string {
  if (!Array.isArray(values)) return '';
  return values.map((v) => String(v)).join(', ');
}
