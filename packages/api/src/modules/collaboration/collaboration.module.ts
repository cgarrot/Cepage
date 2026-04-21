import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationBusService } from './collaboration-bus.service';
import { CollaborationRelayService } from './collaboration-relay.service';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [CollaborationGateway, CollaborationRelayService, CollaborationBusService],
  exports: [CollaborationBusService, CollaborationRelayService],
})
export class CollaborationModule {}
