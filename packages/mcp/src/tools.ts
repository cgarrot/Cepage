import type { JsonSchema } from '@cepage/shared-core';
import type { SkillRun, WorkflowSkill } from '@cepage/sdk';

// Pure helpers that convert Cepage skills into MCP tool definitions. They
// have no I/O so they can be unit-tested in isolation.

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// MCP tool names must match /^[a-zA-Z0-9_-]+$/. Cepage slugs already fit
// that charset when we go hyphen → underscore. We prefix with `cepage_` to
// keep tools namespaced inside the host application.
export function skillToToolName(slug: string): string {
  const safe = slug.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/-/g, '_');
  return `cepage_${safe}`.slice(0, 64);
}

export function toolNameToSlug(toolName: string): string {
  const trimmed = toolName.startsWith('cepage_')
    ? toolName.slice('cepage_'.length)
    : toolName;
  return trimmed.replace(/_/g, '-');
}

// Build an MCP tool from a Cepage skill. Skills without an inputsSchema
// still surface as tools (the model is free to pass any JSON object) but
// the description calls that out explicitly.
export function skillToTool(skill: WorkflowSkill): McpToolDefinition {
  const inputSchema = sanitizeSchemaForMcp(skill.inputsSchema);
  const descriptionBits = [skill.title, skill.summary].filter(Boolean);
  if (!skill.inputsSchema || Object.keys(inputSchema).length === 0) {
    descriptionBits.push('(no typed inputs; passes the raw JSON object through)');
  }
  const description = descriptionBits.join(' — ');
  return {
    name: skillToToolName(skill.id),
    description: description.slice(0, 1024),
    inputSchema,
  };
}

// Some MCP clients (Cursor, Codex) are picky about JSON Schema shape:
//   - The root must be an object schema.
//   - Extension keywords starting with `x-` are sometimes rejected.
//
// We keep the behavior safe by stripping known-problematic extensions and
// forcing an empty object schema when none is declared.
export function sanitizeSchemaForMcp(schema: JsonSchema | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  const clone = clonePlain(schema);
  stripExtensionKeys(clone);
  if (!clone.type) clone.type = 'object';
  if (clone.type === 'object' && !('properties' in clone)) {
    clone.properties = {};
  }
  return clone;
}

// Render the outputs of a skill run as the `content` field expected by an
// MCP tools/call response. We prefer compact JSON and cap the length so a
// huge payload doesn't blow up the MCP client.
export function runToToolResult(run: SkillRun): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  if (run.status === 'succeeded') {
    const serialized = safeJsonStringify(run.outputs ?? {});
    return {
      content: [
        { type: 'text', text: truncate(serialized, 32_000) },
      ],
    };
  }
  if (run.status === 'cancelled') {
    return {
      content: [{ type: 'text', text: `Cepage run ${run.id} was cancelled.` }],
      isError: true,
    };
  }
  const err = run.error ?? { code: 'UNKNOWN', message: `Run finished with status ${run.status}` };
  return {
    content: [
      {
        type: 'text',
        text: `Cepage run ${run.id} ${run.status} (${err.code}): ${err.message}`,
      },
    ],
    isError: true,
  };
}

// Some skills have no `inputsSchema` yet (filesystem-defined workflow
// templates where the catalog entry is just a prompt). The MCP spec still
// wants a JSON Schema, so we emit a permissive "any object" schema.
export function hasTypedInputs(skill: WorkflowSkill): boolean {
  const schema = skill.inputsSchema;
  if (!schema || typeof schema !== 'object') return false;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  return !!props && Object.keys(props).length > 0;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function clonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripExtensionKeys(obj: Record<string, unknown>, depth = 0): void {
  if (depth > 16) return;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('x-')) {
      delete obj[key];
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      stripExtensionKeys(value as Record<string, unknown>, depth + 1);
    }
  }
}
