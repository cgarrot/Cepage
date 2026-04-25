#!/usr/bin/env node
/**
 * Generates typed per-skill wrappers from `.openapi-cache.json`.
 *
 * Usage:
 *   pnpm generate-skills
 *
 * Reads the cached OpenAPI spec and emits:
 *   src/generated/skills/index.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const specPath = process.env.CEPAGE_OPENAPI_PATH
  ? process.env.CEPAGE_OPENAPI_PATH
  : join(root, '.openapi-cache.json');
const outDir = join(root, 'src', 'generated', 'skills');
const outPath = join(outDir, 'index.ts');

interface SkillInfo {
  slug: string;
  pascalName: string;
  methodName: string;
  inputsSchema: unknown;
  outputsSchema: unknown;
}

async function main() {
  const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
  mkdirSync(outDir, { recursive: true });

  const skills = extractSkills(spec);
  if (skills.length === 0) {
    console.warn('No per-skill POST /skills/{slug}/runs endpoints found in the OpenAPI spec.');
    process.exit(0);
  }

  const parts: string[] = [];
  const methods: string[] = [];

  for (const skill of skills) {
    const inputsTs = await schemaToTs(skill.inputsSchema, spec, `${skill.pascalName}Inputs`);
    const outputsTs = await schemaToTs(skill.outputsSchema, spec, `${skill.pascalName}Outputs`);

    parts.push(`// --- ${skill.slug} ---`);
    parts.push(inputsTs);
    parts.push(outputsTs);

    methods.push(
      `  async run${skill.pascalName}(inputs: ${skill.pascalName}Inputs): Promise<TypedSkillRun<${skill.pascalName}Outputs>> {\n` +
        `    const run = await this.run('${skill.slug}', { inputs });\n` +
        `    return run as TypedSkillRun<${skill.pascalName}Outputs>;\n` +
        `  }`,
    );
  }

  const source =
    `// Auto-generated from .openapi-cache.json — do not edit manually.\n` +
    `import { SkillsResource } from '../../skills.js';\n` +
    `import type { SkillRun } from '../../types.js';\n\n` +
    `${parts.join('\n\n')}\n\n` +
    `export type TypedSkillRun<Outputs> = SkillRun & { outputs?: Outputs | null };\n\n` +
    `export class GeneratedSkillsResource extends SkillsResource {\n` +
    `${methods.join('\n')}\n` +
    `}\n`;

  writeFileSync(outPath, source, 'utf-8');
  console.log(`✅ Generated ${skills.length} skill wrapper(s) in ${outPath}`);
}

function extractSkills(spec: unknown): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const paths = (spec as any).paths || {};

  for (const [path, methods] of Object.entries(paths)) {
    const m = path.match(/^\/skills\/([^/]+)\/runs$/);
    if (!m) continue;
    const post = (methods as any).post;
    if (!post) continue;

    const slug = decodeURIComponent(m[1]);
    const pascalName = toPascalName(slug);
    const methodName = `run${pascalName}`;

    const requestBodySchema = post.requestBody?.content?.['application/json']?.schema;
    const inputsSchema = extractSchema(requestBodySchema?.properties?.inputs);

    const okResponse = post.responses?.['200']?.content?.['application/json']?.schema;
    let outputsProp: unknown = null;
    if (okResponse?.allOf) {
      for (const part of okResponse.allOf) {
        if (part?.properties?.outputs) {
          outputsProp = part.properties.outputs;
          break;
        }
      }
    } else {
      outputsProp = okResponse?.properties?.outputs;
    }
    const outputsSchema = extractSchema(outputsProp);

    skills.push({ slug, pascalName, methodName, inputsSchema, outputsSchema });
  }

  return skills;
}

function extractSchema(prop: unknown): unknown {
  if (!prop || typeof prop !== 'object') {
    return { type: 'object', additionalProperties: true, description: 'Untyped schema' };
  }
  const p = prop as any;
  if (p.$ref) return p;
  if (p.oneOf) {
    const nonNull = p.oneOf.find((s: any) => s && s.type !== 'null');
    if (nonNull) return nonNull;
    return p.oneOf[0] || p;
  }
  return p;
}

function toPascalName(slug: string): string {
  return slug
    .split(/[-_./]+/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

async function schemaToTs(
  schema: unknown,
  spec: unknown,
  interfaceName: string,
): Promise<string> {
  const components = (spec as any).components?.schemas || {};
  const inlined = inlineRefs(schema, components);
    const ts = await compile(inlined, interfaceName, {
      bannerComment: '',
      declareExternallyReferenced: false,
    });
    // Ensure generated interfaces satisfy `Record<string, unknown>` so they
    // can be passed to `SkillsResource.run<TInputs>()` which constrains
    // `TInputs extends Record<string, unknown>`.
    return ts.replace(/export interface (\w+) \{/g, 'export interface $1 extends Record<string, unknown> {');
}

function inlineRefs(schema: unknown, components: Record<string, unknown>): unknown {
  if (Array.isArray(schema)) {
    return schema.map((s) => inlineRefs(s, components));
  }
  if (schema && typeof schema === 'object') {
    const obj = schema as Record<string, unknown>;
    if (
      obj.$ref &&
      typeof obj.$ref === 'string' &&
      obj.$ref.startsWith('#/components/schemas/')
    ) {
      const refName = obj.$ref.replace('#/components/schemas/', '');
      const resolved = components[refName];
      if (!resolved) {
        throw new Error(`Unresolved $ref: ${obj.$ref}`);
      }
      return inlineRefs(JSON.parse(JSON.stringify(resolved)), components);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = inlineRefs(v, components);
    }
    return out;
  }
  return schema;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
