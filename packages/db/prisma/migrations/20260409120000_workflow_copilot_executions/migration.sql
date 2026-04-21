-- AlterTable
ALTER TABLE "WorkflowCopilotMessage" ADD COLUMN "executions" JSONB;
ALTER TABLE "WorkflowCopilotMessage" ADD COLUMN "executionResults" JSONB;
