-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "workerId" TEXT,
ADD COLUMN     "worktreeId" TEXT;

-- AlterTable
ALTER TABLE "GraphEvent" ADD COLUMN     "workerId" TEXT,
ADD COLUMN     "worktreeId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledSkillRun" ADD COLUMN     "inputs" JSONB;

-- AlterTable
ALTER TABLE "UserSkill" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowCopilotThread" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'edit';

-- AlterTable
ALTER TABLE "WorkflowExecution" ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "WorkflowManagedFlow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentFlowId" TEXT,
    "entryNodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "syncMode" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentPhaseId" TEXT,
    "currentPhaseIndex" INTEGER,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "wait" JSONB,
    "state" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowManagedFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sessionId" TEXT,
    "ownerKind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT,
    "executionId" TEXT,
    "requestId" TEXT,
    "wakeReason" TEXT,
    "workerId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerNode" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "host" TEXT,
    "pid" INTEGER,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "activeJobId" TEXT,
    "load" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLease" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "resourceKind" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "scopeKey" TEXT,
    "holderKind" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "workerId" TEXT,
    "runId" TEXT,
    "executionId" TEXT,
    "requestId" TEXT,
    "status" TEXT NOT NULL,
    "leaseToken" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "runId" TEXT,
    "executionId" TEXT,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "risk" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "resolution" JSONB,
    "requestedByType" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "resolvedByType" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetAccount" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "scopeKind" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "limit" INTEGER,
    "used" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorktreeAllocation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT,
    "executionId" TEXT,
    "leaseId" TEXT,
    "status" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "branchName" TEXT,
    "metadata" JSONB,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorktreeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTrigger" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerNodeId" TEXT NOT NULL,
    "label" TEXT,
    "cron" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchSubscription" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerNodeId" TEXT,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "payload" JSONB NOT NULL,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT,
    "executionId" TEXT,
    "flowId" TEXT,
    "phaseId" TEXT,
    "nodeId" TEXT,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "webhookSubscriptionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowManagedFlow_sessionId_idx" ON "WorkflowManagedFlow"("sessionId");

-- CreateIndex
CREATE INDEX "WorkflowManagedFlow_sessionId_entryNodeId_idx" ON "WorkflowManagedFlow"("sessionId", "entryNodeId");

-- CreateIndex
CREATE INDEX "WorkflowManagedFlow_sessionId_status_idx" ON "WorkflowManagedFlow"("sessionId", "status");

-- CreateIndex
CREATE INDEX "WorkflowManagedFlow_parentFlowId_idx" ON "WorkflowManagedFlow"("parentFlowId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionJob_key_key" ON "ExecutionJob"("key");

-- CreateIndex
CREATE INDEX "ExecutionJob_status_availableAt_idx" ON "ExecutionJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ExecutionJob_sessionId_status_idx" ON "ExecutionJob"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ExecutionJob_ownerKind_ownerId_idx" ON "ExecutionJob"("ownerKind", "ownerId");

-- CreateIndex
CREATE INDEX "WorkerNode_status_lastSeenAt_idx" ON "WorkerNode"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_workerId_recordedAt_idx" ON "WorkerHeartbeat"("workerId", "recordedAt");

-- CreateIndex
CREATE INDEX "ExecutionLease_sessionId_resourceKind_resourceKey_idx" ON "ExecutionLease"("sessionId", "resourceKind", "resourceKey");

-- CreateIndex
CREATE INDEX "ExecutionLease_status_expiresAt_idx" ON "ExecutionLease"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_sessionId_status_idx" ON "ApprovalRequest"("sessionId", "status");

-- CreateIndex
CREATE INDEX "BudgetAccount_sessionId_scopeKind_scopeId_idx" ON "BudgetAccount"("sessionId", "scopeKind", "scopeId");

-- CreateIndex
CREATE INDEX "WorktreeAllocation_sessionId_status_idx" ON "WorktreeAllocation"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ScheduledTrigger_sessionId_status_nextRunAt_idx" ON "ScheduledTrigger"("sessionId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledTrigger_sessionId_ownerNodeId_idx" ON "ScheduledTrigger"("sessionId", "ownerNodeId");

-- CreateIndex
CREATE INDEX "WatchSubscription_sessionId_kind_status_idx" ON "WatchSubscription"("sessionId", "kind", "status");

-- CreateIndex
CREATE INDEX "WatchSubscription_sessionId_ownerNodeId_idx" ON "WatchSubscription"("sessionId", "ownerNodeId");

-- CreateIndex
CREATE INDEX "EvaluationReport_sessionId_outcome_idx" ON "EvaluationReport"("sessionId", "outcome");

-- CreateIndex
CREATE INDEX "EvaluationReport_sessionId_flowId_idx" ON "EvaluationReport"("sessionId", "flowId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_webhookSubscriptionId_idx" ON "WebhookDeliveryAttempt"("webhookSubscriptionId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_event_idx" ON "WebhookDeliveryAttempt"("event");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_attemptedAt_idx" ON "WebhookDeliveryAttempt"("attemptedAt");

-- CreateIndex
CREATE INDEX "ActivityEntry_sessionId_workerId_idx" ON "ActivityEntry"("sessionId", "workerId");

-- CreateIndex
CREATE INDEX "GraphEvent_workerId_idx" ON "GraphEvent"("workerId");

-- CreateIndex
CREATE INDEX "UserSkill_deletedAt_idx" ON "UserSkill"("deletedAt");

-- AddForeignKey
ALTER TABLE "WorkflowManagedFlow" ADD CONSTRAINT "WorkflowManagedFlow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowManagedFlow" ADD CONSTRAINT "WorkflowManagedFlow_parentFlowId_fkey" FOREIGN KEY ("parentFlowId") REFERENCES "WorkflowManagedFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionJob" ADD CONSTRAINT "ExecutionJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionJob" ADD CONSTRAINT "ExecutionJob_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAccount" ADD CONSTRAINT "BudgetAccount_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorktreeAllocation" ADD CONSTRAINT "WorktreeAllocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTrigger" ADD CONSTRAINT "ScheduledTrigger_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSubscription" ADD CONSTRAINT "WatchSubscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationReport" ADD CONSTRAINT "EvaluationReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_webhookSubscriptionId_fkey" FOREIGN KEY ("webhookSubscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
