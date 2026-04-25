import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { SkillMiningController } from '../skill-mining.controller.js';
import type { Proposal } from '../skill-mining.service.js';
import type { CompilationResult } from '../../skill-compiler/compiler/compiler.service.js';

function createController(overrides?: {
  service?: Partial<Pick<
    import('../skill-mining.service.js').SkillMiningService,
    'listProposals' | 'getProposal' | 'acceptProposal' | 'rejectProposal'
  >>;
}) {
  const service = overrides?.service ?? {
    async listProposals(): Promise<Proposal[]> {
      return [
        {
          id: 'proposal-1',
          sessionId: 'sess-1',
          detectedParams: [],
          estimatedCost: 1.5,
          graphStats: { nodes: 5, edges: 4 },
          detectedPattern: 'design_build',
          confidence: 0.75,
          status: 'pending',
          createdAt: '2026-04-23T10:00:00.000Z',
        },
      ];
    },
    async getProposal(id: string): Promise<Proposal> {
      return {
        id,
        sessionId: 'sess-1',
        detectedParams: [],
        estimatedCost: 1.5,
        graphStats: { nodes: 5, edges: 4 },
        detectedPattern: 'design_build',
        confidence: 0.75,
        status: 'pending',
        createdAt: '2026-04-23T10:00:00.000Z',
      };
    },
    async acceptProposal(id: string): Promise<{ proposal: Proposal; compilation: CompilationResult }> {
      return {
        proposal: {
          id,
          sessionId: 'sess-1',
          detectedParams: [],
          estimatedCost: 1.5,
          graphStats: { nodes: 5, edges: 4 },
          detectedPattern: 'design_build',
          confidence: 0.75,
          status: 'accepted',
          createdAt: '2026-04-23T10:00:00.000Z',
        },
        compilation: {
          skill: { slug: 'compiled-skill' },
          report: {
            parameters: [],
            estimatedCost: 1.5,
            graphStats: { nodes: 5, edges: 4 },
            warnings: [],
          },
        },
      };
    },
    async rejectProposal(id: string): Promise<Proposal> {
      return {
        id,
        sessionId: 'sess-1',
        detectedParams: [],
        estimatedCost: 1.5,
        graphStats: { nodes: 5, edges: 4 },
        detectedPattern: 'design_build',
        confidence: 0.75,
        status: 'rejected',
        createdAt: '2026-04-23T10:00:00.000Z',
      };
    },
  };

  return new SkillMiningController(service as never);
}

test('listProposals returns proposals wrapped in ok', async () => {
  const controller = createController();
  const result = await controller.listProposals();
  assert.equal(result.success, true);
  assert.equal(Array.isArray(result.data), true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.id, 'proposal-1');
});

test('getProposal returns a proposal wrapped in ok', async () => {
  const controller = createController();
  const result = await controller.getProposal('proposal-1');
  assert.equal(result.success, true);
  assert.equal(result.data.id, 'proposal-1');
});

test('acceptProposal returns accepted result wrapped in ok', async () => {
  const controller = createController();
  const result = await controller.acceptProposal('proposal-1');
  assert.equal(result.success, true);
  assert.equal(result.data.proposal.status, 'accepted');
  assert.equal(result.data.compilation.skill.slug, 'compiled-skill');
});

test('rejectProposal returns rejected proposal wrapped in ok', async () => {
  const controller = createController();
  const result = await controller.rejectProposal('proposal-1');
  assert.equal(result.success, true);
  assert.equal(result.data.status, 'rejected');
});

test('getProposal propagates NotFoundException', async () => {
  const controller = createController({
    service: {
      async getProposal(): Promise<never> {
        throw new NotFoundException('PROPOSAL_NOT_FOUND');
      },
    },
  });

  await assert.rejects(() => controller.getProposal('missing'), NotFoundException);
});

test('acceptProposal propagates NotFoundException', async () => {
  const controller = createController({
    service: {
      async acceptProposal(): Promise<never> {
        throw new NotFoundException('PROPOSAL_NOT_FOUND');
      },
    },
  });

  await assert.rejects(() => controller.acceptProposal('missing'), NotFoundException);
});

test('rejectProposal propagates NotFoundException', async () => {
  const controller = createController({
    service: {
      async rejectProposal(): Promise<never> {
        throw new NotFoundException('PROPOSAL_NOT_FOUND');
      },
    },
  });

  await assert.rejects(() => controller.rejectProposal('missing'), NotFoundException);
});
