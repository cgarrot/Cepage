import { Controller, Get, Header } from '@nestjs/common';
import { OpenapiService } from './openapi.service';

// GET /api/v1/openapi.json returns the dynamic OpenAPI 3.1 document for
// the Cepage HTTP API. Typed per-skill paths are regenerated from the
// live skill catalog on every request (cheap — the catalog is cached by
// WorkflowSkillsService).

@Controller()
export class OpenapiController {
  constructor(private readonly openapi: OpenapiService) {}

  @Get('openapi.json')
  @Header('cache-control', 'no-store')
  async getOpenapi(): Promise<Record<string, unknown>> {
    return this.openapi.buildDocument();
  }
}
