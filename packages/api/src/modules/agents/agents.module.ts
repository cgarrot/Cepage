import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentArtifactsController } from './agent-artifacts.controller';
import { AgentPreviewController } from './agent-preview.controller';
import { AgentsService } from './agents.service';
import { GraphModule } from '../graph/graph.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { ActivityModule } from '../activity/activity.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { RunArtifactsService } from './run-artifacts.service';
import { PreviewRuntimeService } from './preview-runtime.service';
import { WorkflowRunController } from './workflow-run.controller';
import { InputStartController } from './input-start.controller';
import { WorkflowControllerController } from './workflow-controller.controller';
import { WorkflowControllerService } from './workflow-controller.service';
import { WorkflowManagedFlowController } from './workflow-managed-flow.controller';
import { WorkflowManagedFlowNotifierService } from './workflow-managed-flow-notifier.service';
import { WorkflowManagedFlowService } from './workflow-managed-flow.service';
import { AgentRecallService } from './agent-recall.service';

@Module({
  imports: [GraphModule, CollaborationModule, ActivityModule, RuntimeModule],
  controllers: [
    AgentsController,
    AgentArtifactsController,
    AgentPreviewController,
    WorkflowRunController,
    InputStartController,
    WorkflowControllerController,
    WorkflowManagedFlowController,
  ],
  providers: [
    AgentsService,
    RunArtifactsService,
    PreviewRuntimeService,
    AgentRecallService,
    WorkflowControllerService,
    WorkflowManagedFlowService,
    WorkflowManagedFlowNotifierService,
  ],
  exports: [
    AgentsService,
    AgentRecallService,
    RunArtifactsService,
    WorkflowControllerService,
    WorkflowManagedFlowService,
    WorkflowManagedFlowNotifierService,
  ],
})
export class AgentsModule {}
