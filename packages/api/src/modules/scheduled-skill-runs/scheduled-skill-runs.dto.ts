import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SessionFromSkillBodyDto } from '../session-from-skill/session-from-skill.dto';

// Generic recurring "create a session from a skill X" trigger.
// The `request` field is forwarded as-is to SessionFromSkillService.scaffold,
// so any skill in the catalog can be scheduled without cepage knowing
// anything about it.

export class CreateScheduledSkillRunDto {
  @IsString()
  @MinLength(1)
  skillId!: string;

  @IsString()
  @MinLength(1)
  cron!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionFromSkillBodyDto)
  request?: SessionFromSkillBodyDto;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateScheduledSkillRunDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  cron?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionFromSkillBodyDto)
  request?: SessionFromSkillBodyDto;

  @IsOptional()
  @IsIn(['active', 'paused'])
  status?: 'active' | 'paused';

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  resetSchedule?: boolean;
}

export type ScheduledSkillRunRow = {
  id: string;
  label: string | null;
  skillId: string;
  cron: string;
  request: SessionFromSkillBodyDto;
  status: 'active' | 'paused' | 'failed';
  nextRunAt: string;
  lastRunAt: string | null;
  lastSessionId: string | null;
  lastError: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
