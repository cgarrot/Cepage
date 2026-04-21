import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { WsServerEvent } from '@cepage/shared-core';
import { CollaborationRelayService } from './collaboration-relay.service';

@Injectable()
export class CollaborationBusService implements OnModuleDestroy {
  private readonly log = new Logger(CollaborationBusService.name);
  private server: Server | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly relay: CollaborationRelayService) {
    this.unsubscribe = this.relay.subscribe((msg) => {
      if (msg.instanceId === this.relay.id()) {
        return;
      }
      this.server?.to(`session:${msg.event.sessionId}`).emit('event', msg.event);
    });
  }

  attachServer(server: Server): void {
    this.server = server;
  }

  onModuleDestroy(): void {
    this.unsubscribe();
  }

  emitSession(sessionId: string, ev: WsServerEvent): void {
    this.server?.to(`session:${sessionId}`).emit('event', ev);
    void this.relay.publish(ev).catch((err) => {
      this.log.warn(`relay publish failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
