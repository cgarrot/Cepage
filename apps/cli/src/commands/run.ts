import { parseArgs } from 'node:util';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GlobalFlags } from '../main.js';
import { createContext } from '../context.js';
import { UsageError } from '../errors.js';
import {
  emitJson,
  emitLine,
  emitStatus,
  makeColors,
} from '../output.js';

const SUBCOMMAND_USAGE = `Usage:
  cepage run opencode [--prompt <text>] [--capture] [--auto-compile] [--cwd <path>]
`;

export async function runCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'opencode':
      return runOpenCode(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown run subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function runOpenCode(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      prompt: { type: 'string' },
      capture: { type: 'boolean' },
      'auto-compile': { type: 'boolean' },
      cwd: { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  const prompt = parsed.values.prompt as string | undefined;
  const capture = parsed.values.capture === true;
  const autoCompile = parsed.values['auto-compile'] === true;
  const cwd = parsed.values.cwd as string | undefined;

  if (!prompt) {
    throw new UsageError('run opencode requires --prompt');
  }

  const ctx = await createContext(flags);
  const colors = makeColors(flags.color);

  const session = await createSession(ctx);
  emitLine(colors.dim(`Session: ${session.id}`));

  const nodeId = await createPromptNode(ctx, session.id, prompt);
  const spawnResult = await spawnAgent(ctx, session.id, nodeId, cwd);

  emitLine(
    `Agent run: ${spawnResult.agentRunId} (${emitStatus(
      spawnResult.status,
      agentStatusTone(spawnResult.status),
      colors,
    )})`,
  );

  const terminalRun = await pollForTerminal(ctx, session.id, spawnResult.agentRunId);
  emitLine(`Status: ${emitStatus(terminalRun.status, agentStatusTone(terminalRun.status), colors)}`);

  if (capture || autoCompile) {
    await captureAndCompile(ctx, session.id, autoCompile, flags);
  }

  return 0;
}

async function createSession(ctx: Awaited<ReturnType<typeof createContext>>) {
  return ctx.client.http.request<{ id: string; name: string }>('POST', '/sessions', {
    body: { name: 'OpenCode CLI run' },
  });
}

async function createPromptNode(
  ctx: Awaited<ReturnType<typeof createContext>>,
  sessionId: string,
  prompt: string,
) {
  const result = await ctx.client.http.request<{ node: { id: string }; eventId: number }>(
    'POST',
    `/sessions/${sessionId}/nodes`,
    {
      body: {
        type: 'human_message',
        content: { text: prompt },
        position: { x: 0, y: 0 },
      },
    },
  );
  return result.node.id;
}

async function spawnAgent(
  ctx: Awaited<ReturnType<typeof createContext>>,
  sessionId: string,
  nodeId: string,
  cwd: string | undefined,
) {
  return ctx.client.http.request<{
    agentRunId: string;
    rootNodeId: string;
    status: string;
  }>('POST', `/sessions/${sessionId}/agents/spawn`, {
    body: {
      type: 'opencode',
      role: 'assistant',
      runtime: { kind: 'local_process', cwd: cwd || process.cwd() },
      wakeReason: 'human_prompt',
      seedNodeIds: [nodeId],
    },
  });
}

async function pollForTerminal(
  ctx: Awaited<ReturnType<typeof createContext>>,
  sessionId: string,
  agentRunId: string,
) {
  const maxAttempts = 360;
  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    await sleep(5000);
    const graph = await ctx.client.http.request<{
      agentRuns: Array<{ id: string; status: string; endedAt?: string }>;
    }>('GET', `/sessions/${sessionId}/graph`);
    const run = graph.agentRuns.find((r) => r.id === agentRunId);
    if (run && (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')) {
      return run;
    }
  }
  throw new Error('Agent run timed out waiting for terminal state');
}

async function captureAndCompile(
  ctx: Awaited<ReturnType<typeof createContext>>,
  sessionId: string,
  autoCompile: boolean,
  flags: GlobalFlags,
): Promise<void> {
  const colors = makeColors(flags.color);

  emitLine(colors.dim('Capturing session...'));

  const workflow = await ctx.client.http.request<Record<string, unknown>>(
    'GET',
    `/sessions/${sessionId}/workflow/export`,
  );

  const tmpDir = await mkdtemp(join(tmpdir(), 'cepage-capture-'));
  const tmpFile = join(tmpDir, 'session.json');
  await writeFile(tmpFile, JSON.stringify(workflow, null, 2));

  try {
    emitLine(colors.dim('Proposing compilation...'));
    const draftResult = await ctx.client.http.request<{
      skill: {
        slug?: string;
        title?: string;
        summary?: string;
        inputsSchema?: Record<string, unknown>;
        outputsSchema?: Record<string, unknown>;
      };
      report: {
        parameters?: Array<Record<string, unknown>>;
        estimatedCost?: number;
        graphStats?: { nodes: number; edges: number };
        warnings?: string[];
      };
    }>('POST', '/skill-compiler/compile', {
      body: {
        sessionId,
        agentType: 'opencode',
        mode: 'draft',
        sessionData: tmpFile,
      },
    });

    if (flags.json) {
      emitJson(draftResult);
    } else {
      emitLine();
      emitLine(colors.bold('Compilation Proposal'));
      emitLine(`Title:   ${draftResult.skill.title ?? 'N/A'}`);
      emitLine(`Slug:    ${draftResult.skill.slug ?? 'N/A'}`);
      emitLine(`Summary: ${draftResult.skill.summary ?? 'N/A'}`);
      if (draftResult.report) {
        emitLine();
        emitLine(colors.bold('Report'));
        emitLine(`  Parameters: ${draftResult.report.parameters?.length ?? 0}`);
        emitLine(`  Est. cost:  ${draftResult.report.estimatedCost ?? 'N/A'}`);
        emitLine(`  Nodes:      ${draftResult.report.graphStats?.nodes ?? 'N/A'}`);
        emitLine(`  Edges:      ${draftResult.report.graphStats?.edges ?? 'N/A'}`);
        if (draftResult.report.warnings?.length) {
          emitLine(colors.yellow('  Warnings:'));
          for (const warning of draftResult.report.warnings) {
            emitLine(`    - ${warning}`);
          }
        }
      }
    }

    if (autoCompile) {
      emitLine(colors.dim('Publishing skill...'));
      const publishResult = await ctx.client.http.request<{
        skill: { slug?: string; title?: string };
      }>('POST', '/skill-compiler/compile', {
        body: {
          sessionId,
          agentType: 'opencode',
          mode: 'publish',
          sessionData: tmpFile,
        },
      });
      emitLine(`Published: ${publishResult.skill.slug ?? 'N/A'}`);
    }
  } finally {
    await unlink(tmpFile).catch(() => undefined);
    await rmdir(tmpDir).catch(() => undefined);
  }
}

function agentStatusTone(status: string): 'ok' | 'warn' | 'err' | 'info' {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return 'ok';
    case 'failed':
    case 'cancelled':
      return 'err';
    case 'running':
      return 'info';
    default:
      return 'warn';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
