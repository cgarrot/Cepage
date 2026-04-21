import { Global, Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AgentsModule } from '../agents/agents.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { ConnectorsModule } from '../connectors/connector.module';
import { GraphModule } from '../graph/graph.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalService } from './approval.service';
import { BudgetPolicyService } from './budget-policy.service';
import {
  DaemonDispatchService,
  DaemonLocalhostGuard,
  DaemonProtocolController,
  DaemonRegistryService,
} from './daemon';
import { ExecutionOpsController } from './execution-ops.controller';
import { EvalService } from './eval.service';
import { ExecutionQueueService } from './execution-queue.service';
import { ExecutionWorkerService } from './execution-worker.service';
import { LeaseService } from './lease.service';
import { RecoveryService } from './recovery.service';
import { RunSupervisorService } from './run-supervisor.service';
import { SchedulerService } from './scheduler.service';
import { WatchSubscriptionService } from './watch-subscription.service';
import { WorkerRegistryService } from './worker-registry.service';
import { WorktreeService } from './worktree.service';

@Global()
@Module({
  imports: [
    GraphModule,
    ActivityModule,
    AgentsModule,
    RuntimeModule,
    ConnectorsModule,
    CollaborationModule,
  ],
  controllers: [ApprovalsController, DaemonProtocolController, ExecutionOpsController],
  providers: [
    ExecutionQueueService,
    WorkerRegistryService,
    RecoveryService,
    SchedulerService,
    WatchSubscriptionService,
    LeaseService,
    ApprovalService,
    BudgetPolicyService,
    WorktreeService,
    RunSupervisorService,
    EvalService,
    ExecutionWorkerService,
    DaemonRegistryService,
    DaemonDispatchService,
    DaemonLocalhostGuard,
  ],
  exports: [
    ExecutionQueueService,
    WorkerRegistryService,
    RecoveryService,
    SchedulerService,
    WatchSubscriptionService,
    LeaseService,
    ApprovalService,
    BudgetPolicyService,
    WorktreeService,
    RunSupervisorService,
    EvalService,
    DaemonRegistryService,
    DaemonDispatchService,
  ],
})
export class ExecutionModule {}
