-- CreateTable
CREATE TABLE "ScheduledSkillRun" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "skillId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastSessionId" TEXT,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledSkillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledSkillRun_status_nextRunAt_idx" ON "ScheduledSkillRun"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledSkillRun_skillId_idx" ON "ScheduledSkillRun"("skillId");
