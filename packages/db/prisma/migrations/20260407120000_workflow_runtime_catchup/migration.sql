-- Catch up schema changes that were added to Prisma without an authored migration.
-- Keep the SQL idempotent so it works for databases that were partially synced via db push.

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "workspaceParentDirectory" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "workspaceDirectoryName" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AgentRun'
      AND column_name = 'opencodeSessionId'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'AgentRun'
        AND column_name = 'externalSessionId'
    ) THEN
      EXECUTE 'UPDATE "AgentRun" SET "externalSessionId" = COALESCE("externalSessionId", "opencodeSessionId") WHERE "opencodeSessionId" IS NOT NULL';
      ALTER TABLE "AgentRun" DROP COLUMN "opencodeSessionId";
    ELSE
      ALTER TABLE "AgentRun" RENAME COLUMN "opencodeSessionId" TO "externalSessionId";
    END IF;
  END IF;
END
$$;

ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "executionId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "triggerNodeId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "stepNodeId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "retryOfRunId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "modelProviderId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "modelId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "externalSessionId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "providerMetadata" JSONB;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "outputText" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "isStreaming" BOOLEAN DEFAULT false;

UPDATE "AgentRun"
SET "updatedAt" = COALESCE("updatedAt", "endedAt", "startedAt", CURRENT_TIMESTAMP)
WHERE "updatedAt" IS NULL;

UPDATE "AgentRun"
SET "isStreaming" = false
WHERE "isStreaming" IS NULL;

ALTER TABLE "AgentRun" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AgentRun" ALTER COLUMN "isStreaming" SET DEFAULT false;
ALTER TABLE "AgentRun" ALTER COLUMN "isStreaming" SET NOT NULL;
ALTER TABLE "AgentRun" ALTER COLUMN "rootNodeId" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentExecutionId" TEXT,
    "triggerNodeId" TEXT,
    "stepNodeId" TEXT,
    "currentRunId" TEXT,
    "latestRunId" TEXT,
    "agentType" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "wakeReason" TEXT NOT NULL,
    "runtime" JSONB NOT NULL,
    "seedNodeIds" JSONB NOT NULL,
    "modelProviderId" TEXT,
    "modelId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkflowExecution" ADD COLUMN IF NOT EXISTS "parentExecutionId" TEXT;

CREATE TABLE IF NOT EXISTS "WorkflowControllerState" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "controllerNodeId" TEXT NOT NULL,
    "parentExecutionId" TEXT,
    "executionId" TEXT,
    "currentChildExecutionId" TEXT,
    "mode" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowControllerState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");
CREATE INDEX IF NOT EXISTS "AgentRun_executionId_idx" ON "AgentRun"("executionId");
CREATE INDEX IF NOT EXISTS "AgentRun_sessionId_requestId_idx" ON "AgentRun"("sessionId", "requestId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_sessionId_idx" ON "WorkflowExecution"("sessionId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_sessionId_triggerNodeId_stepNodeId_idx" ON "WorkflowExecution"("sessionId", "triggerNodeId", "stepNodeId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_parentExecutionId_idx" ON "WorkflowExecution"("parentExecutionId");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowControllerState_executionId_key" ON "WorkflowControllerState"("executionId");
CREATE INDEX IF NOT EXISTS "WorkflowControllerState_sessionId_idx" ON "WorkflowControllerState"("sessionId");
CREATE INDEX IF NOT EXISTS "WorkflowControllerState_sessionId_controllerNodeId_idx" ON "WorkflowControllerState"("sessionId", "controllerNodeId");
CREATE INDEX IF NOT EXISTS "WorkflowControllerState_sessionId_status_idx" ON "WorkflowControllerState"("sessionId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowExecution_sessionId_fkey') THEN
    ALTER TABLE "WorkflowExecution"
    ADD CONSTRAINT "WorkflowExecution_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowExecution_parentExecutionId_fkey') THEN
    ALTER TABLE "WorkflowExecution"
    ADD CONSTRAINT "WorkflowExecution_parentExecutionId_fkey"
    FOREIGN KEY ("parentExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentRun_executionId_fkey') THEN
    ALTER TABLE "AgentRun"
    ADD CONSTRAINT "AgentRun_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowControllerState_sessionId_fkey') THEN
    ALTER TABLE "WorkflowControllerState"
    ADD CONSTRAINT "WorkflowControllerState_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowControllerState_parentExecutionId_fkey') THEN
    ALTER TABLE "WorkflowControllerState"
    ADD CONSTRAINT "WorkflowControllerState_parentExecutionId_fkey"
    FOREIGN KEY ("parentExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowControllerState_executionId_fkey') THEN
    ALTER TABLE "WorkflowControllerState"
    ADD CONSTRAINT "WorkflowControllerState_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowControllerState_currentChildExecutionId_fkey') THEN
    ALTER TABLE "WorkflowControllerState"
    ADD CONSTRAINT "WorkflowControllerState_currentChildExecutionId_fkey"
    FOREIGN KEY ("currentChildExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
