import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ok } from '@cepage/shared-core';
import { CompileSkillDto, DryRunDto, PreviewQueryDto } from './skill-compiler.dto';
import { CompilerService } from './compiler/compiler.service';
import { DryRunService } from './dry-run/dry-run.service';
import { SessionArchiveService, type UploadedSessionArchive } from './session-archive.service';
import { UserSkillsService } from '../user-skills/user-skills.service';

@Controller('skill-compiler')
export class SkillCompilerController {
  constructor(
    private readonly compiler: CompilerService,
    private readonly dryRunService: DryRunService,
    private readonly userSkillsService: UserSkillsService,
    private readonly sessionArchiveService: SessionArchiveService,
  ) {}

  @Post('compile')
  @UseInterceptors(FileInterceptor('sessionData', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async compile(@Body() body: CompileSkillDto, @UploadedFile() file?: UploadedSessionArchive) {
    const inputsSchema = parseOptionalJsonObject(body.inputsSchema);
    const prepared = file?.buffer
      ? await this.sessionArchiveService.prepareClaudeCodeArchive(file)
      : {
          sessionData: body.sessionData,
          cleanup: async () => {},
        };

    try {
      return ok(
        await this.compiler.compile({
          sessionId: body.sessionId,
          agentType: body.agentType,
          mode: body.mode,
          sessionData: prepared.sessionData,
          inputsSchema,
        }),
      );
    } finally {
      await prepared.cleanup();
    }
  }

  @Post('dry-run')
  async dryRun(@Body() body: DryRunDto) {
    const skill = await this.userSkillsService.getBySlug(body.skillId);
    const report = this.dryRunService.validate(skill, body.inputs, body.mode);
    return ok(report);
  }

  @Get('sessions/:sessionId/preview')
  async preview(@Param('sessionId') sessionId: string, @Query() query: PreviewQueryDto) {
    const result = await this.compiler.compile({
      sessionId,
      agentType: query.agentType || 'opencode',
      mode: 'draft',
      sessionData: query.sessionData,
    });
    return ok(result);
  }
}

function parseOptionalJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new BadRequestException('SKILL_COMPILER_INVALID_INPUTS_SCHEMA');
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined;
}
