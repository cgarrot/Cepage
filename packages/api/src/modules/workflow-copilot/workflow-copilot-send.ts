import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  WORKFLOW_COPILOT_CURSOR_ATTACHMENT_INLINE_MAX_BYTES,
  workflowCopilotAttachmentMimeInlinableForCursorAgent,
  workflowCopilotAttachmentTotalBytes,
  workflowCopilotSendMessageSchema,
  type AgentCatalog,
  type AgentModelRef,
  type AgentType,
  type WorkflowCopilotApplyResult,
  type WorkflowCopilotExecution,
  type WorkflowCopilotExecutionResult,
  type WorkflowCopilotLiveMessagePayload,
  type WorkflowCopilotScope,
  type WorkflowCopilotSendResult,
} from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import {
  buildRepairFeedback,
  detectRuntimeIssues,
  detectTurnIssues,
  isRecoverableByRepair,
  summarizeIssues,
  WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS,
  type RepairIssue,
} from './workflow-copilot-repair';
import { formatApplyError, readLiveOutput } from './workflow-copilot-runtime';
import {
  readAgentType,
  readApply,
  readCopilotExecutionError,
  readMode,
  readModelRef,
  readScope,
  readSummary,
  readThreadMetadata,
  rowToMessage,
  sanitizeTurn,
} from './workflow-copilot-rows';
import type {
  MessageRow,
  RunThreadProgress,
  RunTurnResult,
  SessionRow,
  ThreadRow,
} from './workflow-copilot.types';

export type WorkflowCopilotSendInput = z.infer<typeof workflowCopilotSendMessageSchema>;

type SendDeps = {
  prisma: PrismaService;
  readSession: (sessionId: string) => Promise<SessionRow>;
  readThreadRow: (sessionId: string, threadId: string) => Promise<ThreadRow>;
  readLockedNodeSelection: (
    sessionId: string,
    ownerNodeId?: string | null,
  ) => Promise<{ type: AgentType; model?: AgentModelRef } | null>;
  emitThreadRow: (sessionId: string, row: ThreadRow) => void;
  emitMessageRow: (
    sessionId: string,
    thread: ThreadRow,
    row: MessageRow,
    checkpoints?: WorkflowCopilotApplyResult['checkpoints'],
  ) => void;
  emitCopilotMessage: (sessionId: string, payload: WorkflowCopilotLiveMessagePayload) => void;
  readBundle: (
    sessionId: string,
    threadId: string,
  ) => Promise<{
    thread: WorkflowCopilotSendResult['thread'];
    messages: Array<WorkflowCopilotSendResult['assistantMessage']>;
    checkpoints: WorkflowCopilotSendResult['checkpoints'];
  }>;
  runThread: (
    session: SessionRow,
    thread: ThreadRow & {
      scope: WorkflowCopilotScope;
      agentType: AgentType;
    },
    history: MessageRow[],
    signal: AbortSignal,
    onProgress?: (progress: RunThreadProgress) => Promise<void>,
  ) => Promise<RunTurnResult>;
  applyMessage: (
    sessionId: string,
    threadId: string,
    messageId: string,
  ) => Promise<WorkflowCopilotApplyResult>;
  materializeSendMessageFileSummary: (
    sessionId: string,
    target: 'new' | 'existing',
    existingNodeId: string | undefined,
    position: { x: number; y: number } | undefined,
    branches: string[] | undefined,
    attachments: NonNullable<WorkflowCopilotSendInput['attachments']>,
    threadAgentType: AgentType,
  ) => Promise<string>;
  runCopilotExecutions: (
    sessionId: string,
    executions: WorkflowCopilotExecution[],
    refMap: Record<string, string>,
  ) => Promise<WorkflowCopilotExecutionResult[]>;
  loadRepairContext: () => Promise<{
    catalog: AgentCatalog | null;
    runnableTypes: Set<AgentType>;
  }>;
  abortByThread: Map<string, AbortController>;
};

export async function sendWorkflowCopilotMessage(
  deps: SendDeps,
  input: {
    sessionId: string;
    threadId: string;
    body: WorkflowCopilotSendInput;
  },
): Promise<WorkflowCopilotSendResult> {
  const session = await deps.readSession(input.sessionId);
  const row = await deps.readThreadRow(input.sessionId, input.threadId);
  const locked =
    row.surface === 'node'
      ? await deps.readLockedNodeSelection(input.sessionId, row.ownerNodeId)
      : null;
  const scope = input.body.scope ?? readScope(row.scope);
  const mode = input.body.mode ?? readMode(row.mode);
  const agentType = locked?.type ?? input.body.agentType ?? readAgentType(row.agentType);
  const model = locked?.model ?? input.body.model ?? readModelRef(row.modelProviderId, row.modelId);
  const autoApply = input.body.autoApply ?? row.autoApply;
  const autoRun = input.body.autoRun ?? row.autoRun;
  const atts = input.body.attachments ?? [];
  if (
    agentType === 'cursor_agent' &&
    atts.some((a) => !workflowCopilotAttachmentMimeInlinableForCursorAgent(a.mime))
  ) {
    throw new BadRequestException('WORKFLOW_COPILOT_ATTACHMENTS_UNSUPPORTED');
  }
  if (agentType === 'cursor_agent') {
    const total = workflowCopilotAttachmentTotalBytes(atts);
    if (total != null && total > WORKFLOW_COPILOT_CURSOR_ATTACHMENT_INLINE_MAX_BYTES) {
      throw new BadRequestException(
        'Cursor Agent attachment context is too large. Attach fewer or smaller text files, or switch to OpenCode.',
      );
    }
  }

  let thread = await deps.prisma.workflowCopilotThread.update({
    where: { id: input.threadId },
    data: {
      agentType,
      modelProviderId: model?.providerID ?? null,
      modelId: model?.modelID ?? null,
      scope: scope as never,
      mode: mode as never,
      autoApply,
      autoRun,
    },
  }) as ThreadRow;
  deps.emitThreadRow(input.sessionId, thread);

  const userRow = await deps.prisma.workflowCopilotMessage.create({
    data: {
      threadId: input.threadId,
      role: 'user',
      status: 'completed',
      content: input.body.content.trim(),
      ...(atts.length > 0 ? { attachments: atts as never } : {}),
      scope: scope as never,
      agentType,
      modelProviderId: model?.providerID ?? null,
      modelId: model?.modelID ?? null,
    },
  }) as MessageRow;
  deps.emitMessageRow(input.sessionId, thread, userRow);

  const history = await deps.prisma.workflowCopilotMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: 'asc' },
    take: 16,
  });
  let assistant = await deps.prisma.workflowCopilotMessage.create({
    data: {
      threadId: input.threadId,
      role: 'assistant',
      status: 'pending',
      content: '',
      analysis: null,
      summary: [] as never,
      warnings: [] as never,
      ops: [] as never,
      executions: [] as never,
      executionResults: [] as never,
      error: null,
      scope: scope as never,
      agentType,
      modelProviderId: model?.providerID ?? null,
      modelId: model?.modelID ?? null,
      rawOutput: null,
    },
  }) as MessageRow;
  deps.emitMessageRow(input.sessionId, thread, assistant);

  // Load the repair context ONCE for this send call — the catalog + runnable
  // types don't change between retry attempts, so we avoid re-fetching them
  // from the policy service / daemon between iterations.
  const repairContext = await deps.loadRepairContext();
  // `repairHistory` is the in-memory conversation fed to `runThread` (starts
  // with the persisted history and accumulates synthetic `user` feedback
  // turns between retries). Synthetic rows are NEVER persisted to Prisma.
  let repairHistory: MessageRow[] = [...history];
  const repairRecord: Array<{ attempt: number; issues: RepairIssue[] }> = [];
  let attempts = 0;

  let run: RunTurnResult;
  let rawTurn: Parameters<typeof sanitizeTurn>[0] | null = null;
  let turn: ReturnType<typeof sanitizeTurn> | null = null;
  let output = '';
  let liveThinkingFinal = '';
  let applyErrorFinal: unknown;
  let executionResultsFinal: WorkflowCopilotExecutionResult[] = [];

  // Unified repair loop. One iteration = one agent call + (optional) apply +
  // run + detection. We retry on recoverable issues up to
  // `WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS` extra times. The DB assistant row
  // is mutated in place — the user sees a single message that eventually
  // transitions to completed/error with optional "Auto-repaired…" warning.
  while (true) {
    const attempt = await runOneAgentAttempt({
      deps,
      input,
      sessionRow: session,
      threadRefresh: () => thread,
      threadSetter: (value) => {
        thread = value;
      },
      assistantRefresh: () => assistant,
      assistantSetter: (value) => {
        assistant = value;
      },
      agentType,
      model,
      scope,
      mode,
      autoApply,
      autoRun,
      history: repairHistory,
    });
    run = attempt.run;
    rawTurn = run.ok ? run.turn : null;
    turn = rawTurn ? sanitizeTurn(rawTurn, mode) : null;
    output = attempt.output;
    liveThinkingFinal = attempt.liveThinking;

    // Stage 1 — turn-level issues (parse fail, out-of-catalog model binding,
    // agentType without an adapter).
    const turnIssues = detectTurnIssues({
      run,
      catalog: repairContext.catalog,
      runnableTypes: repairContext.runnableTypes,
      threadAgentType: agentType,
    });
    const recoverableTurnIssues = turnIssues.filter(isRecoverableByRepair);
    if (recoverableTurnIssues.length > 0 && attempts < WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS) {
      repairRecord.push({ attempt: attempts, issues: recoverableTurnIssues });
      attempts++;
      repairHistory = appendRepairFeedback(repairHistory, input.threadId, {
        issues: recoverableTurnIssues,
        attemptsLeft: WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS - attempts,
      });
      continue;
    }

    // Side-effect writes that happen once per attempt, regardless of whether
    // we will retry after apply. (Persisting early so the client sees the
    // last attempt's content even if the apply triggers another retry.)
    await syncThreadMetadataAndExternalId(deps, input, thread, run, rawTurn, (next) => {
      thread = next;
    });
    assistant = await persistAssistantTurn(
      deps,
      input,
      assistant.id,
      run,
      turn,
      output,
      liveThinkingFinal,
      thread,
    );

    // Stage 2 — apply + run (edit mode only). Only the happy path reaches
    // this; parse failures keep `run.ok === false` and skip straight to the
    // final finalizeAssistantWarnings pass.
    if (!turn || mode === 'ask' || !run.ok) break;

    let applyError: unknown = undefined;
    let executionResults: WorkflowCopilotExecutionResult[] = [];

    if (autoApply && turn.ops.length > 0) {
      try {
        const applied = await deps.applyMessage(input.sessionId, input.threadId, assistant.id);
        deps.emitCopilotMessage(input.sessionId, {
          thread: applied.thread,
          message: applied.message,
          checkpoints: applied.checkpoints,
        });
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        applyError = error;
      }
    }

    if (!applyError && autoRun && turn.executions.length > 0) {
      const row = await deps.prisma.workflowCopilotMessage.findUnique({
        where: { id: assistant.id },
      });
      if (!row) {
        throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
      }
      const refMap = readApply(row.apply)?.refMap ?? {};
      executionResults = await deps.runCopilotExecutions(input.sessionId, turn.executions, refMap);
    }

    const runtimeIssues = detectRuntimeIssues({
      applyError,
      executionResults,
      executions: turn.executions,
    });
    const recoverableRuntimeIssues = runtimeIssues.filter(isRecoverableByRepair);
    if (recoverableRuntimeIssues.length > 0 && attempts < WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS) {
      repairRecord.push({ attempt: attempts, issues: recoverableRuntimeIssues });
      attempts++;
      repairHistory = appendRepairFeedback(repairHistory, input.threadId, {
        issues: recoverableRuntimeIssues,
        attemptsLeft: WORKFLOW_COPILOT_MAX_REPAIR_ATTEMPTS - attempts,
      });
      continue;
    }

    applyErrorFinal = applyError;
    executionResultsFinal = executionResults;
    break;
  }

  // At this point the DB has the latest attempt's turn. Now materialize file
  // summary attachments, apply/exec error persistence, and repair warnings.
  let sendFileSummaryNodeId: string | undefined;
  if (run!.ok && turn && atts.length > 0) {
    const ag = turn.attachmentGraph;
    if (ag && ag.kind !== 'none') {
      try {
        sendFileSummaryNodeId =
          ag.kind === 'new'
            ? await deps.materializeSendMessageFileSummary(
                input.sessionId,
                'new',
                undefined,
                ag.position,
                ag.branches,
                atts,
                agentType,
              )
            : await deps.materializeSendMessageFileSummary(
                input.sessionId,
                'existing',
                ag.nodeId,
                undefined,
                undefined,
                atts,
                agentType,
              );
      } catch (err) {
        const errMsg = readCopilotExecutionError(err);
        assistant = await deps.prisma.workflowCopilotMessage.update({
          where: { id: assistant.id },
          data: {
            status: 'error',
            error: errMsg,
          },
        }) as MessageRow;
        deps.emitMessageRow(input.sessionId, thread, assistant);
        await finalizeAssistantWarnings(deps, input, assistant.id, repairRecord, 'error');
        const bundle = await deps.readBundle(input.sessionId, input.threadId);
        return {
          thread: bundle.thread,
          userMessage: rowToMessage(userRow, mode),
          assistantMessage:
            bundle.messages.find((entry) => entry.id === assistant.id) ?? rowToMessage(assistant, mode),
          checkpoints: bundle.checkpoints,
        };
      }
    }
  }

  if (!turn || mode === 'ask') {
    const finalStatus: 'completed' | 'error' = run!.ok ? 'completed' : 'error';
    await finalizeAssistantWarnings(deps, input, assistant.id, repairRecord, finalStatus);
    const bundle = await deps.readBundle(input.sessionId, input.threadId);
    const assistantMessage =
      bundle.messages.find((entry) => entry.id === assistant.id) ?? rowToMessage(assistant, mode);
    return {
      thread: bundle.thread,
      userMessage: rowToMessage(userRow, mode),
      assistantMessage,
      checkpoints: bundle.checkpoints,
      ...(sendFileSummaryNodeId ? { fileSummaryNodeId: sendFileSummaryNodeId } : {}),
    };
  }

  // Persist the terminal apply/run outcome of the final attempt.
  let applyFailed = false;
  if (applyErrorFinal) {
    applyFailed = true;
    await deps.prisma.workflowCopilotMessage.update({
      where: { id: assistant.id },
      data: {
        status: 'error',
        error: formatApplyError(applyErrorFinal),
      },
    });
  } else if (executionResultsFinal.length > 0) {
    const row = await deps.prisma.workflowCopilotMessage.findUnique({
      where: { id: assistant.id },
    });
    if (!row) {
      throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
    }
    const warnExtra = executionResultsFinal
      .filter((r) => !r.ok)
      .map((r) => `${r.kind}: ${r.error ?? 'WORKFLOW_COPILOT_EXECUTION_FAILED'}`);
    const prevWarn = readSummary(row.warnings);
    await deps.prisma.workflowCopilotMessage.update({
      where: { id: assistant.id },
      data: {
        executionResults: executionResultsFinal as never,
        ...(warnExtra.length > 0 ? { warnings: [...prevWarn, ...warnExtra] as never } : {}),
      },
    });
  }

  const finalStatus: 'completed' | 'error' = applyFailed ? 'error' : 'completed';
  await finalizeAssistantWarnings(deps, input, assistant.id, repairRecord, finalStatus);
  const bundle = await deps.readBundle(input.sessionId, input.threadId);
  const assistantMessage =
    bundle.messages.find((entry) => entry.id === assistant.id) ?? rowToMessage(assistant, mode);
  deps.emitCopilotMessage(input.sessionId, {
    thread: bundle.thread,
    message: assistantMessage,
    checkpoints: bundle.checkpoints,
  });
  return {
    thread: bundle.thread,
    userMessage: rowToMessage(userRow),
    assistantMessage,
    checkpoints: bundle.checkpoints,
    ...(sendFileSummaryNodeId ? { fileSummaryNodeId: sendFileSummaryNodeId } : {}),
  };
}

/**
 * Update thread metadata (architect spec, externalSessionId) that the
 * original code did as side effects between runThread and the message
 * persistence. Kept as a free function so the repair loop stays linear.
 */
async function syncThreadMetadataAndExternalId(
  deps: SendDeps,
  input: { sessionId: string; threadId: string },
  thread: ThreadRow,
  run: RunTurnResult,
  rawTurn: Parameters<typeof sanitizeTurn>[0] | null,
  setThread: (value: ThreadRow) => void,
): Promise<void> {
  if (run.ok && rawTurn?.architecture) {
    const currentMeta = readThreadMetadata(thread.metadata);
    const metadata = {
      ...(currentMeta ?? {}),
      architect: {
        status: rawTurn.architecture.reviewRequired ? 'review_required' : 'ready',
        candidates: currentMeta?.architect?.candidates ?? [],
        spec: rawTurn.architecture,
        generatedAt: new Date().toISOString(),
      },
      clarificationStatus: rawTurn.architecture.reviewRequired ? 'needs_input' : 'ready',
    };
    const updated = (await deps.prisma.workflowCopilotThread.update({
      where: { id: input.threadId },
      data: { metadata: metadata as never },
    })) as ThreadRow;
    setThread(updated);
    deps.emitThreadRow(input.sessionId, updated);
  }
  if (run.externalSessionId) {
    const updated = (await deps.prisma.workflowCopilotThread.update({
      where: { id: input.threadId },
      data: { externalSessionId: run.externalSessionId },
    })) as ThreadRow;
    setThread(updated);
    deps.emitThreadRow(input.sessionId, updated);
  }
}

/**
 * Append a synthetic `user` turn to the in-memory history fed to `runThread`.
 * This row is never persisted to Prisma — it only shapes the next prompt pass
 * so the LLM sees the feedback as if the user said it.
 */
function appendRepairFeedback(
  history: MessageRow[],
  threadId: string,
  feedback: { issues: readonly RepairIssue[]; attemptsLeft: number },
): MessageRow[] {
  const message = buildRepairFeedback(feedback);
  const now = new Date();
  const row: MessageRow = {
    id: `repair-feedback-${now.getTime()}-${history.length}`,
    threadId,
    role: 'user',
    status: 'completed',
    content: message,
    analysis: null,
    summary: [],
    warnings: [],
    ops: [],
    apply: null,
    error: null,
    scope: null,
    agentType: null,
    modelProviderId: null,
    modelId: null,
    rawOutput: null,
    thinkingOutput: null,
    executions: null,
    executionResults: null,
    attachments: null,
    createdAt: now,
    updatedAt: now,
  };
  return [...history, row];
}

/**
 * Run a single extra agent attempt from inside the apply/run repair loop.
 * Replicates the streaming bookkeeping the first-pass sync closure does, but
 * operates on externally-held references to `thread` / `assistant`.
 */
async function runOneAgentAttempt(args: {
  deps: SendDeps;
  input: { sessionId: string; threadId: string; body: WorkflowCopilotSendInput };
  sessionRow: SessionRow;
  threadRefresh: () => ThreadRow;
  threadSetter: (value: ThreadRow) => void;
  assistantRefresh: () => MessageRow;
  assistantSetter: (value: MessageRow) => void;
  agentType: AgentType;
  model: AgentModelRef | undefined;
  scope: WorkflowCopilotScope;
  mode: 'edit' | 'ask';
  autoApply: boolean;
  autoRun: boolean;
  history: MessageRow[];
}): Promise<{ run: RunTurnResult; output: string; liveThinking: string }> {
  let live = '';
  let sent = '';
  let liveThinking = '';
  let sentThinking = '';
  let stamp = 0;
  const sync = async (progress: RunThreadProgress) => {
    const nextOutput = readLiveOutput(progress);
    const nextThinking = progress.thinkingOutput;
    const now = Date.now();
    const threadNow = args.threadRefresh();
    if (progress.externalSessionId && progress.externalSessionId !== threadNow.externalSessionId) {
      const updated = (await args.deps.prisma.workflowCopilotThread.update({
        where: { id: args.input.threadId },
        data: { externalSessionId: progress.externalSessionId },
      })) as ThreadRow;
      args.threadSetter(updated);
      args.deps.emitThreadRow(args.input.sessionId, updated);
    }
    if (!nextOutput && !nextThinking) return;
    if (nextOutput === sent && nextThinking === sentThinking) return;
    if (now - stamp < 120) {
      live = nextOutput || live;
      liveThinking = nextThinking || liveThinking;
      return;
    }
    live = nextOutput || live;
    liveThinking = nextThinking || liveThinking;
    const assistantNow = args.assistantRefresh();
    const updated = (await args.deps.prisma.workflowCopilotMessage.update({
      where: { id: assistantNow.id },
      data: {
        rawOutput: live || null,
        thinkingOutput: liveThinking || null,
      },
    })) as MessageRow;
    args.assistantSetter(updated);
    args.deps.emitMessageRow(args.input.sessionId, args.threadRefresh(), updated);
    sent = live;
    sentThinking = liveThinking;
    stamp = now;
  };
  const ac = new AbortController();
  args.deps.abortByThread.set(args.input.threadId, ac);
  let run: RunTurnResult;
  try {
    const threadRow = args.threadRefresh();
    run = await args.deps.runThread(
      args.sessionRow,
      {
        ...threadRow,
        agentType: args.agentType,
        modelProviderId: args.model?.providerID ?? null,
        modelId: args.model?.modelID ?? null,
        scope: args.scope,
        mode: args.mode,
        autoApply: args.autoApply,
        autoRun: args.autoRun,
      },
      args.history,
      ac.signal,
      async (progress) => {
        await sync(progress);
      },
    );
  } finally {
    if (args.deps.abortByThread.get(args.input.threadId) === ac) {
      args.deps.abortByThread.delete(args.input.threadId);
    }
  }
  return { run, output: live || run.rawOutput, liveThinking };
}

/**
 * Persist a run's turn onto the existing assistant row, re-using the same
 * single-write shape the initial pass uses. Returns the refreshed row.
 */
async function persistAssistantTurn(
  deps: SendDeps,
  input: { sessionId: string; threadId: string },
  assistantId: string,
  run: RunTurnResult,
  turn: ReturnType<typeof sanitizeTurn> | null,
  output: string,
  liveThinking: string,
  thread: ThreadRow,
): Promise<MessageRow> {
  const updated = (await deps.prisma.workflowCopilotMessage.update({
    where: { id: assistantId },
    data: {
      status: run.ok ? 'completed' : 'error',
      content: turn ? turn.reply : run.rawOutput,
      analysis: turn ? turn.analysis : null,
      summary: turn ? (turn.summary as never) : ([] as never),
      warnings: turn ? (turn.warnings as never) : ([] as never),
      ops: turn ? (turn.ops as never) : ([] as never),
      executions: turn ? ((turn.executions ?? []) as never) : ([] as never),
      executionResults: [] as never,
      error: run.ok ? null : run.error,
      rawOutput: output || null,
      thinkingOutput: liveThinking || null,
    },
  })) as MessageRow;
  deps.emitMessageRow(input.sessionId, thread, updated);
  return updated;
}

/**
 * Prepend a one-line "Auto-repaired after N attempt(s): …" warning to the
 * final assistant row when we actually retried. Appends as a new entry in the
 * `warnings` array so clients that render warnings above the reply surface
 * the repair context without further UI work.
 */
async function finalizeAssistantWarnings(
  deps: SendDeps,
  _input: { sessionId: string; threadId: string },
  assistantId: string,
  record: Array<{ attempt: number; issues: RepairIssue[] }>,
  finalStatus: 'completed' | 'error',
): Promise<MessageRow | null> {
  if (record.length === 0) return null;
  const row = (await deps.prisma.workflowCopilotMessage.findUnique({
    where: { id: assistantId },
  })) as MessageRow | null;
  if (!row) return null;
  const flatIssues = record.flatMap((r) => r.issues);
  const header =
    finalStatus === 'completed'
      ? `Auto-repaired after ${record.length} attempt(s): ${summarizeIssues(flatIssues)}`
      : `Auto-repair exhausted after ${record.length} attempt(s): ${summarizeIssues(flatIssues)}`;
  const existing = readSummary(row.warnings);
  const updated = (await deps.prisma.workflowCopilotMessage.update({
    where: { id: assistantId },
    data: {
      warnings: [header, ...existing] as never,
    },
  })) as MessageRow;
  return updated;
}
