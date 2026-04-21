import type {
  AgentModelRef,
  AgentType,
  GraphNode,
  WorkflowArchitectureSpec,
  WorkflowArchitectJoin,
  WorkflowArchitectModule,
  WorkflowCopilotOp,
  WorkflowSkill,
} from '@cepage/shared-core';
import { workflowArchitectureSpecSchema } from '@cepage/shared-core';

type BuildInput = {
  goal: string;
  spec?: WorkflowArchitectureSpec;
  selectedSkill?: WorkflowSkill;
  relatedSkills?: WorkflowSkill[];
  sessionId: string;
  agentType: AgentType;
  model?: AgentModelRef;
};

type BuildResult = {
  spec: WorkflowArchitectureSpec;
  ops: WorkflowCopilotOp[];
  summary: string[];
  warnings: string[];
};

function slug(value: string): string {
  const next = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return next || 'item';
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePath(value: string, fallback: string): string {
  const next = value.trim().replace(/[\\]+/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (next.includes('/')) {
    return next;
  }
  if (/\.[a-z0-9]+$/i.test(next)) {
    return next;
  }
  return `outputs/${slug(next || fallback)}.md`;
}

function note(value: string) {
  return {
    text: value.trim(),
    format: 'markdown' as const,
  };
}

function skillModuleOutput(module: WorkflowSkill['defaultModules'][number], skillId: string): string[] {
  if (module.producedOutputs.length > 0) {
    return module.producedOutputs.map((value) => normalizePath(value, module.id));
  }
  return [`outputs/${slug(skillId)}-${slug(module.id)}.md`];
}

function synthesizeModules(skill: WorkflowSkill): WorkflowArchitectModule[] {
  if (skill.defaultModules.length > 0) {
    return skill.defaultModules.map((module) => ({
      id: slug(module.id),
      title: module.title,
      role: module.role,
      summary: module.summary,
      skillIds: [skill.id],
      requiredInputs: [...module.requiredInputs],
      producedOutputs: skillModuleOutput(module, skill.id),
      execution: module.execution,
    }));
  }
  const output = skill.producedOutputs.length > 0
    ? skill.producedOutputs.map((value) => normalizePath(value, skill.id))
    : [`outputs/${slug(skill.id)}.md`];
  return [
    {
      id: 'analysis',
      title: 'Analyze the goal',
      role: 'analysis',
      summary: `Analyze the request and extract a concrete plan for ${skill.title}.`,
      skillIds: [skill.id],
      requiredInputs: [...skill.requiredInputs],
      producedOutputs: [`outputs/${slug(skill.id)}-analysis.md`],
      execution: 'single',
    },
    {
      id: 'build',
      title: skill.title,
      role: 'generation',
      summary: skill.summary,
      skillIds: [skill.id],
      requiredInputs: [...skill.requiredInputs],
      producedOutputs: output,
      execution: 'single',
    },
  ];
}

function synthesizeSpec(input: {
  goal: string;
  selectedSkill?: WorkflowSkill;
  relatedSkills?: WorkflowSkill[];
}): WorkflowArchitectureSpec | null {
  const skill = input.selectedSkill;
  if (!skill) {
    return null;
  }
  const mods = synthesizeModules(skill);
  for (const related of input.relatedSkills ?? []) {
    for (const module of synthesizeModules(related)) {
      mods.push({
        ...module,
        id: `${slug(related.id)}-${slug(module.id)}`,
        skillIds: uniq([related.id, ...module.skillIds]),
      });
    }
  }
  const modules = normalizeModules(mods);
  const finalOutputs = skill.producedOutputs.length > 0
    ? skill.producedOutputs.map((value) => normalizePath(value, skill.id))
    : modules.at(-1)?.producedOutputs ?? ['outputs/final-result.md'];
  return workflowArchitectureSpecSchema.parse({
    goal: input.goal,
    domain: skill.tags[0] ?? slug(skill.id),
    requestedOutcome: skill.summary,
    needsWebResearch: skill.capabilities.some((value) => /web|research/i.test(value)),
    sources: [
      {
        kind: 'user_goal',
        label: input.goal,
        required: true,
      },
      ...skill.requiredInputs.map((value) => ({
        kind: /web|research/i.test(value) ? 'web_research' : 'analysis_data',
        label: value,
        required: false,
      })),
    ],
    modules,
    joins: buildSequentialJoins(modules),
    finalOutputs,
  });
}

function normalizeModules(modules: readonly WorkflowArchitectModule[]): WorkflowArchitectModule[] {
  const used = new Set<string>();
  return modules.map((module, index) => {
    const base = slug(module.id || module.title || `module-${index + 1}`);
    let id = base;
    let count = 2;
    while (used.has(id)) {
      id = `${base}-${count}`;
      count += 1;
    }
    used.add(id);
    const outputs = module.producedOutputs.length > 0
      ? module.producedOutputs.map((value) => normalizePath(value, id))
      : [`outputs/${id}.md`];
    return workflowArchitectureSpecSchema.shape.modules.element.parse({
      ...module,
      id,
      requiredInputs: uniq(module.requiredInputs),
      producedOutputs: uniq(outputs),
      skillIds: uniq(module.skillIds),
    });
  });
}

function buildSequentialJoins(modules: readonly WorkflowArchitectModule[]): WorkflowArchitectJoin[] {
  if (modules.length < 2) {
    return [];
  }
  return modules.slice(0, -1).map((module, index) => {
    const next = modules[index + 1]!;
    return {
      fromModuleId: module.id,
      toModuleId: next.id,
      fromOutput: module.producedOutputs[0] ?? `outputs/${module.id}.md`,
      toInput: next.requiredInputs[0] ?? `${module.id}_result`,
      strategy: 'artifact',
      required: true,
    };
  });
}

function completeSpec(input: BuildInput): { spec: WorkflowArchitectureSpec | null; warnings: string[] } {
  const raw = input.spec ?? synthesizeSpec(input);
  if (!raw) {
    return {
      spec: null,
      warnings: ['No architecture spec was produced yet. Ask one short clarification or choose a skill first.'],
    };
  }
  const modules = normalizeModules(raw.modules);
  const joins = raw.joins.length > 0 ? raw.joins : buildSequentialJoins(modules);
  const finalOutputs = uniq(
    (raw.finalOutputs.length > 0 ? raw.finalOutputs : modules.at(-1)?.producedOutputs ?? ['outputs/final-result.md'])
      .map((value) => normalizePath(value, 'final-result')),
  );
  const next = workflowArchitectureSpecSchema.parse({
    ...raw,
    modules,
    joins,
    finalOutputs,
  });
  const warnings = validateSpec(next);
  return {
    spec: warnings.length > 0
      ? {
          ...next,
          reviewRequired: true,
          reviewReason: warnings.join(' '),
        }
      : next,
    warnings,
  };
}

export function validateSpec(spec: WorkflowArchitectureSpec): string[] {
  const warnings: string[] = [];
  const ids = new Set(spec.modules.map((module) => module.id));
  if (spec.modules.length === 0) {
    warnings.push('The architecture did not include any module.');
  }
  for (const module of spec.modules) {
    if (module.producedOutputs.length === 0) {
      warnings.push(`Module ${module.title} has no produced output.`);
    }
  }
  for (const join of spec.joins) {
    if (!ids.has(join.fromModuleId) || !ids.has(join.toModuleId)) {
      warnings.push(`Join ${join.fromModuleId} -> ${join.toModuleId} references an unknown module.`);
    }
  }
  if (spec.finalOutputs.length === 0) {
    warnings.push('The architecture did not define any final output.');
  }
  return warnings;
}

function moduleBrief(module: WorkflowArchitectModule): string {
  const lines = [
    `Module: ${module.title}`,
    `Role: ${module.role}`,
    module.summary,
  ];
  if (module.requiredInputs.length > 0) {
    lines.push(`Required inputs: ${module.requiredInputs.join(', ')}`);
  }
  lines.push(`Publish: ${module.producedOutputs.join(', ')}`);
  return lines.join('\n');
}

function validatorContent(paths: readonly string[], label: string) {
  return {
    mode: 'workspace_validator' as const,
    requirements: [`Validate ${label}.`],
    evidenceFrom: [...paths],
    checks: paths.flatMap((path) => [
      { kind: 'path_exists' as const, path },
      { kind: 'path_nonempty' as const, path },
    ]),
    passAction: 'pass' as const,
    failAction: 'retry_same_item' as const,
    blockAction: 'request_human' as const,
  };
}

function outputContent(path: string, title: string, pathMode: 'static' | 'per_run') {
  return {
    title,
    relativePath: path,
    pathMode,
    role: 'output' as const,
    origin: 'agent_output' as const,
    kind: 'text' as const,
    transferMode: 'reference' as const,
    status: 'declared' as const,
  };
}

function phaseId(prefix: string, moduleId: string): string {
  return `${prefix}-${slug(moduleId)}`;
}

function hasTopology(nodes: readonly GraphNode[]): boolean {
  return nodes.some((node) =>
    node.type === 'agent_step'
    || node.type === 'loop'
    || node.type === 'managed_flow'
    || node.type === 'sub_graph');
}

export function buildWorkflowArchitectureOps(input: BuildInput): BuildResult {
  const { spec, warnings } = completeSpec(input);
  if (!spec) {
    return {
      spec: workflowArchitectureSpecSchema.parse({
        goal: input.goal,
        domain: 'general',
        modules: [
          {
            id: 'review',
            title: 'Review required',
            role: 'planning',
            summary: 'The goal needs one more clarification before a safe workflow can be built.',
            skillIds: [],
            requiredInputs: [],
            producedOutputs: ['outputs/review-required.md'],
            execution: 'single',
          },
        ],
        finalOutputs: ['outputs/review-required.md'],
        reviewRequired: true,
        reviewReason: warnings.join(' '),
      }),
      ops: [],
      summary: ['Held the workflow in review because the architecture is not reliable yet.'],
      warnings,
    };
  }
  if (spec.reviewRequired) {
    return {
      spec,
      ops: [],
      summary: ['Drafted the architecture but stopped before wiring the workflow.'],
      warnings,
    };
  }
  const ops: WorkflowCopilotOp[] = [];
  const phases: Array<Record<string, unknown>> = [];
  const rootRef = 'architect-overview';
  const splitRef = 'architect-modules';
  const joinRef = 'architect-join';
  const joinStepRef = 'architect-join-step';
  const joinValidatorRef = 'architect-join-validator';
  const joinOutputRefs: string[] = [];
  const moduleOutputRefs = new Map<string, string[]>();
  const moduleNoteRefs = new Map<string, string>();
  const moduleStepRefs = new Map<string, string>();

  ops.push({
    kind: 'add_node',
    ref: rootRef,
    type: 'note',
    position: { x: 120, y: 40 },
    content: note([
      `# Chat Architect`,
      `Goal: ${spec.goal}`,
      spec.requestedOutcome ? `Outcome: ${spec.requestedOutcome}` : null,
      `Domain: ${spec.domain}`,
    ].filter(Boolean).join('\n')),
  });
  ops.push({
    kind: 'add_node',
    ref: splitRef,
    type: 'note',
    position: { x: 120, y: 190 },
    content: note([
      `# Split plan`,
      ...spec.modules.map((module, index) => `${index + 1}. ${module.title} -> ${module.producedOutputs.join(', ')}`),
    ].join('\n')),
  });
  ops.push({
    kind: 'add_edge',
    source: rootRef,
    target: splitRef,
    relation: 'contains',
  });

  spec.sources.forEach((source, index) => {
    const ref = `architect-source-${index + 1}`;
    ops.push({
      kind: 'add_node',
      ref,
      type: 'note',
      position: { x: -120, y: 190 + (index * 120) },
      content: note([
        `Source: ${source.label}`,
        `Kind: ${source.kind}`,
        source.details ?? null,
      ].filter(Boolean).join('\n')),
    });
    ops.push({
      kind: 'add_edge',
      source: rootRef,
      target: ref,
      relation: 'references',
    });
  });

  spec.modules.forEach((module, index) => {
    const y = 380 + (index * 220);
    const noteRef = `module-note-${module.id}`;
    const stepRef = `module-step-${module.id}`;
    const subgraphRef = `module-subgraph-${module.id}`;
    const validatorRef = `module-validator-${module.id}`;
    moduleNoteRefs.set(module.id, noteRef);
    moduleStepRefs.set(module.id, stepRef);
    ops.push({
      kind: 'add_node',
      ref: noteRef,
      type: 'note',
      position: { x: 20, y },
      content: note([
        `## ${module.title}`,
        module.summary,
        `Role: ${module.role}`,
      ].join('\n')),
    });
    ops.push({
      kind: 'add_edge',
      source: splitRef,
      target: noteRef,
      relation: 'contains',
    });
    ops.push({
      kind: 'add_node',
      ref: stepRef,
      type: 'agent_step',
      position: { x: 360, y },
      content: {
        agentType: input.agentType,
        ...(input.model ? { model: input.model } : {}),
      },
      metadata: {
        brief: moduleBrief(module),
        role: module.role,
      },
    });
    ops.push({
      kind: 'add_edge',
      source: noteRef,
      target: stepRef,
      relation: 'contains',
    });
    ops.push({
      kind: 'add_node',
      ref: subgraphRef,
      type: 'sub_graph',
      position: { x: 660, y },
      content: {
        workflowRef: { kind: 'session', sessionId: input.sessionId },
        inputMap: {},
        execution: {
          type: input.agentType,
          ...(input.model ? { model: input.model } : {}),
        },
        expectedOutputs: module.producedOutputs,
        entryNodeId: stepRef,
      },
      metadata: {
        role: module.role,
      },
    });
    ops.push({
      kind: 'add_edge',
      source: noteRef,
      target: subgraphRef,
      relation: 'contains',
    });
    ops.push({
      kind: 'add_node',
      ref: validatorRef,
      type: 'decision',
      position: { x: 960, y },
      content: validatorContent(module.producedOutputs, module.title),
    });
    ops.push({
      kind: 'add_edge',
      source: stepRef,
      target: validatorRef,
      relation: 'validates',
    });
    const refs: string[] = [];
    module.producedOutputs.forEach((path, outIndex) => {
      const ref = `module-output-${module.id}-${outIndex + 1}`;
      refs.push(ref);
      ops.push({
        kind: 'add_node',
        ref,
        type: 'workspace_file',
        position: { x: 1260, y: y + (outIndex * 96) },
        content: outputContent(path, `${module.title} output ${outIndex + 1}`, 'per_run'),
      });
      ops.push({
        kind: 'add_edge',
        source: stepRef,
        target: ref,
        relation: 'produces',
      });
      ops.push({
        kind: 'add_edge',
        source: subgraphRef,
        target: ref,
        relation: 'produces',
      });
    });
    moduleOutputRefs.set(module.id, refs);
    phases.push({
      id: phaseId('module', module.id),
      kind: 'agent_phase',
      title: module.title,
      nodeId: stepRef,
      validatorNodeId: validatorRef,
      expectedOutputs: module.producedOutputs,
      selection: {
        type: input.agentType,
        ...(input.model ? { model: input.model } : {}),
      },
      newExecution: true,
    });
  });

  ops.push({
    kind: 'add_node',
    ref: joinRef,
    type: 'note',
    position: { x: 1640, y: 240 },
    content: note([
      `# Join contracts`,
      ...spec.joins.map((join) => `${join.fromModuleId}.${join.fromOutput} -> ${join.toModuleId}.${join.toInput}`),
    ].join('\n')),
  });

  ops.push({
    kind: 'add_node',
    ref: joinStepRef,
    type: 'agent_step',
    position: { x: 1640, y: 420 },
    content: {
      agentType: input.agentType,
      ...(input.model ? { model: input.model } : {}),
    },
    metadata: {
      brief: [
        'Assemble the module outputs into the final deliverables.',
        `Goal: ${spec.goal}`,
        `Publish: ${spec.finalOutputs.join(', ')}`,
      ].join('\n'),
      role: 'integration',
    },
  });
  ops.push({
    kind: 'add_edge',
    source: joinRef,
    target: joinStepRef,
    relation: 'contains',
  });
  for (const join of spec.joins) {
    const refs = moduleOutputRefs.get(join.fromModuleId) ?? [];
    for (const ref of refs) {
      ops.push({
        kind: 'add_edge',
        source: ref,
        target: joinStepRef,
        relation: 'feeds_into',
      });
    }
    const fromNote = moduleNoteRefs.get(join.fromModuleId);
    if (fromNote) {
      ops.push({
        kind: 'add_edge',
        source: fromNote,
        target: joinRef,
        relation: 'references',
      });
    }
  }

  ops.push({
    kind: 'add_node',
    ref: joinValidatorRef,
    type: 'decision',
    position: { x: 1920, y: 420 },
    content: validatorContent(spec.finalOutputs, 'final workflow outputs'),
  });
  ops.push({
    kind: 'add_edge',
    source: joinStepRef,
    target: joinValidatorRef,
    relation: 'validates',
  });
  spec.finalOutputs.forEach((path, index) => {
    const ref = `final-output-${index + 1}`;
    joinOutputRefs.push(ref);
    ops.push({
      kind: 'add_node',
      ref,
      type: 'workspace_file',
      position: { x: 2200, y: 360 + (index * 96) },
      content: outputContent(path, `Final output ${index + 1}`, 'static'),
    });
    ops.push({
      kind: 'add_edge',
      source: joinStepRef,
      target: ref,
      relation: 'produces',
    });
  });

  phases.push({
    id: 'final-verify',
    kind: 'runtime_verify_phase',
    title: 'Join and verify final outputs',
    nodeId: joinStepRef,
    validatorNodeId: joinValidatorRef,
    expectedOutputs: spec.finalOutputs,
    selection: {
      type: input.agentType,
      ...(input.model ? { model: input.model } : {}),
    },
    newExecution: true,
  });

  ops.push({
    kind: 'add_node',
    ref: 'architect-flow',
    type: 'managed_flow',
    position: { x: 120, y: 320 + (spec.modules.length * 220) },
    content: {
      title: input.selectedSkill?.title ?? 'Architected workflow',
      syncMode: 'managed',
      entryPhaseId: phases[0]?.id,
      phases,
    },
  });
  ops.push({
    kind: 'add_edge',
    source: rootRef,
    target: 'architect-flow',
    relation: 'contains',
  });

  return {
    spec,
    ops,
    summary: [
      `Built ${spec.modules.length} workflow modules.`,
      `Wired ${spec.joins.length} join contracts.`,
      `Declared ${spec.finalOutputs.length} final outputs.`,
    ],
    warnings,
  };
}

export function canAutoBuildArchitecture(nodes: readonly GraphNode[]): boolean {
  return !hasTopology(nodes);
}
