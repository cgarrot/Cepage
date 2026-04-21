import { Injectable } from '@nestjs/common';
import {
  sortAgentKernelRecall,
  type AgentKernelRecallEntry,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';

const invisibleRe = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF]/g;
const spacesRe = /\s+/g;
const injectionRe =
  /\b(ignore (all|any|previous|prior)|system prompt|developer message|tool instructions?|jailbreak|override instructions?)\b/i;

export const FILTERED_RECALL_SUMMARY =
  'Potential instruction-like content omitted from durable recall.';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(invisibleRe, ' ')
    .replace(spacesRe, ' ')
    .trim();
}

function trimText(value: string | null | undefined, limit = 240): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (injectionRe.test(text)) return FILTERED_RECALL_SUMMARY;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(right);
  return left.some((entry) => set.has(entry));
}

function dedupeRecall(entries: readonly AgentKernelRecallEntry[]): AgentKernelRecallEntry[] {
  const seen = new Set<string>();
  const out: AgentKernelRecallEntry[] = [];
  for (const entry of sortAgentKernelRecall(entries)) {
    const key = normalizeText(`${entry.kind}|${entry.title}|${entry.summary}`).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

@Injectable()
export class AgentRecallService {
  constructor(private readonly prisma: PrismaService) {}

  async forWorkflowCopilot(
    sessionId: string,
    scopeNodeIds: readonly string[],
    threadId: string,
  ): Promise<AgentKernelRecallEntry[]> {
    const [activity, events, runs, messages] = await Promise.all([
      this.prisma.activityEntry.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 18,
      }),
      this.prisma.graphEvent.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 18,
      }),
      this.prisma.agentRun.findMany({
        where: { sessionId },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
      this.prisma.workflowCopilotMessage.findMany({
        where: { threadId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const out: AgentKernelRecallEntry[] = [];

    for (const row of activity) {
      const related = readStringArray(row.relatedNodeIds);
      if (scopeNodeIds.length > 0 && related.length > 0 && !intersects(scopeNodeIds, related)) {
        continue;
      }
      out.push({
        kind: 'activity',
        title: `Activity · ${row.actorType}`,
        summary: trimText(row.summary, 220) ?? row.actorType,
        timestamp: row.timestamp.toISOString(),
        score: scopeNodeIds.length > 0 ? 0.92 : 0.72,
        runId: row.runId ?? undefined,
        nodeId: related[0],
      });
    }

    for (const row of events) {
      out.push({
        kind: 'graph_event',
        title: `Graph event · ${row.kind}`,
        summary: trimText(
          [row.runId ? `run ${row.runId.slice(0, 8)}` : null, row.wakeReason ?? null]
            .filter(Boolean)
            .join(' · '),
          220,
        ) ?? row.kind,
        timestamp: row.timestamp.toISOString(),
        score: 0.55,
        runId: row.runId ?? undefined,
        eventId: row.eventId,
      });
    }

    for (const row of runs) {
      const summary =
        trimText(row.outputText, 220)
        ?? [row.role, row.status, row.wakeReason].filter(Boolean).join(' · ');
      if (!summary) continue;
      out.push({
        kind: 'agent_run',
        title: `Run · ${row.role}`,
        summary,
        timestamp: row.updatedAt.toISOString(),
        score: 0.68,
        runId: row.id,
      });
    }

    for (const row of messages) {
      const summary = trimText(row.content, 220) ?? trimText(row.analysis, 220);
      if (!summary) continue;
      out.push({
        kind: 'copilot_message',
        title: `Copilot · ${row.role}`,
        summary,
        timestamp: row.createdAt.toISOString(),
        score: 0.76,
      });
    }

    return dedupeRecall(out).slice(0, 12);
  }

  async forAgentRun(
    sessionId: string,
    seedNodeIds: readonly string[],
    runId?: string,
  ): Promise<AgentKernelRecallEntry[]> {
    const [activity, events, runs] = await Promise.all([
      this.prisma.activityEntry.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 18,
      }),
      this.prisma.graphEvent.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 18,
      }),
      this.prisma.agentRun.findMany({
        where: { sessionId },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
    ]);

    const out: AgentKernelRecallEntry[] = [];

    for (const row of activity) {
      const related = readStringArray(row.relatedNodeIds);
      if (seedNodeIds.length > 0 && related.length > 0 && !intersects(seedNodeIds, related)) {
        continue;
      }
      out.push({
        kind: 'activity',
        title: `Activity · ${row.actorType}`,
        summary: trimText(row.summary, 220) ?? row.actorType,
        timestamp: row.timestamp.toISOString(),
        score: seedNodeIds.length > 0 ? 0.9 : 0.7,
        runId: row.runId ?? undefined,
        nodeId: related[0],
      });
    }

    for (const row of events) {
      if (runId && row.runId === runId) continue;
      out.push({
        kind: 'graph_event',
        title: `Graph event · ${row.kind}`,
        summary: trimText(
          [row.runId ? `run ${row.runId.slice(0, 8)}` : null, row.wakeReason ?? null]
            .filter(Boolean)
            .join(' · '),
          220,
        ) ?? row.kind,
        timestamp: row.timestamp.toISOString(),
        score: 0.52,
        runId: row.runId ?? undefined,
        eventId: row.eventId,
      });
    }

    for (const row of runs) {
      if (runId && row.id === runId) continue;
      const summary =
        trimText(row.outputText, 220)
        ?? [row.role, row.status, row.wakeReason].filter(Boolean).join(' · ');
      if (!summary) continue;
      out.push({
        kind: 'agent_run',
        title: `Run · ${row.role}`,
        summary,
        timestamp: row.updatedAt.toISOString(),
        score: 0.66,
        runId: row.id,
      });
    }

    return dedupeRecall(out).slice(0, 10);
  }
}
