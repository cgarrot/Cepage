import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { GraphModule } from '../graph/graph.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WorkflowCopilotModule } from '../workflow-copilot/workflow-copilot.module';
import { WorkflowSkillsModule } from '../workflow-skills/workflow-skills.module';
import { SessionFromSkillController } from './session-from-skill.controller';
import { SessionFromSkillService } from './session-from-skill.service';

@Module({
  imports: [SessionsModule, GraphModule, WorkflowSkillsModule, WorkflowCopilotModule, AgentsModule],
  controllers: [SessionFromSkillController],
  providers: [SessionFromSkillService],
  exports: [SessionFromSkillService],
})
export class SessionFromSkillModule {}
