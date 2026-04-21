import { Body, Controller, Param, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { SessionFromSkillBodyDto } from './session-from-skill.dto';
import { SessionFromSkillService } from './session-from-skill.service';

@Controller('sessions/from-skill')
export class SessionFromSkillController {
  constructor(private readonly service: SessionFromSkillService) {}

  @Post(':skillId')
  async create(
    @Param('skillId') skillId: string,
    @Body() body: SessionFromSkillBodyDto,
  ) {
    return ok(await this.service.scaffold(skillId, body));
  }
}
