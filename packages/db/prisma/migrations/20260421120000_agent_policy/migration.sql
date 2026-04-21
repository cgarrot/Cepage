-- CreateTable
CREATE TABLE "AgentPolicy" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "agentType" TEXT,
    "providerID" TEXT,
    "modelID" TEXT,
    "hint" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultAgentType" TEXT,
    "defaultProviderID" TEXT,
    "defaultModelID" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPolicy_level_agentType_providerID_modelID_key" ON "AgentPolicy"("level", "agentType", "providerID", "modelID");

-- CreateIndex
CREATE INDEX "AgentPolicy_level_agentType_idx" ON "AgentPolicy"("level", "agentType");
