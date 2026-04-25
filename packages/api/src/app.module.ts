import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './common/database/database.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { GraphModule } from './modules/graph/graph.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { ConnectorsModule } from './modules/connectors/connector.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AgentPolicyModule } from './modules/agent-policy/agent-policy.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { WorkflowCopilotModule } from './modules/workflow-copilot/workflow-copilot.module';
import { WorkflowSkillsModule } from './modules/workflow-skills/workflow-skills.module';
import { SessionFromSkillModule } from './modules/session-from-skill/session-from-skill.module';
import { ScheduledSkillRunsModule } from './modules/scheduled-skill-runs/scheduled-skill-runs.module';
import { UserSkillsModule } from './modules/user-skills/user-skills.module';
import { SkillRunsModule } from './modules/skill-runs/skill-runs.module';
import { SkillAuthoringModule } from './modules/skill-authoring/skill-authoring.module';
import { SkillCompilerModule } from './modules/skill-compiler/skill-compiler.module';
import { SessionAnalysisModule } from './modules/session-analysis/session-analysis.module';
import { SkillMiningModule } from './modules/skill-mining/skill-mining.module';
import { OpenapiModule } from './modules/openapi/openapi.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ValidationModule } from './common/validation/validation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '../../.env'),
        join(process.cwd(), '../../.env.local'),
        join(process.cwd(), '.env'),
      ],
    }),
    DatabaseModule,
    ValidationModule,
    CollaborationModule,
    GraphModule,
    SessionsModule,
    ConnectorsModule,
    ExecutionModule,
    AgentsModule,
    AgentPolicyModule,
    RuntimeModule,
    WorkflowSkillsModule,
    WorkflowCopilotModule,
    SessionFromSkillModule,
    ScheduledSkillRunsModule,
    UserSkillsModule,
    SkillRunsModule,
    SkillAuthoringModule,
    SkillCompilerModule,
    SessionAnalysisModule,
    SkillMiningModule,
    OpenapiModule,
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
