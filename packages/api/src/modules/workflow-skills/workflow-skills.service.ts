import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  workflowSkillCatalogSchema,
  type WorkflowSkill,
  type WorkflowSkillCatalog,
  type WorkflowSkillKind,
  type WorkflowSkillRef,
} from '@cepage/shared-core';

type WorkflowSkillRoute = {
  skill: WorkflowSkill;
  confidence: number;
  matchedKeywords: string[];
};

type WorkflowCatalogSourceKind = 'private' | 'public' | 'extra';

type WorkflowCatalogSource = {
  catalogPath: string;
  baseDir: string;
  kind: WorkflowCatalogSourceKind;
};

const WORKFLOW_LIBRARY_RELATIVE_PATH = 'docs/workflow-prompt-library';
const PRIVATE_SKILL_ID_PREFIXES = ['private-'];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function partialScore(textTokens: Set<string>, phrase: string): number {
  const tokens = phrase.split(' ').filter(Boolean);
  if (tokens.length < 2) return 0;
  const hits = tokens.filter((token) => textTokens.has(token)).length;
  if (hits === tokens.length) return 0.85;
  if (hits >= 2) return hits / tokens.length;
  return 0;
}

function routeTerms(skill: WorkflowSkill): Array<{ value: string; weight: number }> {
  return [
    ...skill.routing.keywords.map((value) => ({ value, weight: 4 })),
    ...skill.routing.intents.map((value) => ({ value, weight: 4 })),
    ...skill.tags.map((value) => ({ value, weight: 2 })),
    { value: skill.id, weight: 2 },
    { value: skill.title, weight: 3 },
    { value: skill.summary, weight: 3 },
    ...skill.capabilities.map((value) => ({ value, weight: 3 })),
    ...skill.requiredInputs.map((value) => ({ value, weight: 2 })),
    ...skill.producedOutputs.map((value) => ({ value, weight: 1 })),
    ...skill.compositionHints.map((value) => ({ value, weight: 2 })),
    ...skill.simpleExamples.map((value) => ({ value, weight: 2 })),
    ...skill.defaultModules.flatMap((module) => [
      { value: module.title, weight: 2 },
      { value: module.summary, weight: 2 },
      { value: module.role, weight: 1 },
      ...module.requiredInputs.map((value) => ({ value, weight: 1 })),
      ...module.producedOutputs.map((value) => ({ value, weight: 1 })),
    ]),
  ];
}

function routeScore(skill: WorkflowSkill, content: string): WorkflowSkillRoute | null {
  const text = normalize(content);
  if (!text) return null;
  const textTokens = new Set(text.split(' ').filter(Boolean));
  const terms = routeTerms(skill)
    .map((entry) => ({ ...entry, value: entry.value.trim() }))
    .filter((entry) => Boolean(entry.value));
  if (terms.length === 0) return null;
  const matched: string[] = [];
  let score = 0;
  for (const term of terms) {
    const next = normalize(term.value);
    if (!next) continue;
    const factor = text.includes(next) ? 1 : partialScore(textTokens, next);
    if (factor <= 0) continue;
    matched.push(term.value);
    score += term.weight * factor;
  }
  if (matched.length === 0) return null;
  if (skill.validated) {
    score += 1.5;
  }
  if (skill.kind === 'workflow_template') {
    score += 1;
  }
  const confidence = Math.min(0.99, Math.max(0.2, score / 12));
  return {
    skill,
    confidence,
    matchedKeywords: matched,
  };
}

@Injectable()
export class WorkflowSkillsService {
  private cache: WorkflowSkillCatalog | null = null;
  private promptBaseDirs = new Map<string, string>();
  private privateCatalogMissing = false;

  private catalogRoots(): string[] {
    return [
      path.resolve(process.cwd(), WORKFLOW_LIBRARY_RELATIVE_PATH),
      path.resolve(process.cwd(), '../../', WORKFLOW_LIBRARY_RELATIVE_PATH),
    ];
  }

  private async resolveCatalogRoot(): Promise<string> {
    for (const candidate of this.catalogRoots()) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
    throw new NotFoundException('WORKFLOW_SKILLS_CATALOG_NOT_FOUND');
  }

  private async findCatalogFiles(rootDir: string): Promise<string[]> {
    const discovered: string[] = [];
    const entries = await fs.readdir(rootDir, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        discovered.push(...await this.findCatalogFiles(fullPath));
        continue;
      }
      if (entry.isFile() && entry.name === 'catalog.json') {
        discovered.push(fullPath);
      }
    }

    return discovered;
  }

  private extraCatalogEnvPaths(): string[] {
    return (process.env.WORKFLOW_SKILLS_EXTRA_PATHS ?? '')
      .split(',')
      .map((entry: string) => entry.trim())
      .filter(Boolean);
  }

  private async resolveExtraCatalogPath(rawPath: string): Promise<string | null> {
    if (!path.isAbsolute(rawPath)) {
      return null;
    }

    try {
      const stat = await fs.stat(rawPath);
      if (stat.isDirectory()) {
        const catalogPath = path.join(rawPath, 'catalog.json');
        const catalogStat = await fs.stat(catalogPath);
        return catalogStat.isFile() ? catalogPath : null;
      }
      if (stat.isFile() && rawPath.endsWith('.json')) {
        return rawPath;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async discoverCatalogSources(): Promise<WorkflowCatalogSource[]> {
    const rootDir = await this.resolveCatalogRoot();
    const rootCatalogs = await this.findCatalogFiles(rootDir);
    const publicSources: WorkflowCatalogSource[] = [];
    const privateSources: WorkflowCatalogSource[] = [];

    for (const catalogPath of [...rootCatalogs].sort((a, b) => a.localeCompare(b))) {
      const relativeCatalogPath = path.relative(rootDir, catalogPath);
      const source: WorkflowCatalogSource = {
        catalogPath,
        baseDir: path.dirname(catalogPath),
        kind: relativeCatalogPath === path.join('private', 'catalog.json')
          || relativeCatalogPath.startsWith(`private${path.sep}`)
          ? 'private'
          : 'public',
      };
      if (source.kind === 'private') {
        privateSources.push(source);
      } else {
        publicSources.push(source);
      }
    }

    const expectedPrivateCatalog = path.join(rootDir, 'private', 'catalog.json');
    this.privateCatalogMissing = !rootCatalogs.includes(expectedPrivateCatalog);
    if (this.privateCatalogMissing) {
      console.warn(`[workflow-skills] Optional private catalog missing at ${expectedPrivateCatalog}`);
    }

    const extraSources: WorkflowCatalogSource[] = [];
    for (const rawPath of this.extraCatalogEnvPaths()) {
      const catalogPath = await this.resolveExtraCatalogPath(rawPath);
      if (!catalogPath) {
        console.warn(`[workflow-skills] Ignoring invalid WORKFLOW_SKILLS_EXTRA_PATHS entry: ${rawPath}`);
        continue;
      }
      extraSources.push({
        catalogPath,
        baseDir: path.dirname(catalogPath),
        kind: 'extra',
      });
    }

    extraSources.sort((a, b) => a.catalogPath.localeCompare(b.catalogPath));
    return [...privateSources, ...publicSources, ...extraSources];
  }

  private async readCatalog(source: WorkflowCatalogSource): Promise<WorkflowSkillCatalog> {
    const raw = JSON.parse(await fs.readFile(source.catalogPath, 'utf8'));
    return workflowSkillCatalogSchema.parse(raw);
  }

  private isLikelyPrivateSkill(id: string): boolean {
    return PRIVATE_SKILL_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
  }

  async getCatalog(force = false): Promise<WorkflowSkillCatalog> {
    if (this.cache && !force) {
      return this.cache;
    }

    const sources = await this.discoverCatalogSources();

    const merged: WorkflowSkill[] = [];
    const seen = new Set<string>();
    this.promptBaseDirs = new Map<string, string>();

    let schemaVersion = '1';
    let generatedAt: string | undefined;

    for (const source of sources) {
      const catalog = await this.readCatalog(source);
      schemaVersion = catalog.schemaVersion;
      generatedAt ??= catalog.generatedAt;

      for (const skill of catalog.skills) {
        if (seen.has(skill.id)) {
          continue;
        }
        seen.add(skill.id);
        merged.push(skill);
        this.promptBaseDirs.set(skill.id, source.baseDir);
      }
    }

    const parsed = workflowSkillCatalogSchema.parse({
      schemaVersion,
      generatedAt,
      skills: merged,
    });
    this.cache = parsed;
    return parsed;
  }

  async listSkills(kinds?: WorkflowSkillKind[]): Promise<WorkflowSkill[]> {
    const catalog = await this.getCatalog();
    if (!kinds || kinds.length === 0) {
      return [...catalog.skills];
    }
    const allow = new Set(kinds);
    return catalog.skills.filter((skill) => allow.has(skill.kind));
  }

  async getSkill(id: string): Promise<WorkflowSkill> {
    const catalog = await this.getCatalog();
    const skill = catalog.skills.find((entry) => entry.id === id);
    if (!skill) {
      if (this.privateCatalogMissing && this.isLikelyPrivateSkill(id)) {
        throw new NotFoundException(`WORKFLOW_SKILL_PRIVATE_CATALOG_MISSING:${id}`);
      }
      throw new NotFoundException('WORKFLOW_SKILL_NOT_FOUND');
    }
    return skill;
  }

  async getSkillPrompt(skill: WorkflowSkill): Promise<string | null> {
    const promptFile = skill.promptFile ?? skill.prompt?.path;
    if (!promptFile) return null;
    const baseDir = this.promptBaseDirs.get(skill.id);
    if (!baseDir) {
      return null;
    }
    try {
      return await fs.readFile(path.join(baseDir, promptFile), 'utf8');
    } catch {
      return null;
    }
  }

  async routeSkill(
    content: string,
    kinds: WorkflowSkillKind[] = ['workflow_template'],
  ): Promise<WorkflowSkillRef | null> {
    const matches = await this.routeSkillCandidates(content, kinds, 2);
    const best = matches[0];
    const second = matches[1];
    if (!best || (best.confidence ?? 0) < 0.34) {
      return null;
    }
    if (second && (best.confidence ?? 0) - (second.confidence ?? 0) < 0.08 && (best.confidence ?? 0) < 0.72) {
      return null;
    }
    return best;
  }

  async routeSkillCandidates(
    content: string,
    kinds: WorkflowSkillKind[] = ['workflow_template'],
    limit = 3,
  ): Promise<WorkflowSkillRef[]> {
    const skills = await this.listSkills(kinds);
    return skills
      .map((skill) => routeScore(skill, content))
      .filter((entry): entry is WorkflowSkillRoute => Boolean(entry))
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.skill.title.localeCompare(b.skill.title);
      })
      .slice(0, Math.max(1, limit))
      .map((entry) => ({
        id: entry.skill.id,
        version: entry.skill.version,
        title: entry.skill.title,
        confidence: entry.confidence,
      }));
  }
}
