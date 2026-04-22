import { Body, Controller, Param, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { SaveAsSkillDto } from './skill-authoring.dto';
import { SkillAuthoringService } from './skill-authoring.service';

// Endpoints that turn a live session into a reusable skill. Scoped under
// `/api/v1/sessions/:id/...` so it reads as "an operation on a session".

@Controller('sessions')
export class SkillAuthoringController {
  constructor(private readonly authoring: SkillAuthoringService) {}

  @Post(':sessionId/save-as-skill')
  async saveAsSkill(
    @Param('sessionId') sessionId: string,
    @Body() body: SaveAsSkillDto,
  ) {
    return ok(await this.authoring.saveAsSkill(sessionId, body));
  }

  @Post(':sessionId/detect-inputs')
  async detectInputs(@Param('sessionId') sessionId: string) {
    return ok(await this.authoring.detectInputs(sessionId));
  }
}
