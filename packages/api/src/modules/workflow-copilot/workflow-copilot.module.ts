import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AgentsModule } from '../agents/agents.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { GraphModule } from '../graph/graph.module';
import { WorkflowSkillsModule } from '../workflow-skills/workflow-skills.module';
import { WorkflowCopilotController } from './workflow-copilot.controller';
import { WorkflowCopilotService } from './workflow-copilot.service';

@Module({
  imports: [GraphModule, ActivityModule, CollaborationModule, AgentsModule, WorkflowSkillsModule],
  controllers: [WorkflowCopilotController],
  providers: [WorkflowCopilotService],
  exports: [WorkflowCopilotService],
})
export class WorkflowCopilotModule {}
