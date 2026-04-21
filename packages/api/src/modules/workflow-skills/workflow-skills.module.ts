import { Module } from '@nestjs/common';
import { WorkflowSkillsController } from './workflow-skills.controller';
import { WorkflowSkillsService } from './workflow-skills.service';

@Module({
  controllers: [WorkflowSkillsController],
  providers: [WorkflowSkillsService],
  exports: [WorkflowSkillsService],
})
export class WorkflowSkillsModule {}
