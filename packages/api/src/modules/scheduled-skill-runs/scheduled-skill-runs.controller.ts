import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import {
  CreateScheduledSkillRunDto,
  UpdateScheduledSkillRunDto,
} from './scheduled-skill-runs.dto';
import { ScheduledSkillRunsService } from './scheduled-skill-runs.service';

@Controller('scheduled-skill-runs')
export class ScheduledSkillRunsController {
  constructor(private readonly service: ScheduledSkillRunsService) {}

  @Get()
  async list() {
    return ok(await this.service.list());
  }

  @Post()
  async create(@Body() body: CreateScheduledSkillRunDto) {
    return ok(await this.service.create(body));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.service.get(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateScheduledSkillRunDto) {
    return ok(await this.service.update(id, body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.service.remove(id));
  }

  @Post(':id/run-now')
  async runNow(@Param('id') id: string) {
    return ok(await this.service.runNow(id));
  }
}
