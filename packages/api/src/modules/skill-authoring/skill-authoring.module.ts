import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { UserSkillsModule } from '../user-skills/user-skills.module';
import { SkillAuthoringController } from './skill-authoring.controller';
import { SkillAuthoringService } from './skill-authoring.service';

@Module({
  imports: [GraphModule, UserSkillsModule],
  controllers: [SkillAuthoringController],
  providers: [SkillAuthoringService],
  exports: [SkillAuthoringService],
})
export class SkillAuthoringModule {}
