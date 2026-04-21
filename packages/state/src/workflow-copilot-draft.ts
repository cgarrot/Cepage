export type WorkflowCopilotDraftTarget = {
  sessionId: string | null;
  surface: 'sidebar' | 'node';
  ownerNodeId?: string;
};

export function buildWorkflowCopilotDraftKey(input: WorkflowCopilotDraftTarget): string | null {
  if (!input.sessionId) {
    return null;
  }
  if (input.surface === 'sidebar') {
    return `${input.sessionId}:sidebar`;
  }
  const nodeId = input.ownerNodeId?.trim();
  if (!nodeId) {
    return null;
  }
  return `${input.sessionId}:node:${nodeId}`;
}

export function readWorkflowCopilotDraft(
  drafts: Record<string, string>,
  key: string | null,
): string {
  if (!key) {
    return '';
  }
  return drafts[key] ?? '';
}

export function writeWorkflowCopilotDraft(
  drafts: Record<string, string>,
  key: string | null,
  value: string,
): Record<string, string> {
  if (!key) {
    return drafts;
  }
  if (value.length === 0) {
    if (!Object.hasOwn(drafts, key)) {
      return drafts;
    }
    const next = { ...drafts };
    delete next[key];
    return next;
  }
  if (drafts[key] === value) {
    return drafts;
  }
  return {
    ...drafts,
    [key]: value,
  };
}
