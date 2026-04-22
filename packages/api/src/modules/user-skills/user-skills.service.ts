import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  JsonSchema,
  WorkflowSkillExecution,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import { nullableJson, json } from '../../common/database/prisma-json';
import { isValidSlug, toSlug } from '../../common/utils/slug.util';
import {
  JsonSchemaValidatorService,
  type JsonSchemaValidationError,
} from '../../common/validation/json-schema-validator.service';
import { WorkflowSkillsService } from '../workflow-skills/workflow-skills.service';
import type {
  CreateUserSkillDto,
  UpdateUserSkillDto,
  UserSkillRow,
} from './user-skills.dto';

// DB-backed CRUD for user-authored skills. Core responsibilities:
//  - Enforce slug uniqueness (phase 1: global; phase 3: per-owner).
//  - Validate inputsSchema / outputsSchema are parseable JSON Schema via ajv.
//  - Provide read helpers that the workflow-skills service uses to merge
//    DB rows into the unified catalog.
//  - Expose a "validate inputs against my schema" helper for preview in UI.
//
// See docs/product-plan/03-typed-skill-contract.md.

type DbRow = {
  id: string;
  slug: string;
  version: string;
  title: string;
  summary: string;
  icon: string | null;
  category: string | null;
  tags: string[];
  inputsSchema: Prisma.JsonValue;
  outputsSchema: Prisma.JsonValue;
  kind: string;
  promptText: string | null;
  graphJson: Prisma.JsonValue | null;
  execution: Prisma.JsonValue | null;
  sourceSessionId: string | null;
  visibility: string;
  ownerKey: string;
  validated: boolean;
  deprecated: boolean;
  replacedBySlug: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_OWNER_KEY = 'local-user';

@Injectable()
export class UserSkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schemaValidator: JsonSchemaValidatorService,
    @Inject(forwardRef(() => WorkflowSkillsService))
    private readonly skillsCache: WorkflowSkillsService,
  ) {}

  private invalidateCatalogCache(): void {
    try {
      this.skillsCache.invalidate();
    } catch {
      // noop — forwardRef resolution might not be ready in rare edge cases
    }
  }

  async list(): Promise<UserSkillRow[]> {
    const rows = await this.prisma.userSkill.findMany({
      where: { deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async getBySlug(slug: string): Promise<UserSkillRow> {
    const row = await this.prisma.userSkill.findFirst({ where: { slug, deletedAt: null } });
    if (!row) throw new NotFoundException('USER_SKILL_NOT_FOUND');
    return this.serialize(row);
  }

  async create(input: CreateUserSkillDto, ownerKey: string = DEFAULT_OWNER_KEY): Promise<UserSkillRow> {
    this.assertSchemaIsValid(input.inputsSchema, 'inputsSchema');
    this.assertSchemaIsValid(input.outputsSchema, 'outputsSchema');

    const slug = this.normalizeSlug(input.slug ?? toSlug(input.title));
    const existing = await this.prisma.userSkill.findFirst({ where: { slug, deletedAt: null } });
    if (existing) {
      throw new ConflictException(`USER_SKILL_SLUG_TAKEN:${slug}`);
    }

    const created = await this.prisma.userSkill.create({
      data: {
        slug,
        version: '1.0.0',
        title: input.title.trim(),
        summary: input.summary.trim(),
        icon: input.icon ?? null,
        category: input.category ?? null,
        tags: Array.isArray(input.tags) ? input.tags : [],
        inputsSchema: json(input.inputsSchema),
        outputsSchema: json(input.outputsSchema),
        kind: input.kind ?? 'workflow_template',
        promptText: input.promptText ?? null,
        graphJson: nullableJson(input.graphJson),
        execution: nullableJson(input.execution),
        sourceSessionId: input.sourceSessionId ?? null,
        visibility: input.visibility ?? 'private',
        ownerKey,
        validated: false,
        deprecated: false,
      },
    });
    this.invalidateCatalogCache();
    return this.serialize(created);
  }

  async update(slug: string, patch: UpdateUserSkillDto): Promise<UserSkillRow> {
    const current = await this.prisma.userSkill.findFirst({ where: { slug, deletedAt: null } });
    if (!current) throw new NotFoundException('USER_SKILL_NOT_FOUND');

    if (patch.inputsSchema) this.assertSchemaIsValid(patch.inputsSchema, 'inputsSchema');
    if (patch.outputsSchema) this.assertSchemaIsValid(patch.outputsSchema, 'outputsSchema');

    const updated = await this.prisma.userSkill.update({
      where: { slug },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary.trim() } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.inputsSchema ? { inputsSchema: json(patch.inputsSchema) } : {}),
        ...(patch.outputsSchema ? { outputsSchema: json(patch.outputsSchema) } : {}),
        ...(patch.promptText !== undefined ? { promptText: patch.promptText } : {}),
        ...(patch.graphJson !== undefined ? { graphJson: nullableJson(patch.graphJson) } : {}),
        ...(patch.execution !== undefined ? { execution: nullableJson(patch.execution) } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.deprecated !== undefined ? { deprecated: patch.deprecated } : {}),
        ...(patch.replacedBySlug !== undefined ? { replacedBySlug: patch.replacedBySlug } : {}),
        ...(patch.version !== undefined ? { version: patch.version } : {}),
      },
    });
    this.schemaValidator.invalidate(`user:${slug}:inputs`);
    this.schemaValidator.invalidate(`user:${slug}:outputs`);
    this.invalidateCatalogCache();
    return this.serialize(updated);
  }

  async remove(slug: string, hard?: boolean): Promise<{ deleted: true }> {
    const current = await this.prisma.userSkill.findFirst({ where: { slug, deletedAt: null } });
    if (!current) throw new NotFoundException('USER_SKILL_NOT_FOUND');

    if (hard) {
      await this.prisma.userSkill.delete({ where: { slug } });
    } else {
      await this.prisma.userSkill.update({
        where: { slug },
        data: { deletedAt: new Date() },
      });
    }
    this.schemaValidator.invalidate(`user:${slug}:inputs`);
    this.schemaValidator.invalidate(`user:${slug}:outputs`);
    this.invalidateCatalogCache();
    return { deleted: true as const };
  }

  async createVersion(
    slug: string,
    nextVersion: string,
    patch: UpdateUserSkillDto,
  ): Promise<UserSkillRow> {
    if (!nextVersion.trim()) {
      throw new BadRequestException('USER_SKILL_VERSION_REQUIRED');
    }
    return this.update(slug, { ...patch, version: nextVersion.trim() });
  }

  async listVersions(
    slug: string,
  ): Promise<Array<{ version: string; createdAt: string; runCount: number }>> {
    const skill = await this.getBySlug(slug);

    const runs = await this.prisma.skillRun.findMany({
      where: { skillId: slug },
      orderBy: [{ createdAt: 'desc' }],
      select: { skillVersion: true, createdAt: true },
    });

    const versionMap = new Map<string, { version: string; createdAt: Date; count: number }>();

    versionMap.set(skill.version, {
      version: skill.version,
      createdAt: new Date(skill.createdAt),
      count: 0,
    });

    for (const run of runs) {
      const existing = versionMap.get(run.skillVersion);
      if (existing) {
        existing.count += 1;
      } else {
        versionMap.set(run.skillVersion, {
          version: run.skillVersion,
          createdAt: run.createdAt,
          count: 1,
        });
      }
    }

    return Array.from(versionMap.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((v) => ({
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        runCount: v.count,
      }));
  }

  async validateInputs(slug: string, inputs: unknown): Promise<{
    ok: boolean;
    errors: JsonSchemaValidationError[];
  }> {
    const row = await this.getBySlug(slug);
    const result = this.schemaValidator.validate(row.inputsSchema, inputs, `user:${slug}:inputs`);
    if (result.ok) return { ok: true, errors: [] };
    return { ok: false, errors: result.errors };
  }

  validateInputsWithSchema(schema: unknown, inputs: unknown, cacheKey?: string) {
    return this.schemaValidator.validate(schema, inputs, cacheKey);
  }

  private assertSchemaIsValid(schema: unknown, fieldName: string): void {
    try {
      // ajv throws on invalid schema shapes
      this.schemaValidator.validate(schema, {}, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`USER_SKILL_INVALID_${fieldName.toUpperCase()}:${message}`);
    }
  }

  private normalizeSlug(candidate: string): string {
    const normalized = toSlug(candidate);
    if (!isValidSlug(normalized)) {
      throw new BadRequestException(`USER_SKILL_INVALID_SLUG:${candidate}`);
    }
    return normalized;
  }

  private serialize(row: DbRow): UserSkillRow {
    return {
      id: row.id,
      slug: row.slug,
      version: row.version,
      title: row.title,
      summary: row.summary,
      icon: row.icon,
      category: row.category,
      tags: row.tags ?? [],
      inputsSchema: (row.inputsSchema ?? {}) as JsonSchema,
      outputsSchema: (row.outputsSchema ?? {}) as JsonSchema,
      kind: row.kind ?? 'workflow_template',
      promptText: row.promptText,
      graphJson: (row.graphJson as Record<string, unknown> | null) ?? null,
      execution: (row.execution as WorkflowSkillExecution | null) ?? null,
      sourceSessionId: row.sourceSessionId,
      visibility: (row.visibility as UserSkillRow['visibility']) ?? 'private',
      ownerKey: row.ownerKey ?? DEFAULT_OWNER_KEY,
      validated: row.validated,
      deprecated: row.deprecated,
      replacedBySlug: row.replacedBySlug,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
