import { z } from 'zod';

const textSchema = z.string().min(1);

export const softwareRoleSchema = z.enum([
  'orchestrator',
  'planner',
  'builder',
  'reviewer',
  'tester',
  'integrator',
  'observer',
]);
export type SoftwareRole = z.infer<typeof softwareRoleSchema>;

export const workflowHandoffStatusSchema = z.enum([
  'draft',
  'ready',
  'accepted',
  'rework',
  'blocked',
]);
export type WorkflowHandoffStatus = z.infer<typeof workflowHandoffStatusSchema>;

export const workflowHandoffSchema = z.object({
  fromRole: softwareRoleSchema,
  toRole: softwareRoleSchema,
  status: workflowHandoffStatusSchema.default('draft'),
  summary: textSchema,
  artifactNodeIds: z.array(z.string()).default([]),
});
export type WorkflowHandoff = z.infer<typeof workflowHandoffSchema>;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const reviewReportOutcomeSchema = z.enum(['pass', 'changes_requested', 'blocked']);
export type ReviewReportOutcome = z.infer<typeof reviewReportOutcomeSchema>;

export const reviewReportContentSchema = z.object({
  mode: z.literal('review_report'),
  outcome: reviewReportOutcomeSchema,
  summary: textSchema,
  findings: z.array(z.string()).default([]),
  handoff: workflowHandoffSchema.optional(),
});
export type ReviewReportContent = z.infer<typeof reviewReportContentSchema>;

export function readReviewReportContent(value: unknown): ReviewReportContent | null {
  const parsed = reviewReportContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeReviewReportContent(value: unknown): string {
  const content = readReviewReportContent(value);
  if (!content) return '';
  const lines = [`review · ${content.outcome}`, content.summary];
  if (content.findings.length > 0) {
    lines.push(`findings: ${content.findings.length}`);
  }
  if (content.handoff) {
    lines.push(`${content.handoff.fromRole} -> ${content.handoff.toRole}`);
  }
  return lines.join('\n');
}

export const testReportOutcomeSchema = z.enum(['pass', 'fail', 'blocked']);
export type TestReportOutcome = z.infer<typeof testReportOutcomeSchema>;

export const testReportContentSchema = z.object({
  mode: z.literal('test_report'),
  outcome: testReportOutcomeSchema,
  summary: textSchema,
  suites: z.array(z.string()).default([]),
  failing: z.array(z.string()).default([]),
  handoff: workflowHandoffSchema.optional(),
});
export type TestReportContent = z.infer<typeof testReportContentSchema>;

export function readTestReportContent(value: unknown): TestReportContent | null {
  const parsed = testReportContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeTestReportContent(value: unknown): string {
  const content = readTestReportContent(value);
  if (!content) return '';
  const lines = [`test · ${content.outcome}`, content.summary];
  if (content.suites.length > 0) {
    lines.push(`suites: ${content.suites.join(', ')}`);
  }
  if (content.failing.length > 0) {
    lines.push(`failing: ${content.failing.length}`);
  }
  if (content.handoff) {
    lines.push(`${content.handoff.fromRole} -> ${content.handoff.toRole}`);
  }
  return lines.join('\n');
}

export const integrationDecisionOutcomeSchema = z.enum([
  'integrate',
  'rework',
  'needs_approval',
  'blocked',
]);
export type IntegrationDecisionOutcome = z.infer<typeof integrationDecisionOutcomeSchema>;

export const integrationDecisionContentSchema = z.object({
  mode: z.literal('integration_decision'),
  outcome: integrationDecisionOutcomeSchema,
  summary: textSchema,
  mergeTarget: z.string().optional(),
  approvalRequestId: z.string().optional(),
  handoff: workflowHandoffSchema.optional(),
});
export type IntegrationDecisionContent = z.infer<typeof integrationDecisionContentSchema>;

export function readIntegrationDecisionContent(value: unknown): IntegrationDecisionContent | null {
  const parsed = integrationDecisionContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function summarizeIntegrationDecisionContent(value: unknown): string {
  const content = readIntegrationDecisionContent(value);
  if (!content) return '';
  const lines = [`integration · ${content.outcome}`, content.summary];
  if (content.mergeTarget?.trim()) {
    lines.push(`target: ${content.mergeTarget.trim()}`);
  }
  if (content.approvalRequestId?.trim()) {
    lines.push(`approval: ${content.approvalRequestId.trim()}`);
  }
  if (content.handoff) {
    lines.push(`${content.handoff.fromRole} -> ${content.handoff.toRole}`);
  }
  return lines.join('\n');
}

export function readWorkflowHandoff(value: unknown): WorkflowHandoff | null {
  const record = readRecord(value);
  const parsed = workflowHandoffSchema.safeParse(record?.handoff ?? value);
  return parsed.success ? parsed.data : null;
}
