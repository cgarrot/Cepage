-- CreateTable
CREATE TABLE "WorkflowCopilotThread" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "ownerNodeId" TEXT,
    "title" TEXT,
    "agentType" TEXT NOT NULL,
    "modelProviderId" TEXT,
    "modelId" TEXT,
    "scope" JSONB NOT NULL,
    "autoApply" BOOLEAN NOT NULL DEFAULT true,
    "autoRun" BOOLEAN NOT NULL DEFAULT false,
    "externalSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowCopilotThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCopilotMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "analysis" TEXT,
    "summary" JSONB,
    "warnings" JSONB,
    "ops" JSONB,
    "apply" JSONB,
    "error" TEXT,
    "scope" JSONB,
    "agentType" TEXT,
    "modelProviderId" TEXT,
    "modelId" TEXT,
    "rawOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowCopilotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCopilotCheckpoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "summary" JSONB,
    "flow" JSONB NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowCopilotCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowCopilotThread_sessionId_surface_ownerKey_key" ON "WorkflowCopilotThread"("sessionId", "surface", "ownerKey");

-- CreateIndex
CREATE INDEX "WorkflowCopilotThread_sessionId_idx" ON "WorkflowCopilotThread"("sessionId");

-- CreateIndex
CREATE INDEX "WorkflowCopilotMessage_threadId_createdAt_idx" ON "WorkflowCopilotMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowCopilotCheckpoint_sessionId_idx" ON "WorkflowCopilotCheckpoint"("sessionId");

-- CreateIndex
CREATE INDEX "WorkflowCopilotCheckpoint_threadId_createdAt_idx" ON "WorkflowCopilotCheckpoint"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkflowCopilotThread" ADD CONSTRAINT "WorkflowCopilotThread_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCopilotMessage" ADD CONSTRAINT "WorkflowCopilotMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WorkflowCopilotThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCopilotCheckpoint" ADD CONSTRAINT "WorkflowCopilotCheckpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCopilotCheckpoint" ADD CONSTRAINT "WorkflowCopilotCheckpoint_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WorkflowCopilotThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCopilotCheckpoint" ADD CONSTRAINT "WorkflowCopilotCheckpoint_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WorkflowCopilotMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
