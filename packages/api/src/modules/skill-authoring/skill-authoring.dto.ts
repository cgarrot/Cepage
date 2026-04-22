import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { JsonSchema } from '@cepage/shared-core';

// Input for POST /api/v1/sessions/:id/save-as-skill. The body overrides
// values inferred from the session — everything is optional because the
// controller can infer most of them from the session graph.

export class SaveAsSkillDto {
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

  @IsOptional()
  @IsObject()
  inputsSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  outputsSchema?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['private', 'workspace', 'public'])
  visibility?: 'private' | 'workspace' | 'public';
}

export type DetectInputsResult = {
  sessionId: string;
  detected: Array<{
    name: string;
    occurrences: number;
    inferredType: string;
    hint?: string;
  }>;
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  promptText: string | null;
};
