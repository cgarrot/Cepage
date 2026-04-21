import { io, type Socket } from 'socket.io-client';
import { getWsUrl } from './config';

export function connectSessionSocket(sessionId: string, lastEventId?: number): Socket {
  const socket = io(getWsUrl(), {
    path: '/ws/socket.io',
    // Firefox is noisy when a websocket-only connection is interrupted during page load or reload.
    // Starting with polling keeps the session live while still upgrading to websocket when possible.
    transports: ['polling', 'websocket'],
    closeOnBeforeunload: true,
    query: { sessionId },
  });
  socket.on('connect', () => {
    socket.emit('join', { sessionId, lastEventId });
  });
  return socket;
}
