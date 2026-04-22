import { Module, forwardRef } from '@nestjs/common';
import { UserSkillsModule } from '../user-skills/user-skills.module';
import { WorkflowSkillsController } from './workflow-skills.controller';
import { WorkflowSkillsService } from './workflow-skills.service';

@Module({
  imports: [forwardRef(() => UserSkillsModule)],
  controllers: [WorkflowSkillsController],
  providers: [WorkflowSkillsService],
  exports: [WorkflowSkillsService],
})
export class WorkflowSkillsModule {}
