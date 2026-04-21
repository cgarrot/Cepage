import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowManagedFlowNotifierService } from '../workflow-managed-flow-notifier.service.js';

test('notifier catches async flow and controller errors', async () => {
  const errors: string[] = [];
  const moduleRef = {
    get: (token: { name?: string }) => {
      if (token.name === 'WorkflowManagedFlowService') {
        return {
          notifyAgentStatus: async () => {
            throw new Error('flow boom');
          },
          notifyControllerState: async () => {
            throw new Error('controller boom');
          },
        };
      }
      if (token.name === 'WorkflowControllerService') {
        return {
          notifyAgentStatus: async () => {
            throw new Error('controller agent boom');
          },
        };
      }
      return null;
    },
  };
  const svc = new WorkflowManagedFlowNotifierService(moduleRef as never);
  (svc as unknown as { log: { error: (message: string) => void } }).log = {
    error: (message: string) => {
      errors.push(message);
    },
  };

  svc.notifyAgentStatus('session-1', { id: 'run-1' } as never);
  svc.notifyControllerState({ id: 'controller-1' } as never);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(errors.length, 3);
  assert.ok(errors.some((message) => message.includes('flow agent notification failed')));
  assert.ok(errors.some((message) => message.includes('controller agent notification failed')));
  assert.ok(errors.some((message) => message.includes('flow controller notification failed')));
});
