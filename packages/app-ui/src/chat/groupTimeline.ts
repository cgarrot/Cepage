import type { ChatTimelineAgentOutput, ChatTimelineItem } from '@cepage/state';

export type GroupedChatItem =
  | { kind: 'standalone'; item: Exclude<ChatTimelineItem, ChatTimelineAgentOutput> }
  | {
      kind: 'agent_step_with_outputs';
      item: Extract<ChatTimelineItem, { kind: 'agent_step' }>;
      outputs: ChatTimelineAgentOutput[];
    };

/**
 * Fold raw `agent_output` rows into the closest preceding `agent_step` of the
 * same agent run / agent type, returning a list ready for direct rendering.
 *
 * Pure helper: same input → same output, no React, easy to unit test.
 */
export function groupTimelineForRender(items: readonly ChatTimelineItem[]): GroupedChatItem[] {
  const out: GroupedChatItem[] = [];
  for (const item of items) {
    if (item.kind === 'agent_output') {
      const last = out[out.length - 1];
      if (last && last.kind === 'agent_step_with_outputs') {
        last.outputs.push(item);
        continue;
      }
      // Orphan output: render as standalone step-less group via a synthetic
      // standalone wrapper so callers always get the right discriminator.
      out.push({ kind: 'standalone', item: item as never });
      continue;
    }
    if (item.kind === 'agent_step') {
      out.push({ kind: 'agent_step_with_outputs', item, outputs: [] });
      continue;
    }
    out.push({ kind: 'standalone', item });
  }
  return out;
}
