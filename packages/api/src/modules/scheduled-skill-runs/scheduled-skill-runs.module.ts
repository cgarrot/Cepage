import { Module } from '@nestjs/common';
import { SessionFromSkillModule } from '../session-from-skill/session-from-skill.module';
import { WorkflowSkillsModule } from '../workflow-skills/workflow-skills.module';
import { ScheduledSkillRunsController } from './scheduled-skill-runs.controller';
import { ScheduledSkillRunsService } from './scheduled-skill-runs.service';

@Module({
  imports: [SessionFromSkillModule, WorkflowSkillsModule],
  controllers: [ScheduledSkillRunsController],
  providers: [ScheduledSkillRunsService],
  exports: [ScheduledSkillRunsService],
})
export class ScheduledSkillRunsModule {}
