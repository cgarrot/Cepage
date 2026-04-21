import { z } from 'zod';

const textSchema = z.string().min(1);

export const agentToolsetIdSchema = z.enum([
  'concierge',
  'orchestrator',
  'builder',
  'reviewer',
  'explorer',
  'observer',
]);
export type AgentToolsetId = z.infer<typeof agentToolsetIdSchema>;

export const agentKernelRecallKindSchema = z.enum([
  'activity',
  'graph_event',
  'agent_run',
  'copilot_message',
]);
export type AgentKernelRecallKind = z.infer<typeof agentKernelRecallKindSchema>;

export const agentKernelRecallEntrySchema = z.object({
  kind: agentKernelRecallKindSchema,
  title: textSchema,
  summary: textSchema,
  timestamp: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  nodeId: z.string().optional(),
  runId: z.string().optional(),
  eventId: z.number().int().positive().optional(),
});
export type AgentKernelRecallEntry = z.infer<typeof agentKernelRecallEntrySchema>;

export const agentDelegationContextSchema = z.object({
  parentRunId: z.string().optional(),
  depth: z.number().int().nonnegative().optional(),
  allowed: z.boolean().optional(),
});
export type AgentDelegationContext = z.infer<typeof agentDelegationContextSchema>;

export const AGENT_TOOLSET_DESCRIPTIONS: Record<AgentToolsetId, string> = {
  concierge:
    'Front-agent policy. Clarify intent, route toward the right workflow skill, keep questions short, and present published results instead of internal graph mechanics unless the user asks for details.',
  orchestrator:
    'Routing and delegation policy. Coordinate graph work, choose specialists, keep approvals and budgets in mind, and prefer visible graph-native delegation over opaque hidden work.',
  builder:
    'Implementation policy. Read and write files carefully, honor declared output contracts, and leave durable artifacts on the graph or workspace instead of only reporting analysis.',
  reviewer:
    'Review policy. Inspect assumptions, contradictions, risks, and validation gaps before approval or merge-style steps.',
  explorer:
    'Exploration policy. Map the codebase or workflow, gather evidence, and summarize findings without making unnecessary edits.',
  observer:
    'Observation policy. Watch runs, statuses, files, and validations, and report meaningful deltas instead of replaying the entire session history.',
};

export function resolveAgentToolset(role: string): AgentToolsetId {
  const text = role.trim().toLowerCase();
  if (text.includes('concierge') || text.includes('front')) return 'concierge';
  if (text.includes('review')) return 'reviewer';
  if (text.includes('explore')) return 'explorer';
  if (text.includes('observ')) return 'observer';
  if (text.includes('build') || text.includes('implement')) return 'builder';
  if (text.includes('orchestr')) return 'orchestrator';
  return 'builder';
}

export function describeAgentToolset(toolset: AgentToolsetId | undefined): string | null {
  if (!toolset) return null;
  return AGENT_TOOLSET_DESCRIPTIONS[toolset];
}

export function sortAgentKernelRecall(
  entries: readonly AgentKernelRecallEntry[],
): AgentKernelRecallEntry[] {
  return [...entries].sort((a, b) => {
    const score = (b.score ?? 0) - (a.score ?? 0);
    if (score !== 0) return score;
    const left = a.timestamp ?? '';
    const right = b.timestamp ?? '';
    if (left !== right) return right.localeCompare(left);
    return a.title.localeCompare(b.title);
  });
}
