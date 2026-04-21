import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode, WorkflowArchitectureSpec, WorkflowSkill } from '@cepage/shared-core';
import {
  buildWorkflowArchitectureOps,
  canAutoBuildArchitecture,
  validateSpec,
} from '../workflow-copilot-architect.js';
import { WorkflowSkillsService } from '../../workflow-skills/workflow-skills.service.js';

const svc = new WorkflowSkillsService();

async function skill(id: string): Promise<WorkflowSkill> {
  return svc.getSkill(id);
}

function addNodes(ops: ReturnType<typeof buildWorkflowArchitectureOps>['ops'], type: string) {
  return ops.filter((op) => op.kind === 'add_node' && op.type === type);
}

function addEdges(ops: ReturnType<typeof buildWorkflowArchitectureOps>['ops'], relation: string) {
  return ops.filter((op) => op.kind === 'add_edge' && op.relation === relation);
}

const intentCases = [
  {
    name: 'docs pack route',
    input: 'Create a Three.js vanilla framework context pack with clean published docs.',
    expect: 'documentation-pack-clean-return',
  },
  {
    name: 'app builder route',
    input: 'Build a web app MVP from this product brief.',
    expect: 'app-builder-clean-return',
  },
  {
    name: 'game dev route',
    input: 'I want a dev cycle for a vampire survivor style game from my gameplay analysis.',
    expect: 'game-dev-managed-flow-clean-return',
  },
  {
    name: 'analysis pipeline route',
    input: 'I have analysis data and want a modular workflow that deepens it with web research and creates more outputs.',
    expect: 'analysis-pipeline-modular-architect',
  },
  {
    name: 'music route',
    input: 'I have analyses of my songs and want a workflow that can create lyrics and music production artifacts.',
    expect: 'music-creation-modular-architect',
  },
] as const;

for (const entry of intentCases) {
  test(`intent scenario: ${entry.name}`, async () => {
    const next = await svc.routeSkill(entry.input);
    assert.equal(next?.id, entry.expect);
  });
}

const clarificationCases = [
  'Help me build something useful.',
  'I want a better process.',
  'Can you organize my work?',
  'Make me a smart workflow.',
  'I have some stuff and need help.',
] as const;

for (const input of clarificationCases) {
  test(`clarification scenario: ${input}`, async () => {
    const next = await svc.routeSkill(input);
    assert.equal(next, null);
  });
}

const compositionCases = [
  {
    name: 'analysis plus game dev',
    selected: 'analysis-pipeline-modular-architect',
    related: ['game-dev-managed-flow-clean-return'],
    minModules: 6,
  },
  {
    name: 'analysis plus music',
    selected: 'analysis-pipeline-modular-architect',
    related: ['music-creation-modular-architect'],
    minModules: 6,
  },
  {
    name: 'docs only',
    selected: 'documentation-pack-clean-return',
    related: [],
    minModules: 2,
  },
  {
    name: 'game dev only',
    selected: 'game-dev-managed-flow-clean-return',
    related: [],
    minModules: 4,
  },
  {
    name: 'music only',
    selected: 'music-creation-modular-architect',
    related: [],
    minModules: 4,
  },
] as const;

for (const entry of compositionCases) {
  test(`composition scenario: ${entry.name}`, async () => {
    const selected = await skill(entry.selected);
    const related = await Promise.all(entry.related.map((id) => skill(id)));
    const built = buildWorkflowArchitectureOps({
      goal: entry.name,
      selectedSkill: selected,
      relatedSkills: related,
      sessionId: 'session-1',
      agentType: 'opencode',
    });
    assert.ok(built.spec.modules.length >= entry.minModules);
  });
}

const specCases: Array<{ name: string; spec: WorkflowArchitectureSpec; warnings: number }> = [
  {
    name: 'valid minimal spec',
    spec: {
      goal: 'valid',
      domain: 'general',
      modules: [
        {
          id: 'analysis',
          title: 'Analysis',
          role: 'analysis',
          summary: 'Analyze',
          skillIds: [],
          requiredInputs: [],
          producedOutputs: ['outputs/analysis.md'],
          execution: 'single',
        },
      ],
      joins: [],
      finalOutputs: ['outputs/analysis.md'],
      needsWebResearch: false,
      sources: [],
      reviewRequired: false,
    },
    warnings: 0,
  },
  {
    name: 'missing module outputs',
    spec: {
      goal: 'missing outputs',
      domain: 'general',
      modules: [
        {
          id: 'analysis',
          title: 'Analysis',
          role: 'analysis',
          summary: 'Analyze',
          skillIds: [],
          requiredInputs: [],
          producedOutputs: [],
          execution: 'single',
        },
      ],
      joins: [],
      finalOutputs: ['outputs/final.md'],
      needsWebResearch: false,
      sources: [],
      reviewRequired: false,
    },
    warnings: 1,
  },
  {
    name: 'bad join',
    spec: {
      goal: 'bad join',
      domain: 'general',
      modules: [
        {
          id: 'analysis',
          title: 'Analysis',
          role: 'analysis',
          summary: 'Analyze',
          skillIds: [],
          requiredInputs: [],
          producedOutputs: ['outputs/analysis.md'],
          execution: 'single',
        },
      ],
      joins: [
        {
          fromModuleId: 'analysis',
          toModuleId: 'missing',
          fromOutput: 'outputs/analysis.md',
          toInput: 'report',
          strategy: 'artifact',
          required: true,
        },
      ],
      finalOutputs: ['outputs/final.md'],
      needsWebResearch: false,
      sources: [],
      reviewRequired: false,
    },
    warnings: 1,
  },
  {
    name: 'missing final outputs',
    spec: {
      goal: 'missing final outputs',
      domain: 'general',
      modules: [
        {
          id: 'analysis',
          title: 'Analysis',
          role: 'analysis',
          summary: 'Analyze',
          skillIds: [],
          requiredInputs: [],
          producedOutputs: ['outputs/analysis.md'],
          execution: 'single',
        },
      ],
      joins: [],
      finalOutputs: [],
      needsWebResearch: false,
      sources: [],
      reviewRequired: false,
    },
    warnings: 1,
  },
  {
    name: 'multiple warnings',
    spec: {
      goal: 'multiple warnings',
      domain: 'general',
      modules: [
        {
          id: 'analysis',
          title: 'Analysis',
          role: 'analysis',
          summary: 'Analyze',
          skillIds: [],
          requiredInputs: [],
          producedOutputs: [],
          execution: 'single',
        },
      ],
      joins: [
        {
          fromModuleId: 'analysis',
          toModuleId: 'missing',
          fromOutput: 'outputs/analysis.md',
          toInput: 'report',
          strategy: 'artifact',
          required: true,
        },
      ],
      finalOutputs: [],
      needsWebResearch: false,
      sources: [],
      reviewRequired: false,
    },
    warnings: 3,
  },
];

for (const entry of specCases) {
  test(`spec scenario: ${entry.name}`, () => {
    assert.equal(validateSpec(entry.spec).length, entry.warnings);
  });
}

const splitCases = [2, 3, 4, 5, 6] as const;

for (const count of splitCases) {
  test(`split/join scenario: ${count} modules`, () => {
    const modules: WorkflowArchitectureSpec['modules'] = Array.from({ length: count }, (_, index) => {
      const role: WorkflowArchitectureSpec['modules'][number]['role'] =
        index === count - 1 ? 'generation' : 'analysis';
      return {
        id: `module-${index + 1}`,
        title: `Module ${index + 1}`,
        role,
        summary: `Module ${index + 1}`,
        skillIds: [],
        requiredInputs: index === 0 ? [] : [`module_${index}`],
        producedOutputs: [`outputs/module-${index + 1}.md`],
        execution: 'single',
      };
    });
    const built = buildWorkflowArchitectureOps({
      goal: 'custom split',
      spec: {
        goal: 'custom split',
        domain: 'general',
        modules,
        joins: modules.slice(0, -1).map((module, index) => ({
          fromModuleId: module.id,
          toModuleId: modules[index + 1]!.id,
          fromOutput: module.producedOutputs[0]!,
          toInput: `input-${index + 1}`,
          strategy: 'artifact',
          required: true,
        })),
        finalOutputs: ['outputs/final.md'],
        needsWebResearch: false,
        sources: [],
        reviewRequired: false,
      },
      sessionId: 'session-1',
      agentType: 'opencode',
    });
    assert.equal(addNodes(built.ops, 'sub_graph').length, count);
    assert.equal(addEdges(built.ops, 'feeds_into').length, count - 1);
  });
}

const graphCases = [
  'documentation-pack-clean-return',
  'three-js-vanilla-clean-return',
  'app-builder-clean-return',
  'game-dev-managed-flow-clean-return',
  'analysis-pipeline-modular-architect',
] as const;

for (const id of graphCases) {
  test(`graph scenario: ${id}`, async () => {
    const built = buildWorkflowArchitectureOps({
      goal: id,
      selectedSkill: await skill(id),
      sessionId: 'session-1',
      agentType: 'opencode',
    });
    assert.equal(addNodes(built.ops, 'managed_flow').length, 1);
    assert.ok(addNodes(built.ops, 'decision').length >= 2);
    assert.ok(addNodes(built.ops, 'workspace_file').length >= 2);
  });
}

const regressionCases = [
  {
    name: 'review without skill',
    run: () => buildWorkflowArchitectureOps({
      goal: 'unknown',
      sessionId: 'session-1',
      agentType: 'opencode',
    }),
    assert: (built: ReturnType<typeof buildWorkflowArchitectureOps>) => {
      assert.equal(built.ops.length, 0);
      assert.equal(built.spec.reviewRequired, true);
    },
  },
  {
    name: 'review flag stops graph build',
    run: () => buildWorkflowArchitectureOps({
      goal: 'blocked',
      spec: {
        goal: 'blocked',
        domain: 'general',
        modules: [
          {
            id: 'analysis',
            title: 'Analysis',
            role: 'analysis',
            summary: 'Analyze',
            skillIds: [],
            requiredInputs: [],
            producedOutputs: ['outputs/analysis.md'],
            execution: 'single',
          },
        ],
        joins: [],
        finalOutputs: ['outputs/final.md'],
        needsWebResearch: false,
        sources: [],
        reviewRequired: true,
        reviewReason: 'Need review',
      },
      sessionId: 'session-1',
      agentType: 'opencode',
    }),
    assert: (built: ReturnType<typeof buildWorkflowArchitectureOps>) => {
      assert.equal(built.ops.length, 0);
      assert.ok(built.summary[0]?.includes('stopped'));
    },
  },
  {
    name: 'duplicate module ids are normalized',
    run: () => buildWorkflowArchitectureOps({
      goal: 'dupes',
      spec: {
        goal: 'dupes',
        domain: 'general',
        modules: [
          {
            id: 'analysis',
            title: 'A',
            role: 'analysis',
            summary: 'A',
            skillIds: [],
            requiredInputs: [],
            producedOutputs: ['outputs/a.md'],
            execution: 'single',
          },
          {
            id: 'analysis',
            title: 'B',
            role: 'research',
            summary: 'B',
            skillIds: [],
            requiredInputs: ['outputs/a.md'],
            producedOutputs: ['outputs/b.md'],
            execution: 'single',
          },
        ],
        joins: [],
        finalOutputs: ['outputs/final.md'],
        needsWebResearch: false,
        sources: [],
        reviewRequired: false,
      },
      sessionId: 'session-1',
      agentType: 'opencode',
    }),
    assert: (built: ReturnType<typeof buildWorkflowArchitectureOps>) => {
      assert.equal(new Set(built.spec.modules.map((module) => module.id)).size, built.spec.modules.length);
    },
  },
  {
    name: 'final outputs are backfilled',
    run: () => buildWorkflowArchitectureOps({
      goal: 'backfill final outputs',
      spec: {
        goal: 'backfill final outputs',
        domain: 'general',
        modules: [
          {
            id: 'analysis',
            title: 'Analysis',
            role: 'analysis',
            summary: 'Analyze',
            skillIds: [],
            requiredInputs: [],
            producedOutputs: ['outputs/analysis.md'],
            execution: 'single',
          },
        ],
        joins: [],
        finalOutputs: [],
        needsWebResearch: false,
        sources: [],
        reviewRequired: false,
      },
      sessionId: 'session-1',
      agentType: 'opencode',
    }),
    assert: (built: ReturnType<typeof buildWorkflowArchitectureOps>) => {
      assert.deepEqual(built.spec.finalOutputs, ['outputs/analysis.md']);
    },
  },
] as const;

for (const entry of regressionCases) {
  test(`regression scenario: ${entry.name}`, async () => {
    entry.assert(await entry.run());
  });
}

test('regression scenario: auto build guard', () => {
  assert.equal(canAutoBuildArchitecture([{ id: 'n1', type: 'note' } as GraphNode]), true);
  assert.equal(canAutoBuildArchitecture([{ id: 'm1', type: 'managed_flow' } as GraphNode]), false);
});
