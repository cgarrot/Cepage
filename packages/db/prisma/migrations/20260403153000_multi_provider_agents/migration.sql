-- AlterTable
ALTER TABLE "AgentRun"
RENAME COLUMN "opencodeSessionId" TO "externalSessionId";

-- AlterTable
ALTER TABLE "AgentRun"
ADD COLUMN     "modelProviderId" TEXT,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "providerMetadata" JSONB;
