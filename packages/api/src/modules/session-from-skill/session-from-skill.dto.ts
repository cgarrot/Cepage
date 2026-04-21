import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Generic DTOs for POST /api/v1/sessions/from-skill/:skillId.
//
// The endpoint is skill-agnostic: any skill registered in the workflow
// catalog can be used to bootstrap a fresh session. The body lets the
// caller (CLI, cron, UI button, external system) describe optional
// workspace placement, file/directory seeding, agent pinning, autoRun,
// and either an explicit workflow_transfer JSON or a copilot architect
// message — without cepage needing to know anything about the skill.

export class SessionFromSkillWorkspaceDto {
  @IsOptional()
  @IsString()
  parentDirectory?: string;

  @IsOptional()
  @IsString()
  directoryName?: string;
}

export class SessionFromSkillSeedFileDto {
  @IsString()
  @MinLength(1)
  path!: string;

  @IsString()
  content!: string;
}

export class SessionFromSkillSeedDirectoryDto {
  @IsString()
  @MinLength(1)
  source!: string;

  @IsString()
  @MinLength(1)
  destination!: string;
}

export class SessionFromSkillSeedDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionFromSkillSeedFileDto)
  files?: SessionFromSkillSeedFileDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionFromSkillSeedDirectoryDto)
  directories?: SessionFromSkillSeedDirectoryDto[];
}

export class SessionFromSkillAgentDto {
  @IsIn(['cursor_agent', 'opencode'])
  agentType!: 'cursor_agent' | 'opencode';

  @IsString()
  providerID!: string;

  @IsString()
  modelID!: string;
}

export class SessionFromSkillCopilotDto {
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @IsOptional()
  @IsBoolean()
  autoRun?: boolean;

  @IsOptional()
  @IsString()
  title?: string;
}

export class SessionFromSkillBodyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionFromSkillWorkspaceDto)
  workspace?: SessionFromSkillWorkspaceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionFromSkillSeedDto)
  seed?: SessionFromSkillSeedDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionFromSkillAgentDto)
  agent?: SessionFromSkillAgentDto;

  @IsOptional()
  @IsBoolean()
  autoRun?: boolean;

  // Free-form workflow_transfer JSON. Validated by GraphService.replaceWorkflow.
  @IsOptional()
  @IsObject()
  workflowTransfer?: unknown;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionFromSkillCopilotDto)
  copilot?: SessionFromSkillCopilotDto;
}

export type SessionFromSkillMode = 'workflow_transfer' | 'copilot' | 'empty';

export type SessionFromSkillResult = {
  sessionId: string;
  skillId: string;
  workspaceDir: string | null;
  mode: SessionFromSkillMode;
  threadId?: string;
  copilotMessageId?: string;
  flowNodeId?: string;
  flowId?: string;
  flowStatus?: string;
};
