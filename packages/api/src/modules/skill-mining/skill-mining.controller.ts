import { Controller, Get, Param, Post } from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { SkillMiningService } from './skill-mining.service';

@Controller('skill-mining')
export class SkillMiningController {
  constructor(private readonly service: SkillMiningService) {}

  @Get('proposals')
  async listProposals() {
    return ok(await this.service.listProposals());
  }

  @Get('proposals/:proposalId')
  async getProposal(@Param('proposalId') proposalId: string) {
    return ok(await this.service.getProposal(proposalId));
  }

  @Post('proposals/:proposalId/accept')
  async acceptProposal(@Param('proposalId') proposalId: string) {
    return ok(await this.service.acceptProposal(proposalId));
  }

  @Post('proposals/:proposalId/reject')
  async rejectProposal(@Param('proposalId') proposalId: string) {
    return ok(await this.service.rejectProposal(proposalId));
  }
}
