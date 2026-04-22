-- CreateTable
CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "icon" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputsSchema" JSONB NOT NULL,
    "outputsSchema" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'workflow_template',
    "promptText" TEXT,
    "graphJson" JSONB,
    "execution" JSONB,
    "sourceSessionId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "ownerKey" TEXT NOT NULL DEFAULT 'local-user',
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "replacedBySlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillRun" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "skillVersion" TEXT NOT NULL,
    "skillKind" TEXT NOT NULL DEFAULT 'user',
    "userSkillId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputs" JSONB NOT NULL,
    "outputs" JSONB,
    "error" JSONB,
    "sessionId" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "correlationId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skillId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSkill_slug_key" ON "UserSkill"("slug");

-- CreateIndex
CREATE INDEX "UserSkill_ownerKey_idx" ON "UserSkill"("ownerKey");

-- CreateIndex
CREATE INDEX "UserSkill_visibility_idx" ON "UserSkill"("visibility");

-- CreateIndex
CREATE INDEX "UserSkill_category_idx" ON "UserSkill"("category");

-- CreateIndex
CREATE INDEX "SkillRun_skillId_createdAt_idx" ON "SkillRun"("skillId", "createdAt");

-- CreateIndex
CREATE INDEX "SkillRun_status_idx" ON "SkillRun"("status");

-- CreateIndex
CREATE INDEX "SkillRun_idempotencyKey_idx" ON "SkillRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WebhookSubscription_active_idx" ON "WebhookSubscription"("active");

-- AddForeignKey
ALTER TABLE "SkillRun" ADD CONSTRAINT "SkillRun_userSkillId_fkey" FOREIGN KEY ("userSkillId") REFERENCES "UserSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
