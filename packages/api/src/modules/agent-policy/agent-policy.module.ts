import { Module, forwardRef } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AgentPolicyBootstrapService } from './agent-policy.bootstrap.service';
import { AgentPolicyController } from './agent-policy.controller';
import { AgentPolicyService } from './agent-policy.service';

@Module({
  imports: [forwardRef(() => AgentsModule)],
  controllers: [AgentPolicyController],
  providers: [AgentPolicyService, AgentPolicyBootstrapService],
  exports: [AgentPolicyService],
})
export class AgentPolicyModule {}
