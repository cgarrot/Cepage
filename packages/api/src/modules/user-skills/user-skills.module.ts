import { Module, forwardRef } from '@nestjs/common';
import { WorkflowSkillsModule } from '../workflow-skills/workflow-skills.module';
import { UserSkillsController } from './user-skills.controller';
import { UserSkillsService } from './user-skills.service';

@Module({
  imports: [forwardRef(() => WorkflowSkillsModule)],
  controllers: [UserSkillsController],
  providers: [UserSkillsService],
  exports: [UserSkillsService],
})
export class UserSkillsModule {}
