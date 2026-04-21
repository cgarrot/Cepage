/**
 * Agent-policy bootstrap payload types.
 *
 * The actual data lives in a JSON config file (NOT in TypeScript) so operators
 * can edit defaults without recompiling:
 *
 *   - Shipped file:   packages/api/config/agent-policy.defaults.json
 *   - Override env:   AGENT_POLICY_BOOTSTRAP_PATH=/abs/path/to/policy.json
 *
 * Shape:
 *   {
 *     "default": { "agentType": "...", "providerID": "...", "modelID": "..." } | null,
 *     "policies": [
 *       { "level": "agentType" | "provider" | "model",
 *         "agentType": "...", "providerID"?: "...", "modelID"?: "...",
 *         "hint": "text", "tags"?: ["..."], "priority"?: 0 }
 *     ]
 *   }
 *
 * The file is read at runtime by `AgentPolicyBootstrapService` on first start
 * (i.e. both tables empty). Once either table has a row, the bootstrap service
 * is a no-op and subsequent edits flow through the HTTP endpoints.
 */

export interface AgentPolicyBootstrapEntry {
  level: 'agentType' | 'provider' | 'model';
  agentType: string;
  providerID?: string;
  modelID?: string;
  hint: string;
  tags?: string[];
  priority?: number;
}

export interface AgentPolicyBootstrapDefault {
  agentType: string;
  providerID: string;
  modelID: string;
}

export interface AgentPolicyBootstrapPayload {
  default: AgentPolicyBootstrapDefault | null;
  policies: AgentPolicyBootstrapEntry[];
}

import * as path from 'node:path';

/**
 * Absolute path to the JSON shipped with the API package. Resolved relative to
 * this compiled file so it works in both `src/` (ts-node / vitest) and `dist/`
 * (production) layouts — both resolve up to `packages/api/` then into `config/`.
 */
export const SHIPPED_DEFAULTS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'config',
  'agent-policy.defaults.json',
);
