import type { JsonSchema } from '@cepage/shared-core';
import { apiGet, apiPost } from './http';

export type CompilationParameter = {
  name: string;
  occurrences: number;
  inferredType: string;
  hint?: string;
};

export type CompilationReport = {
  parameters: CompilationParameter[];
  estimatedCost: number;
  graphStats: { nodes: number; edges: number };
  warnings: string[];
};

export type CompilationResult = {
  skill: {
    slug?: string;
    title?: string;
    summary?: string;
    icon?: string | null;
    category?: string;
    tags?: string[];
    inputsSchema?: JsonSchema;
    outputsSchema?: JsonSchema;
    kind?: string;
    promptText?: string | null;
    graphJson?: Record<string, unknown>;
    execution?: Record<string, unknown>;
    sourceSessionId?: string;
    visibility?: 'private' | 'workspace' | 'public';
    id?: string;
    version?: string;
  };
  report: CompilationReport;
};

export type CompileBody = {
  sessionId: string;
  agentType: 'opencode' | 'cursor';
  mode: 'draft' | 'publish';
  sessionData?: string;
};

export async function compileSkill(body: CompileBody) {
  return apiPost<CompilationResult>('/api/v1/skill-compiler/compile', body);
}

export async function previewCompile(sessionId: string, agentType?: 'opencode' | 'cursor') {
  const params = agentType ? `?agentType=${encodeURIComponent(agentType)}` : '';
  return apiGet<CompilationResult>(`/api/v1/skill-compiler/sessions/${encodeURIComponent(sessionId)}/preview${params}`);
}
