import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { ValidCompilerAgentType } from '@cepage/shared-core';

export class CompileSkillDto {
  @IsString()
  sessionId!: string;

  @IsIn(['opencode', 'cursor_agent', 'claude_code'])
  agentType!: ValidCompilerAgentType;

  @IsIn(['draft', 'publish'])
  mode!: 'draft' | 'publish';

  @IsOptional()
  @IsString()
  sessionData?: string;

  @IsOptional()
  @IsObject()
  inputsSchema?: Record<string, unknown>;
}

export class DryRunDto {
  @IsString()
  skillId!: string;

  @IsObject()
  inputs!: Record<string, unknown>;

  @IsOptional()
  @IsIn(['strict', 'permissive'])
  mode?: 'strict' | 'permissive';
}

export class PreviewQueryDto {
  @IsOptional()
  @IsIn(['opencode', 'cursor_agent', 'claude_code'])
  agentType?: ValidCompilerAgentType;

  @IsOptional()
  @IsString()
  sessionData?: string;
}
