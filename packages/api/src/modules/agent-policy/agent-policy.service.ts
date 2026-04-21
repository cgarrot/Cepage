import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type {
  AgentCatalogForPrompt,
  AgentPolicyEntry,
  AgentPolicyLevel,
  AgentType,
  CopilotSettings,
} from '@cepage/shared-core';
import {
  agentCatalogForPromptSchema,
  agentPolicyEntrySchema,
  copilotSettingsSchema,
} from '@cepage/shared-core';

/**
 * One fully-qualified model binding in a fallback chain. Always carries an
 * `agentType` so the daemon selection logic stays simple (same agentType as
 * the primary — we don't cross-fall-back between agent types; see plan
 * non-goals).
 */
export interface FallbackChainEntry {
  agentType: AgentType;
  providerID: string;
  modelID: string;
}

/** Upper bound on chain length (primary + N-1 fallbacks). */
const FALLBACK_CHAIN_MAX = 5;
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AgentsService } from '../agents/agents.service';

const SINGLETON_ID = 'singleton';

type PolicyRow = Prisma.AgentPolicyGetPayload<Record<string, never>>;
type SettingsRow = Prisma.CopilotSettingsGetPayload<Record<string, never>>;

function rowToEntry(row: PolicyRow): AgentPolicyEntry {
  return agentPolicyEntrySchema.parse({
    id: row.id,
    level: row.level as AgentPolicyLevel,
    agentType: row.agentType ?? undefined,
    providerID: row.providerID ?? undefined,
    modelID: row.modelID ?? undefined,
    hint: row.hint,
    tags: row.tags ?? [],
    priority: row.priority ?? 0,
  });
}

function settingsRowToDto(row: SettingsRow | null): CopilotSettings {
  return copilotSettingsSchema.parse({
    defaultAgentType: (row?.defaultAgentType as AgentType | null | undefined) ?? null,
    defaultProviderID: row?.defaultProviderID ?? null,
    defaultModelID: row?.defaultModelID ?? null,
  });
}

@Injectable()
export class AgentPolicyService {
  private readonly logger = new Logger(AgentPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agents: AgentsService,
  ) {}

  async listAll(): Promise<{ policies: AgentPolicyEntry[]; defaults: CopilotSettings }> {
    const [rows, settings] = await Promise.all([
      this.prisma.agentPolicy.findMany({
        orderBy: [{ priority: 'desc' }, { level: 'asc' }, { agentType: 'asc' }],
      }),
      this.prisma.copilotSettings.findUnique({ where: { id: SINGLETON_ID } }),
    ]);
    return {
      policies: rows.map((row) => rowToEntry(row)),
      defaults: settingsRowToDto(settings),
    };
  }

  async replacePolicies(input: AgentPolicyEntry[]): Promise<{ policies: AgentPolicyEntry[] }> {
    const normalized = input.map((entry) => agentPolicyEntrySchema.parse(entry));
    await this.prisma.$transaction(async (tx) => {
      await tx.agentPolicy.deleteMany({});
      if (normalized.length > 0) {
        await tx.agentPolicy.createMany({
          data: normalized.map((entry) => ({
            level: entry.level,
            agentType: entry.agentType ?? null,
            providerID: entry.providerID ?? null,
            modelID: entry.modelID ?? null,
            hint: entry.hint,
            tags: entry.tags ?? [],
            priority: entry.priority ?? 0,
          })),
        });
      }
    });
    const refreshed = await this.prisma.agentPolicy.findMany({
      orderBy: [{ priority: 'desc' }, { level: 'asc' }, { agentType: 'asc' }],
    });
    this.logger.log(`[agent-policy] replaced ${normalized.length} policies`);
    return { policies: refreshed.map((row) => rowToEntry(row)) };
  }

  async setDefaults(input: CopilotSettings): Promise<CopilotSettings> {
    const normalized = copilotSettingsSchema.parse(input);
    const payload = {
      defaultAgentType: normalized.defaultAgentType ?? null,
      defaultProviderID: normalized.defaultProviderID ?? null,
      defaultModelID: normalized.defaultModelID ?? null,
    };
    const updated = await this.prisma.copilotSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...payload },
      update: payload,
    });
    this.logger.log(
      `[agent-policy] defaults set to ${payload.defaultAgentType ?? '(none)'} / ` +
        `${payload.defaultProviderID ?? '(none)'} / ${payload.defaultModelID ?? '(none)'}`,
    );
    return settingsRowToDto(updated);
  }

  /**
   * Assembles the workflow-copilot-prompt payload: the live daemon catalog,
   * plus every policy row (ordered by descending priority then level/agentType),
   * plus the singleton defaults. Returns a `catalog: null` when the daemon has
   * not published anything yet — the prompt renderer turns that into a visible
   * "catalog unavailable" warning.
   */
  async getCatalogForPrompt(): Promise<AgentCatalogForPrompt> {
    const [catalog, { policies, defaults }] = await Promise.all([
      this.agents.listCatalogForPrompt(),
      this.listAll(),
    ]);
    return agentCatalogForPromptSchema.parse({ catalog, policies, defaults });
  }

  /**
   * Build an ordered fallback chain starting with the primary binding and
   * continuing with sibling model-level policies.
   *
   * Rules:
   * - Only `level='model'` policies contribute fallbacks (they are the only
   *   ones with a full `(agentType, providerID, modelID)` triplet).
   * - A policy is considered a candidate when its `agentType` matches the
   *   primary's `agentType` AND (no tag was asked OR the tag appears in the
   *   policy's `tags`).
   * - Candidates are sorted by descending `priority`. Ties are resolved by
   *   stable insertion order from the DB (which already applies the same
   *   secondary sort: `level asc`, `agentType asc`).
   * - The primary is always first; duplicates of the primary (by triplet
   *   equality) are removed from the tail; further duplicates among
   *   candidates are also removed.
   * - The chain is capped at `FALLBACK_CHAIN_MAX` entries.
   *
   * When `tag` is omitted, the chain still reorders by priority across all
   * same-agent-type model policies — useful as a last-resort fallback when
   * the copilot forgot to set a tag.
   */
  async resolveFallbackChain(
    primary: FallbackChainEntry,
    tag: string | undefined,
  ): Promise<FallbackChainEntry[]> {
    const rows = await this.prisma.agentPolicy.findMany({
      where: { level: 'model', agentType: primary.agentType },
      orderBy: [{ priority: 'desc' }, { agentType: 'asc' }],
    });

    const chain: FallbackChainEntry[] = [
      {
        agentType: primary.agentType,
        providerID: primary.providerID,
        modelID: primary.modelID,
      },
    ];
    const seen = new Set<string>([keyOf(primary)]);

    for (const row of rows) {
      if (chain.length >= FALLBACK_CHAIN_MAX) break;
      if (!row.providerID || !row.modelID || !row.agentType) continue;
      if (tag && tag.length > 0) {
        const tags = row.tags ?? [];
        if (!tags.includes(tag)) continue;
      }
      const entry: FallbackChainEntry = {
        agentType: row.agentType as AgentType,
        providerID: row.providerID,
        modelID: row.modelID,
      };
      const key = keyOf(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      chain.push(entry);
    }

    return chain;
  }
}

function keyOf(entry: FallbackChainEntry): string {
  return `${entry.agentType}\x00${entry.providerID}\x00${entry.modelID}`;
}
