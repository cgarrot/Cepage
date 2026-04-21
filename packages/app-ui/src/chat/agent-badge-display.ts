import type { ChatModelRef } from '@cepage/state';

/**
 * Decision table for what to render on the right of the badge. Exposed as
 * a pure helper (no JSX, no React) so we can unit-test the four rendering
 * branches without a DOM.
 *
 * - `kind: 'mismatch'` → strike configured + arrow + called (fallback happened)
 * - `kind: 'single'`   → just render the one meaningful model
 * - `kind: 'none'`     → nothing to render (no model data at all)
 */
export type AgentBadgeModelDisplay =
  | { kind: 'mismatch'; configured: ChatModelRef; called: ChatModelRef }
  | { kind: 'single'; model: ChatModelRef }
  | { kind: 'none' };

function modelEqual(a: ChatModelRef | undefined, b: ChatModelRef | undefined): boolean {
  if (!a || !b) return false;
  return a.providerId === b.providerId && a.modelId === b.modelId;
}

export function selectAgentBadgeModelDisplay(
  configured: ChatModelRef | undefined,
  called: ChatModelRef | undefined,
): AgentBadgeModelDisplay {
  const hasConfigured = Boolean(configured);
  const hasCalled = Boolean(called);
  if (hasConfigured && hasCalled && !modelEqual(configured, called)) {
    // Both provided AND different → the node was routed to another model.
    return { kind: 'mismatch', configured: configured!, called: called! };
  }
  // If both are provided and equal, show the configured one (they're the
  // same anyway); otherwise show whichever one is present.
  const single = configured ?? called;
  if (!single) return { kind: 'none' };
  return { kind: 'single', model: single };
}
