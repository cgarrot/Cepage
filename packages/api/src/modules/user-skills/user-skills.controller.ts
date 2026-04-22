import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import {
  CreateUserSkillDto,
  UpdateUserSkillDto,
  ValidateUserSkillInputDto,
} from './user-skills.dto';
import { UserSkillsService } from './user-skills.service';

// DB-only CRUD for user-authored skills. Read/discovery remains the
// responsibility of WorkflowSkillsController (which merges DB + FS).
// Mounted under `/api/v1/skills` as the "write" surface for skills.

@Controller('skills')
export class UserSkillsController {
  constructor(private readonly service: UserSkillsService) {}

  @Get()
  async listUserSkills() {
    return ok(await this.service.list());
  }

  @Post()
  async create(@Body() body: CreateUserSkillDto) {
    return ok(await this.service.create(body));
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    return ok(await this.service.getBySlug(slug));
  }

  @Patch(':slug')
  async update(@Param('slug') slug: string, @Body() body: UpdateUserSkillDto) {
    return ok(await this.service.update(slug, body));
  }

  @Delete(':slug')
  async remove(@Param('slug') slug: string, @Query('hard') hard?: string) {
    return ok(await this.service.remove(slug, hard === 'true'));
  }

  @Post(':slug/versions')
  async createVersion(
    @Param('slug') slug: string,
    @Body() body: UpdateUserSkillDto & { nextVersion?: string },
  ) {
    const { nextVersion, ...rest } = body ?? {};
    return ok(await this.service.createVersion(slug, nextVersion ?? '1.0.1', rest));
  }

  @Get(':slug/versions')
  async listVersions(@Param('slug') slug: string) {
    return ok(await this.service.listVersions(slug));
  }

  @Post(':slug/validate')
  async validate(@Param('slug') slug: string, @Body() body: ValidateUserSkillInputDto) {
    return ok(await this.service.validateInputs(slug, body.inputs ?? {}));
  }
}
