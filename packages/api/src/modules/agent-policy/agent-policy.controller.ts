import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  agentPolicyEntrySchema,
  copilotSettingsSchema,
  ok,
} from '@cepage/shared-core';
import { AgentPolicyService } from './agent-policy.service';

const replacePoliciesBodySchema = z.object({
  policies: z.array(agentPolicyEntrySchema),
});

@Controller()
export class AgentPolicyController {
  constructor(private readonly policy: AgentPolicyService) {}

  @Get('agent-policy')
  async list() {
    return ok(await this.policy.listAll());
  }

  @Put('agent-policy')
  async replace(@Body() body: unknown) {
    const parsed = replacePoliciesBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return ok(await this.policy.replacePolicies(parsed.data.policies));
  }

  @Get('copilot-settings')
  async getSettings() {
    const { defaults } = await this.policy.listAll();
    return ok(defaults);
  }

  @Put('copilot-settings')
  async setSettings(@Body() body: unknown) {
    const parsed = copilotSettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return ok(await this.policy.setDefaults(parsed.data));
  }
}
