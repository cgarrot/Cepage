import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { agentTypeSchema } from '@cepage/shared-core';
import { PrismaService } from '../../common/database/prisma.service';
import {
  SHIPPED_DEFAULTS_PATH,
  type AgentPolicyBootstrapPayload,
} from './agent-policy.defaults';

const SINGLETON_ID = 'singleton';

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const bootstrapPayloadSchema = z.object({
  default: z
    .object({
      agentType: agentTypeSchema,
      providerID: z.string().min(1),
      modelID: z.string().min(1),
    })
    .nullable()
    .optional(),
  policies: z
    .array(
      z.object({
        level: z.enum(['agentType', 'provider', 'model']),
        agentType: agentTypeSchema,
        providerID: z.string().min(1).optional(),
        modelID: z.string().min(1).optional(),
        hint: z.string().min(1),
        tags: z.array(z.string().min(1)).optional(),
        priority: z.number().int().optional(),
      }),
    )
    .default([]),
});

@Injectable()
export class AgentPolicyBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AgentPolicyBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.bootstrapIfEmpty();
    } catch (err) {
      this.logger.error(
        `[agent-policy] bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async bootstrapIfEmpty(): Promise<void> {
    // Bootstrap is strictly opt-in. The API will NOT seed any policy or default
    // unless the operator explicitly asks for it. Two ways to opt in:
    //   1. Set AGENT_POLICY_BOOTSTRAP_ENABLED to a truthy value
    //      ("1" | "true" | "yes" | "on") to seed from the shipped JSON at
    //      packages/api/config/agent-policy.defaults.json.
    //   2. Set AGENT_POLICY_BOOTSTRAP_PATH to a JSON file. This implies
    //      opt-in — no need to also set the ENABLED flag.
    // If neither is set, the tables stay empty and the operator configures
    // policies/defaults via the HTTP endpoints.
    const envPathRaw = process.env.AGENT_POLICY_BOOTSTRAP_PATH;
    const hasOverride = !!envPathRaw && envPathRaw.trim().length > 0;
    const enabledFlag = isTruthyEnv(process.env.AGENT_POLICY_BOOTSTRAP_ENABLED);
    if (!hasOverride && !enabledFlag) {
      this.logger.log(
        '[agent-policy] bootstrap skipped (opt-in). Set AGENT_POLICY_BOOTSTRAP_ENABLED=true ' +
          'to seed shipped defaults, or AGENT_POLICY_BOOTSTRAP_PATH=/path/to/policy.json for custom config.',
      );
      return;
    }

    const [policyCount, settingsCount] = await Promise.all([
      this.prisma.agentPolicy.count(),
      this.prisma.copilotSettings.count(),
    ]);
    if (policyCount > 0 || settingsCount > 0) {
      return;
    }

    const { payload, source } = await this.loadPayload(envPathRaw);
    await this.seed(payload);
    this.logger.log(
      `[agent-policy] bootstrapped from ${source}: ${payload.policies.length} policies, ` +
        `default = ${
          payload.default
            ? `${payload.default.agentType}/${payload.default.providerID}/${payload.default.modelID}`
            : '(none)'
        }`,
    );
  }

  private async loadPayload(envPathRaw: string | undefined): Promise<{
    payload: AgentPolicyBootstrapPayload;
    source: string;
  }> {
    const hasOverride = !!envPathRaw && envPathRaw.trim().length > 0;
    const resolved = hasOverride
      ? path.resolve(process.cwd(), envPathRaw!)
      : SHIPPED_DEFAULTS_PATH;
    const sourceLabel = hasOverride
      ? `env AGENT_POLICY_BOOTSTRAP_PATH (${resolved})`
      : `shipped config (${resolved})`;

    const raw = await fs.readFile(resolved, 'utf-8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `agent-policy bootstrap file ${resolved} is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
    const parsed = bootstrapPayloadSchema.parse(parsedJson);
    return {
      payload: {
        default: parsed.default ?? null,
        policies: parsed.policies.map((p) => ({
          level: p.level,
          agentType: p.agentType,
          providerID: p.providerID,
          modelID: p.modelID,
          hint: p.hint,
          tags: p.tags,
          priority: p.priority,
        })),
      },
      source: sourceLabel,
    };
  }

  private async seed(payload: AgentPolicyBootstrapPayload): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (payload.policies.length > 0) {
        await tx.agentPolicy.createMany({
          data: payload.policies.map((entry) => ({
            level: entry.level,
            agentType: entry.agentType,
            providerID: entry.providerID ?? null,
            modelID: entry.modelID ?? null,
            hint: entry.hint,
            tags: entry.tags ?? [],
            priority: entry.priority ?? 0,
          })),
        });
      }
      if (payload.default) {
        await tx.copilotSettings.upsert({
          where: { id: SINGLETON_ID },
          create: {
            id: SINGLETON_ID,
            defaultAgentType: payload.default.agentType,
            defaultProviderID: payload.default.providerID,
            defaultModelID: payload.default.modelID,
          },
          update: {
            defaultAgentType: payload.default.agentType,
            defaultProviderID: payload.default.providerID,
            defaultModelID: payload.default.modelID,
          },
        });
      }
    });
  }
}
