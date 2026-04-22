import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pipeline } from 'node:stream/promises';

import type { GlobalFlags } from '../main.js';
import { createContext } from '../context.js';
import { UsageError } from '../errors.js';
import {
  emitJson,
  emitLine,
  emitStatus,
  makeColors,
  renderTable,
  trim,
} from '../output.js';

const SUBCOMMAND_USAGE = `Usage:
  cepage import cursor [--session-id <id>] [--latest] [--file <path>] [--draft|--publish]
`;

interface CompilationParameter {
  name: string;
  occurrences: number;
  inferredType: string;
  hint?: string;
}

interface CompilationReport {
  parameters: CompilationParameter[];
  estimatedCost: number;
  graphStats: { nodes: number; edges: number };
  warnings: string[];
}

interface CompilationResult {
  skill: {
    slug?: string;
    title?: string;
    summary?: string;
    id?: string;
    version?: string;
    inputsSchema?: Record<string, unknown>;
    outputsSchema?: Record<string, unknown>;
    sourceSessionId?: string;
  };
  report: CompilationReport;
}

export async function importCommand(argv: string[], flags: GlobalFlags): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'cursor':
      return cursorImport(rest, flags);
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(SUBCOMMAND_USAGE);
      return 0;
    default:
      throw new UsageError(`unknown import subcommand "${sub}"`, {
        hint: SUBCOMMAND_USAGE,
      });
  }
}

async function cursorImport(argv: string[], flags: GlobalFlags): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      'session-id': { type: 'string', short: 's' },
      latest: { type: 'boolean', short: 'l' },
      file: { type: 'string', short: 'f' },
      draft: { type: 'boolean', short: 'd' },
      publish: { type: 'boolean', short: 'p' },
    },
    strict: true,
  });

  const sessionId = parsed.values['session-id'] as string | undefined;
  const latest = parsed.values.latest === true;
  const filePath = parsed.values.file as string | undefined;
  const draft = parsed.values.draft === true;
  const publish = parsed.values.publish === true;

  if (draft && publish) {
    throw new UsageError('cannot use both --draft and --publish');
  }

  const mode = draft ? 'draft' : 'publish';

  let storeDbPath: string | undefined;
  let resolvedSessionId: string | undefined;

  if (filePath) {
    storeDbPath = resolve(filePath);
    resolvedSessionId = basename(dirname(storeDbPath));
  } else if (sessionId) {
    resolvedSessionId = sessionId;
    storeDbPath = await findCursorStoreDb(sessionId);
    if (!storeDbPath) {
      throw new UsageError(`Cursor session "${sessionId}" not found in ~/.cursor/chats/`);
    }
  } else if (latest) {
    const found = await findLatestCursorSession();
    if (!found) {
      throw new UsageError('No Cursor sessions found in ~/.cursor/chats/');
    }
    storeDbPath = found.path;
    resolvedSessionId = found.sessionId;
  } else {
    throw new UsageError('specify one of --session-id, --latest, or --file', {
      hint: SUBCOMMAND_USAGE,
    });
  }

  const ctx = await createContext(flags);
  const colors = makeColors(flags.color);

  // The API restricts sessionData to cwd or tmpdir; copy to tmp to ensure it is allowed.
  const tmpStoreDb = await copyToTemp(storeDbPath);

  const result = await ctx.client.http.request<CompilationResult>('POST', '/skill-compiler/compile', {
    body: {
      sessionId: resolvedSessionId,
      agentType: 'cursor',
      mode,
      sessionData: tmpStoreDb,
    },
  });

  if (flags.json) {
    emitJson(result);
    return 0;
  }

  const skill = result.skill;
  const report = result.report;

  emitLine();
  emitLine(colors.bold(`${skill.title ?? 'Compiled skill'}  ${colors.dim(`(${skill.slug ?? 'no-slug'})`)}`));
  if (skill.summary) emitLine(skill.summary);
  emitLine();
  emitLine(`${colors.dim('session')}: ${resolvedSessionId}`);
  emitLine(`${colors.dim('mode')}: ${mode}`);
  emitLine(`${colors.dim('nodes')}: ${report.graphStats.nodes}  ${colors.dim('edges')}: ${report.graphStats.edges}`);
  emitLine(`${colors.dim('estimated cost')}: ${report.estimatedCost}`);
  emitLine();

  if (report.parameters.length > 0) {
    emitLine(colors.bold('Detected parameters'));
    const rows = report.parameters.map((p) => ({
      name: p.name,
      type: p.inferredType,
      occurrences: String(p.occurrences),
      hint: trim(p.hint, 40) || '',
    }));
    emitLine(renderTable(rows, ['name', 'type', 'occurrences', 'hint']));
    emitLine();
  }

  if (report.warnings.length > 0) {
    emitLine(colors.yellow('Warnings'));
    for (const w of report.warnings) {
      emitLine(`  ${colors.yellow('⚠')} ${w}`);
    }
    emitLine();
  }

  if (mode === 'draft') {
    emitLine(colors.dim('This is a draft preview. Use --publish to save the skill.'));
  } else {
    emitLine(emitStatus('published', 'ok', colors));
    emitLine(`Skill saved as ${colors.bold(skill.slug ?? '')}`);
  }

  return 0;
}

async function findCursorStoreDb(sessionId: string): Promise<string | undefined> {
  const chatsDir = join(homedir(), '.cursor', 'chats');
  try {
    const workspaces = await readdir(chatsDir, { withFileTypes: true });
    for (const ws of workspaces) {
      if (!ws.isDirectory()) continue;
      const sessionDir = join(chatsDir, ws.name, sessionId);
      const dbPath = join(sessionDir, 'store.db');
      try {
        const s = await stat(dbPath);
        if (s.isFile()) return dbPath;
      } catch { }
    }
  } catch { }
  return undefined;
}

async function findLatestCursorSession(): Promise<{ path: string; sessionId: string } | undefined> {
  const chatsDir = join(homedir(), '.cursor', 'chats');
  let latestPath: string | undefined;
  let latestMtime = 0;
  let latestSessionId = '';

  try {
    const workspaces = await readdir(chatsDir, { withFileTypes: true });
    for (const ws of workspaces) {
      if (!ws.isDirectory()) continue;
      const wsPath = join(chatsDir, ws.name);
      const sessions = await readdir(wsPath, { withFileTypes: true });
      for (const session of sessions) {
        if (!session.isDirectory()) continue;
        const dbPath = join(wsPath, session.name, 'store.db');
        try {
          const s = await stat(dbPath);
          if (s.isFile() && s.mtimeMs > latestMtime) {
            latestMtime = s.mtimeMs;
            latestPath = dbPath;
            latestSessionId = session.name;
          }
        } catch { }
      }
    }
  } catch { }

  if (latestPath) {
    return { path: latestPath, sessionId: latestSessionId };
  }
  return undefined;
}

async function copyToTemp(sourcePath: string): Promise<string> {
  const destDir = join(tmpdir(), 'cepage-import-cursor');
  await mkdir(destDir, { recursive: true });
  const destPath = join(destDir, basename(sourcePath));
  await pipeline(createReadStream(sourcePath), createWriteStream(destPath));
  return destPath;
}
