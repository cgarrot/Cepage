import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type {
  JsonSchema,
  WorkflowSkill,
  WorkflowSkillSource,
  WorkflowSkillExecution,
} from '@cepage/shared-core';

// DTOs for DB-backed user skills. `inputsSchema` / `outputsSchema` are
// JSON Schema documents (validated at the service layer via ajv). See
// docs/product-plan/03-typed-skill-contract.md.

export class CreateUserSkillDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  summary!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsObject()
  inputsSchema!: Record<string, unknown>;

  @IsObject()
  outputsSchema!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  promptText?: string;

  @IsOptional()
  @IsObject()
  graphJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  execution?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  sourceSessionId?: string;

  @IsOptional()
  @IsIn(['private', 'workspace', 'public'])
  visibility?: 'private' | 'workspace' | 'public';
}

export class UpdateUserSkillDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  inputsSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  outputsSchema?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  promptText?: string;

  @IsOptional()
  @IsObject()
  graphJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  execution?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['private', 'workspace', 'public'])
  visibility?: 'private' | 'workspace' | 'public';

  @IsOptional()
  @IsBoolean()
  deprecated?: boolean;

  @IsOptional()
  @IsString()
  replacedBySlug?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class ValidateUserSkillInputDto {
  @IsObject()
  inputs!: Record<string, unknown>;
}

export type UserSkillRow = {
  id: string;
  slug: string;
  version: string;
  title: string;
  summary: string;
  icon: string | null;
  category: string | null;
  tags: string[];
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  kind: string;
  promptText: string | null;
  graphJson: Record<string, unknown> | null;
  execution: WorkflowSkillExecution | null;
  sourceSessionId: string | null;
  visibility: 'private' | 'workspace' | 'public';
  ownerKey: string;
  validated: boolean;
  deprecated: boolean;
  replacedBySlug: string | null;
  createdAt: string;
  updatedAt: string;
};

// View of a UserSkill row in the shape of the unified WorkflowSkill type.
// Used by the catalog-merge layer so downstream consumers (UI, SDK, MCP)
// see one homogeneous skill list.
export type UnifiedSkillView = WorkflowSkill & { source: WorkflowSkillSource };
