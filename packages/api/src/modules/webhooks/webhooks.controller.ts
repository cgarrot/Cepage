import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ok } from '@cepage/shared-core';
import { CreateWebhookDto, UpdateWebhookDto } from './webhooks.dto';
import { WebhooksService } from './webhooks.service';

// REST surface for outbound webhook management. Phase 2 of the typed-
// workflow-library rollout: see docs/product-plan/06-distribution-
// and-integrations.md. The controller is intentionally thin — all the
// validation + delivery logic lives in the service + delivery helper.

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  async list() {
    return ok(await this.webhooks.list());
  }

  @Post()
  async create(@Body() body: CreateWebhookDto) {
    return ok(await this.webhooks.create(body));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.webhooks.get(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateWebhookDto) {
    return ok(await this.webhooks.update(id, body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.webhooks.remove(id));
  }

  @Post(':id/ping')
  async ping(@Param('id') id: string) {
    return ok(await this.webhooks.ping(id));
  }

  @Post(':id/rotate-secret')
  async rotate(@Param('id') id: string) {
    return ok(await this.webhooks.update(id, { secretAction: 'rotate' }));
  }

  @Get(':id/deliveries')
  async listDeliveries(@Param('id') id: string) {
    return ok(await this.webhooks.listDeliveries(id));
  }

  @Get(':id/deliveries/:deliveryId')
  async getDelivery(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return ok(await this.webhooks.getDelivery(id, deliveryId));
  }
}
