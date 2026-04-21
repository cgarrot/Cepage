import {
  describeAgentToolset,
  readFileSummaryContent,
  readWorkflowArtifactContent,
  readWorkflowDecisionValidatorContent,
  readWorkflowInputContent,
  resolveWorkflowArtifactRelativePath,
  type AgentDelegationContext,
  type AgentKernelRecallEntry,
  type AgentToolsetId,
  type GraphNode,
  type WorkflowArtifactContent,
} from '@cepage/shared-core';
import { buildFileContextBlock } from '../graph/file-node.util';
import type { ManagedPhasePromptContract } from './agents.types';
import { claimRef, trimText } from './workflow-inputs.util';

export function buildWorkspaceFilePromptBlock(
  content: WorkflowArtifactContent,
  runId?: string,
): string {
  const resolvedPath =
    content.role === 'output'
      ? resolveWorkflowArtifactRelativePath(content, runId)
      : resolveWorkflowArtifactRelativePath(content);
  const ref =
    (content.transferMode ?? 'reference') === 'claim_check'
      ? content.role === 'output' && runId
        ? claimRef(runId, resolvedPath)
        : content.claimRef?.trim()
          ? content.claimRef.trim()
          : content.sourceRunId
            ? claimRef(content.sourceRunId, resolvedPath)
            : null
      : content.claimRef?.trim() ?? null;
  const lines = [`[Workspace file: ${content.title?.trim() || content.relativePath}]`];
  lines.push(`Path: ${resolvedPath}`);
  if (resolvedPath !== content.relativePath) {
    lines.push(`Template path: ${content.relativePath}`);
  }
  if ((content.pathMode ?? 'static') !== 'static') {
    lines.push(`Path mode: ${content.pathMode}`);
  }
  lines.push(`Role: ${content.role}`);
  lines.push(`Origin: ${content.origin}`);
  lines.push(`Transfer: ${content.transferMode ?? 'reference'}`);
  lines.push(`Kind: ${content.kind}`);
  if (content.mimeType?.trim()) {
    lines.push(`Mime: ${content.mimeType.trim()}`);
  }
  if (content.size != null) {
    lines.push(`Size: ${content.size} bytes`);
  }
  if (ref) {
    lines.push(`Claim check: ${ref}`);
  }
  if (content.summary?.trim()) {
    lines.push('', 'Summary:', content.summary.trim());
  }
  if (content.excerpt?.trim()) {
    lines.push('', 'Excerpt:', content.excerpt.trim());
  }
  return lines.join('\n');
}

export function buildInputPromptBlock(node: GraphNode): string | null {
  const content = readWorkflowInputContent(node.content);
  if (!content) return null;
  const title = content.label?.trim() || content.key?.trim() || 'Input';
  if (content.mode === 'template') {
    const accepts = (content.accepts?.length ? content.accepts : ['text', 'image', 'file']).join(', ');
    const lines = [
      `[Workflow input slot: ${title}]`,
      `Accepts: ${accepts}`,
      `Mode: ${content.multiple ? 'multiple parts' : 'single part'}`,
      `Required: ${content.required ? 'yes' : 'no'}`,
    ];
    if (content.instructions?.trim()) {
      lines.push('', 'Instructions:', content.instructions.trim());
    }
    return lines.join('\n');
  }

  const lines = [`[Workflow input: ${title}]`];
  if (content.summary?.trim()) {
    lines.push('', 'Summary:', content.summary.trim());
  }
  content.parts.forEach((part, index) => {
    if (part.type === 'text') {
      lines.push('', `Text ${index + 1}:`, part.text.trim());
      return;
    }
    lines.push(
      '',
      `${part.type === 'image' ? 'Image' : 'File'} ${index + 1}:`,
      `name: ${part.file.name}`,
      `mime: ${part.file.mimeType}`,
      `size: ${part.file.size} bytes`,
    );
    if (part.relativePath?.trim()) {
      lines.push(`path: ${part.relativePath.trim()}`);
    }
    lines.push(`transfer: ${part.transferMode ?? 'reference'}`);
    if (part.claimRef?.trim()) {
      lines.push(`claim: ${part.claimRef.trim()}`);
    }
    if (part.file.width && part.file.height) {
      lines.push(`dimensions: ${part.file.width}x${part.file.height}`);
    }
    if (!part.relativePath?.trim() && part.extractedText?.trim()) {
      lines.push('', 'Extracted content:', part.extractedText.trim());
      return;
    }
    const extract = trimText(part.extractedText, 400);
    if (extract && part.transferMode === 'context') {
      lines.push('', 'Excerpt:', extract);
    }
  });
  return lines.join('\n');
}

function buildStepPromptBlock(node: GraphNode): string | null {
  if (node.type !== 'agent_step' && node.type !== 'agent_spawn' && node.type !== 'runtime_target') {
    return null;
  }
  const brief = typeof node.metadata?.brief === 'string' ? node.metadata.brief.trim() : '';
  if (!brief) {
    return null;
  }
  return ['[Workflow step brief]', brief].join('\n\n');
}

export function resolveContractPath(nodes: GraphNode[], ref: string, runId?: string): string {
  const art =
    nodes
      .filter((node) => node.type === 'workspace_file')
      .map((node) => readWorkflowArtifactContent(node.content))
      .filter(
        (
          item,
        ): item is NonNullable<ReturnType<typeof readWorkflowArtifactContent>> =>
          Boolean(item?.relativePath === ref),
      )
      .sort((a, b) => contractPathScore(b) - contractPathScore(a))[0]
    ?? null;
  if (!art) {
    return ref;
  }
  return resolveWorkflowArtifactRelativePath(art, art.role === 'output' ? runId : undefined);
}

function describeCheck(
  nodes: GraphNode[],
  check: NonNullable<ReturnType<typeof readWorkflowDecisionValidatorContent>>['checks'][number],
  runId?: string,
): string {
  if (check.kind === 'connector_status_is') {
    return `connector_status_is: ${check.status}`;
  }
  if (check.kind === 'connector_exit_code_in') {
    return `connector_exit_code_in: [${check.codes.join(', ')}]`;
  }
  if (check.kind === 'connector_http_status_in') {
    return `connector_http_status_in: [${check.statuses.join(', ')}]`;
  }
  const ref = resolveContractPath(nodes, check.path, runId);
  if (check.kind === 'path_exists') {
    return `path_exists: ${ref}`;
  }
  if (check.kind === 'path_not_exists') {
    return `path_not_exists: ${ref}`;
  }
  if (check.kind === 'path_nonempty') {
    return `path_nonempty: ${ref}`;
  }
  if (check.kind === 'file_contains') {
    return `file_contains: ${ref} contains ${JSON.stringify(check.text)}`;
  }
  if (check.kind === 'file_not_contains') {
    return `file_not_contains: ${ref} does not contain ${JSON.stringify(check.text)}`;
  }
  if (check.kind === 'file_last_line_equals') {
    return `file_last_line_equals: ${ref} last non-empty line == ${JSON.stringify(check.text)}`;
  }
  if (check.kind === 'json_array_nonempty') {
    return `json_array_nonempty: ${ref}`;
  }
  if (check.kind === 'json_path_exists') {
    return `json_path_exists: ${ref} has ${check.jsonPath}`;
  }
  if (check.kind === 'json_path_nonempty') {
    return `json_path_nonempty: ${ref} has non-empty ${check.jsonPath}`;
  }
  if (check.kind === 'json_path_array_nonempty') {
    return `json_path_array_nonempty: ${ref} has non-empty array ${check.jsonPath}`;
  }
  return `workflow_transfer_valid: ${ref}`;
}

export function buildContractBlock(
  nodes: GraphNode[],
  contract: ManagedPhasePromptContract,
  runId?: string,
): string | null {
  const out = [...new Set(contract.expectedOutputs.map((entry) => entry.trim()).filter(Boolean))];
  const node = contract.validatorNodeId
    ? nodes.find((entry) => entry.id === contract.validatorNodeId) ?? null
    : null;
  const val = node ? readWorkflowDecisionValidatorContent(node.content) : null;
  if (out.length === 0 && !val) {
    return null;
  }
  const lines = ['[Managed phase contract]', `Phase: ${contract.phaseKind}`];
  lines.push('Write or overwrite the required outputs in this run before finishing.');
  lines.push('The run is not complete until those files exist and every validator check below passes.');
  if (out.length > 0) {
    lines.push('', 'Required outputs:');
    for (const ref of out) {
      const resolved = resolveContractPath(nodes, ref, runId);
      lines.push(resolved === ref ? `- ${resolved}` : `- ${resolved} (template: ${ref})`);
    }
  }
  if (val?.requirements.length) {
    lines.push('', 'Requirements:');
    for (const req of val.requirements) {
      lines.push(`- ${req}`);
    }
  }
  if (val?.evidenceFrom.length) {
    lines.push('', 'Evidence paths:');
    for (const ref of val.evidenceFrom) {
      const resolved = resolveContractPath(nodes, ref, runId);
      lines.push(resolved === ref ? `- ${resolved}` : `- ${resolved} (template: ${ref})`);
    }
  }
  if (val?.checks.length) {
    lines.push('', 'Validator checks:');
    for (const check of val.checks) {
      lines.push(`- ${describeCheck(nodes, check, runId)}`);
    }
  }
  lines.push('', 'Do not stop at analysis or background work. Produce the files first, then report completion.');
  return lines.join('\n');
}

function buildRecallBlock(entries: readonly AgentKernelRecallEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  return [
    '[Durable recall]',
    ...entries.slice(0, 10).map((entry) => {
      const bits = [
        entry.title,
        entry.summary,
        entry.timestamp ? `@ ${entry.timestamp}` : null,
      ].filter(Boolean);
      return `- ${bits.join(' | ')}`;
    }),
  ].join('\n');
}

function buildDelegationBlock(delegation: AgentDelegationContext | undefined): string | null {
  if (!delegation?.parentRunId) {
    return null;
  }
  return [
    '[Delegation]',
    `Parent run: ${delegation.parentRunId}`,
    delegation.depth !== undefined ? `Delegation depth: ${delegation.depth}` : null,
    delegation.allowed === false
      ? 'Nested delegation is disabled for this run. Keep work visible on the graph instead of spawning another hidden specialist.'
      : 'Delegation remains graph-native. If you split work further, preserve the lineage and make artifacts visible.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function buildPrompt(
  nodes: GraphNode[],
  seedNodeIds: string[],
  runId?: string,
  contract?: ManagedPhasePromptContract,
  kernel?: {
    toolset?: AgentToolsetId;
    recall?: AgentKernelRecallEntry[];
    delegation?: AgentDelegationContext;
  },
): string {
  const parts: string[] = [];
  for (const id of seedNodeIds) {
    const n = nodes.find((x) => x.id === id);
    if (!n) continue;
    if (n.type === 'human_message' || n.type === 'note' || n.type === 'agent_message') {
      const t = (n.content as { text?: string }).text;
      if (t) parts.push(t);
      continue;
    }
    if (n.type === 'file_summary') {
      const block = buildFileContextBlock(readFileSummaryContent(n.content) ?? {});
      if (block) parts.push(block);
      continue;
    }
    if (n.type === 'workspace_file') {
      const block = readWorkflowArtifactContent(n.content);
      if (block) parts.push(buildWorkspaceFilePromptBlock(block, runId));
      continue;
    }
    if (n.type === 'input') {
      const block = buildInputPromptBlock(n);
      if (block) parts.push(block);
      continue;
    }
    const block = buildStepPromptBlock(n);
    if (block) {
      parts.push(block);
    }
  }
  const basePrompt =
    parts.join('\n\n') || 'Briefly introduce yourself and list one concrete next step for this workspace.';
  const manifest = `If you create a runnable app, API, worker, CLI, or binary in this workspace, you must emit a runtime manifest.

Requirements:
- Write the manifest to \`cepage-run.json\` at the workspace root.
- Repeat the same JSON in your final response inside a fenced \`\`\`cepage-run block.
- If nothing runnable was produced, do not emit the manifest.

Runtime manifest schema:
\`\`\`json
{
  "schema": "cepage.runtime/v1",
  "schemaVersion": 1,
  "targets": [
    {
      "kind": "web",
      "launchMode": "local_process",
      "serviceName": "web",
      "cwd": "apps/web",
      "command": "pnpm",
      "args": ["run", "dev", "--", "--host", "{{HOST}}", "--port", "{{PORT}}"],
      "env": { "PORT": "{{PORT}}", "HOST": "{{HOST}}" },
      "ports": [{ "name": "http", "port": 0, "protocol": "http" }],
      "entrypoint": "src/main.ts",
      "preview": { "mode": "server", "port": 0 },
      "monorepoRole": "app",
      "docker": { "image": "node:22", "workingDir": "/workspace", "mounts": [], "env": {}, "ports": [] },
      "autoRun": true
    }
  ]
}
\`\`\`

For static web apps, omit the command and set \`"preview": { "mode": "static", "entry": "index.html" }\`.
Use \`{{PORT}}\` and \`{{HOST}}\` placeholders when the runtime should choose the port.`;
  const toolset = kernel?.toolset
    ? ['[Kernel toolset]', `${kernel.toolset}: ${describeAgentToolset(kernel.toolset) ?? ''}`].join('\n')
    : null;
  return [
    basePrompt,
    toolset,
    buildDelegationBlock(kernel?.delegation),
    buildRecallBlock(kernel?.recall ?? []),
    manifest,
    contract ? buildContractBlock(nodes, contract, runId) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

function contractPathScore(content: WorkflowArtifactContent): number {
  let score = 0;
  if (content.role === 'output') score += 4;
  if ((content.transferMode ?? 'reference') === 'claim_check') score += 2;
  if ((content.pathMode ?? 'static') === 'per_run') score += 1;
  return score;
}
