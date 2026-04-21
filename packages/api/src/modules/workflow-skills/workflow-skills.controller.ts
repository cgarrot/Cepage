import { Controller, Get, Param } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { WorkflowSkillsService } from './workflow-skills.service';

@Controller('workflow-skills')
export class WorkflowSkillsController {
  constructor(private readonly skills: WorkflowSkillsService) {}

  @Get()
  async list() {
    return ok(await this.skills.getCatalog());
  }

  @Get(':skillId')
  async get(@Param('skillId') skillId: string) {
    return ok(await this.skills.getSkill(skillId));
  }
}
