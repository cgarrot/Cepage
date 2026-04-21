import { Injectable } from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../../common/database/prisma.service';
import { json } from '../../common/database/prisma-json';

@Injectable()
export class EvalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: ActivityService,
  ) {}

  async record(input: {
    sessionId: string;
    kind: 'review' | 'test' | 'integration' | 'validation';
    outcome: 'pass' | 'fail' | 'retry' | 'block' | 'request_human' | 'integrate' | 'rework';
    summary: string;
    details?: Record<string, unknown>;
    nodeId?: string;
    flowId?: string;
    phaseId?: string;
    runId?: string;
    executionId?: string;
    handoff?: Record<string, unknown>;
  }) {
    const row = await this.prisma.evaluationReport.create({
      data: {
        sessionId: input.sessionId,
        runId: input.runId,
        executionId: input.executionId,
        flowId: input.flowId,
        phaseId: input.phaseId,
        nodeId: input.nodeId,
        kind: input.kind,
        outcome: input.outcome,
        summary: input.summary,
        details: json({
          ...(input.details ?? {}),
          ...(input.handoff ? { handoff: input.handoff } : {}),
        }),
      },
    });
    await this.activity.log({
      sessionId: input.sessionId,
      eventId: 0,
      actorType: 'system',
      actorId: 'eval_service',
      runId: input.runId,
      summary: `${input.kind} ${input.outcome}: ${input.summary}`,
      summaryKey: 'activity.evaluation_report',
      summaryParams: {
        kind: input.kind,
        outcome: input.outcome,
      },
      relatedNodeIds: input.nodeId ? [input.nodeId] : undefined,
    });
    await this.emitNode(row.id, input);
    return row;
  }

  private async emitNode(reportId: string, input: {
    sessionId: string;
    kind: 'review' | 'test' | 'integration' | 'validation';
    outcome: string;
    summary: string;
    details?: Record<string, unknown>;
    nodeId?: string;
    handoff?: Record<string, unknown>;
  }): Promise<void> {
    const snapshot = await this.graph.loadSnapshot(input.sessionId);
    const source = input.nodeId ? snapshot.nodes.find((node) => node.id === input.nodeId) : null;
    const position = source?.position ?? { x: 0, y: 0 };
    // Managed-flow `phaseReportKind` uses `validation` for builder/planner/orchestrator agent phases.
    // Those outcomes are pass/fail style (like `test`), not integration merge decisions; emitting them
    // as `integration_decision` previously mapped `pass` → `blocked` (the default branch), which
    // contradicted activity rows like `validation pass`.
    const type =
      input.kind === 'review'
        ? 'review_report'
        : input.kind === 'test' || input.kind === 'validation'
          ? 'test_report'
          : 'integration_decision';
    const testOutcome =
      input.outcome === 'pass'
        ? 'pass'
        : input.outcome === 'block'
          ? 'blocked'
          : input.outcome === 'request_human'
            ? 'blocked'
            : 'fail';
    const content =
      input.kind === 'review'
        ? {
            mode: 'review_report',
            outcome: input.outcome === 'pass' ? 'pass' : input.outcome === 'rework' ? 'changes_requested' : 'blocked',
            summary: input.summary,
            findings: Array.isArray(input.details?.findings) ? input.details?.findings : [],
            handoff: input.handoff,
          }
        : input.kind === 'test' || input.kind === 'validation'
          ? {
              mode: 'test_report',
              outcome: testOutcome,
              summary: input.summary,
              suites: Array.isArray(input.details?.suites) ? input.details?.suites : [],
              failing: Array.isArray(input.details?.failing) ? input.details?.failing : [],
              handoff: input.handoff,
            }
          : {
              mode: 'integration_decision',
              outcome:
                input.outcome === 'integrate'
                  ? 'integrate'
                  : input.outcome === 'request_human'
                    ? 'needs_approval'
                    : input.outcome === 'rework'
                      ? 'rework'
                      : 'blocked',
              summary: input.summary,
              mergeTarget: typeof input.details?.mergeTarget === 'string' ? input.details.mergeTarget : undefined,
              approvalRequestId:
                typeof input.details?.approvalRequestId === 'string'
                  ? input.details.approvalRequestId
                  : undefined,
              handoff: input.handoff,
            };
    const env = await this.graph.addNode(input.sessionId, {
      type,
      content,
      position: { x: position.x + 320, y: position.y + 50 },
      creator: { type: 'system', reason: `evaluation:${reportId}` },
      metadata: {
        evaluationReportId: reportId,
      },
    });
    if (env.payload.type === 'node_added' && input.nodeId) {
      await this.graph.addEdge(input.sessionId, {
        source: input.nodeId,
        target: env.payload.node.id,
        relation: 'produces',
        direction: 'source_to_target',
        creator: { type: 'system', reason: 'evaluation_report' },
      });
    }
  }
}
