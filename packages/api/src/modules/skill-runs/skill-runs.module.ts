import { Module } from '@nestjs/common';
import { SessionFromSkillModule } from '../session-from-skill/session-from-skill.module';
import { WorkflowSkillsModule } from '../workflow-skills/workflow-skills.module';
import {
  SkillRunsBySkillController,
  SkillRunsController,
} from './skill-runs.controller';
import { SkillRunsRateLimitGuard } from './skill-runs-rate-limit.guard';
import { SkillRunsService } from './skill-runs.service';

@Module({
  imports: [WorkflowSkillsModule, SessionFromSkillModule],
  controllers: [SkillRunsBySkillController, SkillRunsController],
  providers: [SkillRunsService, SkillRunsRateLimitGuard],
  exports: [SkillRunsService],
})
export class SkillRunsModule {}
