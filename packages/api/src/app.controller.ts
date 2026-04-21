import { Controller, Get } from '@nestjs/common';
import { ok } from '@cepage/shared-core';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return ok({ status: 'ok' });
  }
}
