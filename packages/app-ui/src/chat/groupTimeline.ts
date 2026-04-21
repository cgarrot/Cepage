import type {
  ChatTimelineAgentOutput,
  ChatTimelineCopilotCheckpoint,
  ChatTimelineExecution,
  ChatTimelineItem,
} from '@cepage/state';

export type GroupedChatItem =
  | {
      kind: 'standalone';
      item: Exclude<ChatTimelineItem, ChatTimelineAgentOutput | ChatTimelineExecution>;
      /**
       * Populated when a `copilot_checkpoint` timeline item carried a
       * `forUserMessageId` that matches this standalone user message. The
       * renderer inlines it as a small Restore pill (Cursor-style) instead
       * of emitting a separate block below the message.
       */
      checkpoint?: ChatTimelineCopilotCheckpoint;
    }
  | {
      kind: 'agent_step_with_outputs';
      item: Extract<ChatTimelineItem, { kind: 'agent_step' }>;
      outputs: ChatTimelineAgentOutput[];
    }
  | {
      kind: 'execution_with_stream';
      item: ChatTimelineExecution;
      outputs: ChatTimelineAgentOutput[];
      streamingOutput: string;
    };

/**
 * Fold raw `agent_output` rows into their owning container, returning a list
 * ready for direct rendering.
 *
 *  - If an `agent_output` row carries an `agentRunId` that matches a sibling
 *    of an earlier `ChatTimelineExecution`, it is routed into that
 *    execution's `streamingOutput`. This keeps every output chunk of a
 *    fallback-chained run inside the single unified block instead of leaking
 *    below it as orphaned `AgentOutputBlock`s.
 *  - Otherwise we fall back to folding the output under the closest
 *    preceding `agent_step` (legacy behavior, for orphan/non-execution
 *    runs).
 *  - If neither container is available (truly orphan output), we emit it as
 *    a standalone item so the transcript can still render it.
 *
 * Pure helper: same input → same output, no React, easy to unit test.
 */
export function groupTimelineForRender(items: readonly ChatTimelineItem[]): GroupedChatItem[] {
  const out: GroupedChatItem[] = [];
  // runId → index into `out` of the execution_with_stream group that owns it.
  // Built lazily as we encounter each execution item so interleaved outputs
  // resolve to the correct group even if we see siblings across the list.
  const executionIndexByRunId = new Map<string, number>();
  // copilot-user-message-id → index of its standalone group. Used to fold a
  // following `copilot_checkpoint` (Cursor-style "Restore" pill) onto the
  // right message. We record the raw message id from `item.message.id` (not
  // the prefixed timeline id) because that's what the selector stores in
  // `forUserMessageId`.
  const userMessageIndexById = new Map<string, number>();

  for (const item of items) {
    if (item.kind === 'copilot_checkpoint') {
      if (item.forUserMessageId) {
        const idx = userMessageIndexById.get(item.forUserMessageId);
        if (idx !== undefined) {
          const group = out[idx];
          // Only fold onto standalone groups; and only the first checkpoint
          // (if a second one ever lands on the same message, fall back to
          // rendering it as its own block so no data is lost).
          if (group && group.kind === 'standalone' && !group.checkpoint) {
            group.checkpoint = item;
            continue;
          }
        }
      }
      // Orphan checkpoint (no match) → keep the legacy standalone rendering.
      out.push({ kind: 'standalone', item });
      continue;
    }
    if (item.kind === 'copilot_message' && item.role === 'user') {
      const idx = out.length;
      userMessageIndexById.set(item.message.id, idx);
      out.push({ kind: 'standalone', item });
      continue;
    }
    if (item.kind === 'execution') {
      const idx = out.length;
      out.push({
        kind: 'execution_with_stream',
        item,
        outputs: [],
        streamingOutput: typeof item.output === 'string' ? item.output : '',
      });
      for (const sibling of item.siblings) {
        executionIndexByRunId.set(sibling.runId, idx);
      }
      continue;
    }
    if (item.kind === 'agent_output') {
      const runId =
        item.agentRunId ??
        (item.actor.kind === 'agent' ? item.actor.agentId : undefined);
      if (runId !== undefined) {
        const execIdx = executionIndexByRunId.get(runId);
        if (execIdx !== undefined) {
          const group = out[execIdx];
          if (group && group.kind === 'execution_with_stream') {
            group.outputs.push(item);
            // Compose a single readable log. We prefer the explicit per-run
            // outputText already carried by the execution snapshot, but when
            // live chunks arrive as graph nodes we append them line-by-line.
            const chunk = typeof item.text === 'string' ? item.text.trim() : '';
            if (chunk.length > 0) {
              group.streamingOutput =
                group.streamingOutput.length > 0
                  ? `${group.streamingOutput}\n${chunk}`
                  : chunk;
            }
            continue;
          }
        }
      }
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
