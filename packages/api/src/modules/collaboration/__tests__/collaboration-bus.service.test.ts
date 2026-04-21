import assert from 'node:assert/strict';
import test from 'node:test';
import type { WsServerEvent } from '@cepage/shared-core';
import { CollaborationBusService } from '../collaboration-bus.service.js';

type RelayMsg = {
  instanceId: string;
  event: WsServerEvent;
};

function relay() {
  const published: WsServerEvent[] = [];
  let listener: ((msg: RelayMsg) => void) | null = null;
  return {
    published,
    subscribe(fn: (msg: RelayMsg) => void) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    async publish(ev: WsServerEvent) {
      published.push(ev);
    },
    id() {
      return 'api-1';
    },
    emit(msg: RelayMsg) {
      listener?.(msg);
    },
  };
}

function server() {
  const emitted: Array<{ room: string; name: string; event: WsServerEvent }> = [];
  return {
    emitted,
    to(room: string) {
      return {
        emit(name: string, event: WsServerEvent) {
          emitted.push({ room, name, event });
        },
      };
    },
  };
}

function resync(reason: string): WsServerEvent {
  return {
    type: 'system.resync_required',
    eventId: 0,
    sessionId: 'session-1',
    payload: { reason },
  };
}

test('emitSession broadcasts locally and publishes through relay', async () => {
  const busRelay = relay();
  const io = server();
  const bus = new CollaborationBusService(busRelay as never);
  const event = resync('local');

  bus.attachServer(io as never);
  bus.emitSession('session-1', event);

  assert.deepEqual(io.emitted, [{ room: 'session:session-1', name: 'event', event }]);
  assert.deepEqual(busRelay.published, [event]);
  bus.onModuleDestroy();
});

test('relay events from other instances reach the local socket once', () => {
  const busRelay = relay();
  const io = server();
  const bus = new CollaborationBusService(busRelay as never);
  const remote = resync('remote');

  bus.attachServer(io as never);
  busRelay.emit({ instanceId: 'worker-1', event: remote });
  busRelay.emit({ instanceId: 'api-1', event: resync('self') });

  assert.deepEqual(io.emitted, [{ room: 'session:session-1', name: 'event', event: remote }]);
  bus.onModuleDestroy();
});
