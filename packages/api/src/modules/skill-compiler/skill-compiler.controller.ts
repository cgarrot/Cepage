import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { CompileSkillDto, DryRunDto, PreviewQueryDto } from './skill-compiler.dto';
import { CompilerService } from './compiler/compiler.service';
import { DryRunService } from './dry-run/dry-run.service';
import { UserSkillsService } from '../user-skills/user-skills.service';

@Controller('skill-compiler')
export class SkillCompilerController {
  constructor(
    private readonly compiler: CompilerService,
    private readonly dryRunService: DryRunService,
    private readonly userSkillsService: UserSkillsService,
  ) {}

  @Post('compile')
  async compile(@Body() body: CompileSkillDto) {
    return ok(
      await this.compiler.compile({
        sessionId: body.sessionId,
        agentType: body.agentType,
        mode: body.mode,
        sessionData: body.sessionData,
        inputsSchema: body.inputsSchema,
      }),
    );
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
