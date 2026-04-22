import { BadRequestException, Injectable } from '@nestjs/common';
import type { GraphNode, GraphSnapshot, JsonSchema } from '@cepage/shared-core';
import { GraphService } from '../graph/graph.service';
import { UserSkillsService } from '../user-skills/user-skills.service';
import { toSlug } from '../../common/utils/slug.util';
import type { SaveAsSkillDto, DetectInputsResult } from './skill-authoring.dto';
import type { UserSkillRow } from '../user-skills/user-skills.dto';

// "Save as skill" authoring workflow.
//
//   - detectInputs(): inspects the session's graph, extracts prompt text
//     from agent_step / workflow_input / control nodes, finds `{{VAR}}`
//     placeholders, and returns a suggested inputsSchema + outputsSchema.
//     No DB writes. Safe to call on demand from the UI.
//
//   - saveAsSkill(): runs detectInputs(), lets the client override any
//     field (slug, schemas, title, …), persists a UserSkill, and returns
//     the new row. The resulting slug is then visible in the unified
//     catalog (thanks to WorkflowSkillsService.getCatalog merge).
//
// LLM-based type inference is optional and slots in later — the regex
// path alone gives a usable schema out of the box.

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function inferSchema(name: string): { type: string; format?: string; writeOnly?: boolean; items?: JsonSchema } {
  const lower = name.toLowerCase();
  if (lower.includes('date')) return { type: 'string', format: 'date' };
  if (lower.includes('url') || lower.includes('endpoint')) return { type: 'string', format: 'uri' };
  if (lower.includes('key') || lower.includes('secret') || lower.includes('token') || lower.includes('password') || lower.includes('api_key')) {
    return { type: 'string', format: 'password', writeOnly: true };
  }
  if (/^(is|has|include|enable)/i.test(name)) return { type: 'boolean' };
  if (lower.endsWith('s') || lower.includes('list')) return { type: 'array', items: { type: 'string' } };
  return { type: 'string' };
}

@Injectable()
export class SkillAuthoringService {
  constructor(
    private readonly graph: GraphService,
    private readonly userSkills: UserSkillsService,
  ) {}

  async detectInputs(sessionId: string): Promise<DetectInputsResult> {
    const snap = await this.graph.loadSnapshot(sessionId);
    const extracted = this.extractText(snap);
    const occurrences = new Map<string, number>();
    const hints = new Map<string, string>();

    for (const { text, hint } of extracted) {
      PLACEHOLDER_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PLACEHOLDER_RE.exec(text)) != null) {
        const name = match[1];
        occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
        if (hint && !hints.has(name)) hints.set(name, hint);
      }
    }

    const detected = Array.from(occurrences.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => {
        const inferred = inferSchema(name);
        return {
          name,
          occurrences: count,
          inferredType: inferred.type,
          hint: hints.get(name),
        };
      });

    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const entry of detected) {
      const title = entry.name.replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) =>
        c.toUpperCase(),
      );
      const inferred = inferSchema(entry.name);
      properties[entry.name] = {
        ...inferred,
        title,
        description: entry.hint ?? `Value substituted for {{${entry.name}}}`,
      };
      required.push(entry.name);
    }

    const inputsSchema: JsonSchema = detected.length
      ? {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        }
      : {
          type: 'object',
          properties: {},
          additionalProperties: false,
        };

    const outputsSchema: JsonSchema = {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'ID of the session spawned to execute the skill.',
        },
        mode: {
          type: 'string',
          enum: ['workflow_transfer', 'copilot', 'empty'],
          description: 'Execution mode taken by the session bootstrapper.',
        },
        workspaceDir: {
          type: 'string',
          description: 'Absolute path of the workspace directory, if any.',
          default: '',
        },
        flowId: { type: 'string' },
        flowStatus: { type: 'string' },
      },
      required: ['sessionId', 'mode'],
    };

    const promptText = extracted
      .filter((e) => e.kind === 'agent_step' || e.kind === 'control')
      .map((e) => e.text)
      .join('\n\n---\n\n') || null;

    return {
      sessionId,
      detected,
      inputsSchema,
      outputsSchema,
      promptText,
    };
  }

  async saveAsSkill(sessionId: string, body: SaveAsSkillDto): Promise<UserSkillRow> {
    const detection = await this.detectInputs(sessionId);
    const snap = await this.graph.loadSnapshot(sessionId);

    const slug = body.slug ?? toSlug(body.title);
    if (!slug) {
      throw new BadRequestException('SAVE_AS_SKILL_SLUG_EMPTY');
    }

    const inputsSchema = (body.inputsSchema ?? detection.inputsSchema) as Record<string, unknown>;
    const outputsSchema = (body.outputsSchema ?? detection.outputsSchema) as Record<string, unknown>;

    return this.userSkills.create({
      slug,
      title: body.title,
      summary: body.summary,
      icon: body.icon,
      category: body.category,
      tags: body.tags,
      inputsSchema,
      outputsSchema,
      kind: 'workflow_template',
      promptText: detection.promptText ?? undefined,
      graphJson: snap as unknown as Record<string, unknown>,
      execution: {
        mode: 'session',
        copilotFallback: true,
        autoRun: true,
      },
      sourceSessionId: sessionId,
      visibility: body.visibility ?? 'private',
    });
  }

  // ─── extraction ──────────────────────────────────────────────────────────

  private extractText(
    snap: GraphSnapshot,
  ): Array<{ kind: GraphNode['type'] | string; text: string; hint?: string }> {
    const out: Array<{ kind: string; text: string; hint?: string }> = [];
    for (const node of snap.nodes) {
      const bits = this.readContentStrings(node);
      for (const text of bits) {
        if (text.trim()) out.push({ kind: node.type, text, hint: this.readHint(node) });
      }
    }
    return out;
  }

  private readContentStrings(node: GraphNode): string[] {
    const parts: string[] = [];
    const content = node.content as Record<string, unknown> | undefined;
    if (!content) return parts;
    const pick = (value: unknown): void => {
      if (typeof value === 'string' && value.trim()) parts.push(value);
    };
    pick(content.text);
    pick(content.prompt);
    pick(content.instructions);
    pick(content.body);
    pick(content.summary);
    pick(content.label);
    const parts2 = content.parts;
    if (Array.isArray(parts2)) {
      for (const p of parts2) {
        if (p && typeof p === 'object' && 'text' in p) pick((p as { text?: unknown }).text);
      }
    }
    return parts;
  }

  private readHint(node: GraphNode): string | undefined {
    const content = node.content as Record<string, unknown> | undefined;
    if (!content) return undefined;
    const label = typeof content.label === 'string' ? content.label : undefined;
    const instructions = typeof content.instructions === 'string' ? content.instructions : undefined;
    return label ?? instructions;
  }
}
