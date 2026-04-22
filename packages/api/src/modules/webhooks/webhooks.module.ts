import { Module } from '@nestjs/common';
import { SkillRunsModule } from '../skill-runs/skill-runs.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksDeliveryService } from './webhooks.delivery';
import { WebhooksDispatcher } from './webhooks.dispatcher';
import { WebhooksService } from './webhooks.service';

// Outbound HMAC-signed webhooks for the typed-skill library.
//
// Keep the wiring explicit: the dispatcher only needs SkillRunsService
// (to subscribe to its `events` emitter) and the delivery service.
// Importing SkillRunsModule ensures the emitter singleton is shared
// with whichever controller created the run — since Nest caches
// providers per module graph, we get the same instance that the runs
// controller uses.

@Module({
  imports: [SkillRunsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksDeliveryService, WebhooksDispatcher],
  exports: [WebhooksService, WebhooksDeliveryService],
})
export class WebhooksModule {}
