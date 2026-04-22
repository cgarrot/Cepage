import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CompileSkillDto {
  @IsString()
  sessionId!: string;

  @IsIn(['opencode', 'cursor'])
  agentType!: 'opencode' | 'cursor';

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
  @IsIn(['opencode', 'cursor'])
  agentType?: 'opencode' | 'cursor';

  @IsOptional()
  @IsString()
  sessionData?: string;
}
