import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import {
  CepageClient,
  CepageHttpError,
  type CepageClientOptions,
  type WorkflowSkill,
} from '@cepage/sdk';
import { runToToolResult, skillToTool, toolNameToSlug } from './tools.js';

// Cepage MCP stdio server. Exposes saved Cepage skills as typed MCP
// tools so any MCP-compatible client (Cursor, Claude Code, Codex,
// OpenCode, VS Code Copilot, Hermes via mcp_tool, …) can call them.
//
// Catalog refresh:
//   - The skill list is fetched lazily on the first `tools/list` call.
//   - TTL-refreshed so new skills saved via the UI appear within a few
//     seconds without requiring the host client to reconnect.
//
// Filtering:
//   - `CEPAGE_MCP_SKILL_FILTER` env var or `filter` option narrows the
//     exposed skills to a comma-separated list of slugs. Useful when the
//     Cepage instance hosts many skills but a Cursor user only wants a
//     few of them.

const DEFAULT_BASE_URL = 'http://localhost:31947';

export type CepageMcpServerOptions = Omit<CepageClientOptions, 'apiUrl'> & {
  apiUrl?: string;
  name?: string;
  version?: string;
  cacheTtlMs?: number;
  runTimeoutMs?: number;
  filter?: string[] | null;
  logger?: (line: string) => void;
};

type CatalogEntry = {
  skills: WorkflowSkill[];
  loadedAt: number;
};

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_RUN_TIMEOUT_MS = 300_000;

export function createCepageMcpServer(options: CepageMcpServerOptions = {}): {
  server: Server;
  client: CepageClient;
  start: () => Promise<void>;
} {
  const apiUrl = normalizeApiUrl(
    options.apiUrl ?? process.env.CEPAGE_URL ?? DEFAULT_BASE_URL,
  );
  const client = new CepageClient({
    apiUrl,
    token: options.token,
    fetchImpl: options.fetchImpl,
    defaultHeaders: options.defaultHeaders,
    userAgent: options.userAgent,
  });
  const name = options.name ?? 'cepage';
  const version = options.version ?? '0.1.0';
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const filter = normalizeFilter(options.filter ?? process.env.CEPAGE_MCP_SKILL_FILTER);
  const log = options.logger ?? defaultStderrLogger;

  const capabilities: ServerCapabilities = { tools: {} };
  const server = new Server({ name, version }, { capabilities });

  let catalogCache: CatalogEntry | null = null;

  async function loadCatalog(forceRefresh = false): Promise<WorkflowSkill[]> {
    if (!forceRefresh && catalogCache && Date.now() - catalogCache.loadedAt < cacheTtlMs) {
      return filterSkills(catalogCache.skills, filter);
    }
    try {
      const skills = await client.skills.list();
      catalogCache = { skills, loadedAt: Date.now() };
      return filterSkills(skills, filter);
    } catch (err) {
      log(`[cepage-mcp] failed to list skills: ${describeError(err)}`);
      if (catalogCache) {
        return filterSkills(catalogCache.skills, filter);
      }
      throw err;
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const skills = await loadCatalog(false);
    return {
      tools: skills.map((skill) => skillToTool(skill)),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const slug = toolNameToSlug(toolName);
    const skills = await loadCatalog(true);
    const match = skills.find(
      (skill) => skill.id === slug || skillMatchesToolName(skill, toolName),
    );
    if (!match) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Unknown Cepage skill: ${toolName}. The catalog may have changed — ask the client to refresh its tool list.`,
          },
        ],
        isError: true,
      };
    }

    const inputs = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const run = await client.skills.run(match.id, {
        inputs,
        wait: true,
        timeoutMs: runTimeoutMs,
        triggeredBy: 'mcp',
      });
      return runToToolResult(run);
    } catch (err) {
      const detail =
        err instanceof CepageHttpError
          ? `HTTP ${err.status}: ${err.message}`
          : describeError(err);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cepage run for "${match.id}" failed: ${detail}`,
          },
        ],
        isError: true,
      };
    }
  });

  const start = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log(`[cepage-mcp] ready (api=${client.apiUrl}, filter=${filter ? filter.join(',') : 'none'})`);
  };

  return { server, client, start };
}

function normalizeApiUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (/\/api\/v1$/.test(trimmed)) return trimmed;
  return `${trimmed}/api/v1`;
}

function filterSkills(skills: WorkflowSkill[], filter: string[] | null): WorkflowSkill[] {
  if (!filter || filter.length === 0) return skills;
  const allowed = new Set(filter);
  return skills.filter((skill) => allowed.has(skill.id));
}

function skillMatchesToolName(skill: WorkflowSkill, toolName: string): boolean {
  return skill.id.replace(/-/g, '_') === toolName.replace(/^cepage_/, '');
}

function normalizeFilter(input: string[] | string | null | undefined): string[] | null {
  if (!input) return null;
  const values = Array.isArray(input)
    ? input
    : input.split(',').map((entry) => entry.trim());
  const filtered = values.filter((entry) => entry.length > 0);
  return filtered.length === 0 ? null : filtered;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function defaultStderrLogger(line: string): void {
  // Stderr, never stdout — stdio transport reserves stdout for framed
  // MCP messages. Anything we write to stdout would corrupt the protocol
  // stream.
  console.error(line);
}
