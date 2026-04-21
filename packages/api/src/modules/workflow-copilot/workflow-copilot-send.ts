import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  WORKFLOW_COPILOT_CURSOR_ATTACHMENT_INLINE_MAX_BYTES,
  workflowCopilotAttachmentMimeInlinableForCursorAgent,
  workflowCopilotAttachmentTotalBytes,
  workflowCopilotSendMessageSchema,
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

  const ac = new AbortController();
  deps.abortByThread.set(input.threadId, ac);
  let live = '';
  let sent = '';
  // Reasoning stream mirror of `live`/`sent`: persisted to `thinkingOutput` so
  // refreshes mid-run still show the live "Thinking…" trail, and the final
  // assistant write keeps it for replay after the run completes.
  let liveThinking = '';
  let sentThinking = '';
  let stamp = 0;
  const sync = async (progress: RunThreadProgress, force = false) => {
    const output = readLiveOutput(progress);
    const nextThinking = progress.thinkingOutput;
    const now = Date.now();
    if (progress.externalSessionId && progress.externalSessionId !== thread.externalSessionId) {
      thread = await deps.prisma.workflowCopilotThread.update({
        where: { id: input.threadId },
        data: { externalSessionId: progress.externalSessionId },
      }) as ThreadRow;
      deps.emitThreadRow(input.sessionId, thread);
    }
    if (!force && !output && !nextThinking) {
      return;
    }
    if (!force && output === sent && nextThinking === sentThinking) {
      return;
    }
    if (!force && now - stamp < 120) {
      live = output || live;
      liveThinking = nextThinking || liveThinking;
      return;
    }
    live = output || live;
    liveThinking = nextThinking || liveThinking;
    assistant = await deps.prisma.workflowCopilotMessage.update({
      where: { id: assistant.id },
      data: {
        rawOutput: live || null,
        thinkingOutput: liveThinking || null,
      },
    }) as MessageRow;
    deps.emitMessageRow(input.sessionId, thread, assistant);
    sent = live;
    sentThinking = liveThinking;
    stamp = now;
  };

  let run: RunTurnResult;
  try {
    run = await deps.runThread(
      session,
      {
        ...thread,
        agentType,
        modelProviderId: model?.providerID ?? null,
        modelId: model?.modelID ?? null,
        scope,
        mode,
        autoApply,
        autoRun,
      },
      history,
      ac.signal,
      async (progress) => {
        await sync(progress);
      },
    );
  } finally {
    if (deps.abortByThread.get(input.threadId) === ac) {
      deps.abortByThread.delete(input.threadId);
    }
  }

  const rawTurn = run.ok ? run.turn : null;
  const turn = rawTurn ? sanitizeTurn(rawTurn, mode) : null;
  const output = live || run.rawOutput;

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
    thread = await deps.prisma.workflowCopilotThread.update({
      where: { id: input.threadId },
      data: { metadata: metadata as never },
    }) as ThreadRow;
    deps.emitThreadRow(input.sessionId, thread);
  }

  if (run.externalSessionId) {
    thread = await deps.prisma.workflowCopilotThread.update({
      where: { id: input.threadId },
      data: { externalSessionId: run.externalSessionId },
    }) as ThreadRow;
    deps.emitThreadRow(input.sessionId, thread);
  }

  assistant = await deps.prisma.workflowCopilotMessage.update({
    where: { id: assistant.id },
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
  }) as MessageRow;
  deps.emitMessageRow(input.sessionId, thread, assistant);

  let sendFileSummaryNodeId: string | undefined;
  if (run.ok && turn && atts.length > 0) {
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
        const bundle = await deps.readBundle(input.sessionId, input.threadId);
        return {
          thread: bundle.thread,
          userMessage: rowToMessage(userRow, mode),
          assistantMessage: rowToMessage(assistant, mode),
          checkpoints: bundle.checkpoints,
        };
      }
    }
  }

  if (!turn || mode === 'ask') {
    const bundle = await deps.readBundle(input.sessionId, input.threadId);
    return {
      thread: bundle.thread,
      userMessage: rowToMessage(userRow, mode),
      assistantMessage: rowToMessage(assistant, mode),
      checkpoints: bundle.checkpoints,
      ...(sendFileSummaryNodeId ? { fileSummaryNodeId: sendFileSummaryNodeId } : {}),
    };
  }

  let bundle = await deps.readBundle(input.sessionId, input.threadId);
  let assistantMessage =
    bundle.messages.find((entry) => entry.id === assistant.id) ?? rowToMessage(assistant, mode);
  if (!assistantMessage) {
    throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
  }

  let applyFailed = false;
  if (autoApply && turn.ops.length > 0) {
    try {
      const applied = await deps.applyMessage(input.sessionId, input.threadId, assistant.id);
      deps.emitCopilotMessage(input.sessionId, {
        thread: applied.thread,
        message: applied.message,
        checkpoints: applied.checkpoints,
      });
      bundle = await deps.readBundle(input.sessionId, input.threadId);
      assistantMessage = bundle.messages.find((entry) => entry.id === assistant.id) ?? assistantMessage;
    } catch (error) {
      applyFailed = true;
      if (!(error instanceof BadRequestException)) throw error;
      await deps.prisma.workflowCopilotMessage.update({
        where: { id: assistant.id },
        data: {
          status: 'error',
          error: formatApplyError(error),
        },
      });
      bundle = await deps.readBundle(input.sessionId, input.threadId);
      const nextMessage = bundle.messages.find((entry) => entry.id === assistant.id);
      if (!nextMessage) {
        throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
      }
      deps.emitCopilotMessage(input.sessionId, {
        thread: bundle.thread,
        message: nextMessage,
        checkpoints: bundle.checkpoints,
      });
      return {
        thread: bundle.thread,
        userMessage: rowToMessage(userRow),
        assistantMessage: nextMessage,
        checkpoints: bundle.checkpoints,
        ...(sendFileSummaryNodeId ? { fileSummaryNodeId: sendFileSummaryNodeId } : {}),
      };
    }
  }

  if (autoRun && turn.executions.length > 0 && !applyFailed) {
    const row = await deps.prisma.workflowCopilotMessage.findUnique({
      where: { id: assistant.id },
    });
    if (!row) {
      throw new NotFoundException('WORKFLOW_COPILOT_MESSAGE_NOT_FOUND');
    }
    const refMap = readApply(row.apply)?.refMap ?? {};
    const results = await deps.runCopilotExecutions(input.sessionId, turn.executions, refMap);
    const warnExtra = results
      .filter((r) => !r.ok)
      .map((r) => `${r.kind}: ${r.error ?? 'WORKFLOW_COPILOT_EXECUTION_FAILED'}`);
    const prevWarn = readSummary(row.warnings);
    await deps.prisma.workflowCopilotMessage.update({
      where: { id: assistant.id },
      data: {
        executionResults: results as never,
        ...(warnExtra.length > 0 ? { warnings: [...prevWarn, ...warnExtra] as never } : {}),
      },
    });
    bundle = await deps.readBundle(input.sessionId, input.threadId);
    assistantMessage = bundle.messages.find((entry) => entry.id === assistant.id) ?? assistantMessage;
    deps.emitCopilotMessage(input.sessionId, {
      thread: bundle.thread,
      message: assistantMessage,
      checkpoints: bundle.checkpoints,
    });
  }

  return {
    thread: bundle.thread,
    userMessage: rowToMessage(userRow),
    assistantMessage,
    checkpoints: bundle.checkpoints,
    ...(sendFileSummaryNodeId ? { fileSummaryNodeId: sendFileSummaryNodeId } : {}),
  };
}
