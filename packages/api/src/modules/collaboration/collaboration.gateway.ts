import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { CollaborationBusService } from './collaboration-bus.service';
import { PrismaService } from '../../common/database/prisma.service';
import { graphEnvelopeToWs, graphEventRowToEnvelope } from './collaboration-event.util';

@WebSocketGateway({
  path: '/ws/socket.io',
  cors: { origin: true, credentials: true },
})
export class CollaborationGateway implements OnGatewayInit {
  private readonly logger = new Logger(CollaborationGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly bus: CollaborationBusService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(): void {
    this.bus.attachServer(this.server);
    this.logger.log('WebSocket gateway ready');
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId: string; lastEventId?: number },
  ): Promise<{ ok: boolean; replayed?: number }> {
    const { sessionId, lastEventId } = body;
    if (!sessionId) return { ok: false };
    await client.join(`session:${sessionId}`);
    let replayed = 0;
    if (lastEventId != null) {
      const rows = await this.prisma.graphEvent.findMany({
        where: { sessionId, eventId: { gt: lastEventId } },
        orderBy: { eventId: 'asc' },
        take: 2000,
      });
      for (const row of rows) {
        client.emit('event', graphEnvelopeToWs(graphEventRowToEnvelope(row)));
        replayed++;
      }
      if (replayed >= 2000) {
        client.emit('event', {
          type: 'system.resync_required',
          eventId: lastEventId,
          sessionId,
          payload: { reason: 'replay_window_exceeded' },
        });
      }
    }
    return { ok: true, replayed };
  }
}
