import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AgentRun, WorkflowControllerState } from '@cepage/shared-core';
import type { WorkflowControllerService } from './workflow-controller.service.js';
import type { WorkflowManagedFlowService } from './workflow-managed-flow.service.js';

function workflowManagedFlowServiceClass(): new (...args: never[]) => WorkflowManagedFlowService {
  // Resolve lazily to avoid a CommonJS import cycle during Nest bootstrap.
  return require('./workflow-managed-flow.service')
    .WorkflowManagedFlowService as new (...args: never[]) => WorkflowManagedFlowService;
}

function workflowControllerServiceClass(): new (...args: never[]) => WorkflowControllerService {
  return require('./workflow-controller.service')
    .WorkflowControllerService as new (...args: never[]) => WorkflowControllerService;
}

@Injectable()
export class WorkflowManagedFlowNotifierService {
  private readonly log = new Logger(WorkflowManagedFlowNotifierService.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  private get flow(): WorkflowManagedFlowService | null {
    try {
      return this.moduleRef.get(workflowManagedFlowServiceClass(), { strict: false });
    } catch {
      return null;
    }
  }

  private get controller(): WorkflowControllerService | null {
    try {
      return this.moduleRef.get(workflowControllerServiceClass(), { strict: false });
    } catch {
      return null;
    }
  }

  private dispatch(kind: string, task: Promise<unknown> | undefined): void {
    if (!task) {
      return;
    }
    void task.catch((errorValue) => {
      const error = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
      this.log.error(`${kind} failed: ${error.message}`, error.stack);
    });
  }

  notifyAgentStatus(sessionId: string, run: AgentRun): void {
    this.dispatch('flow agent notification', this.flow?.notifyAgentStatus(sessionId, run));
    this.dispatch('controller agent notification', this.controller?.notifyAgentStatus(sessionId, run));
  }

  notifyControllerState(state: WorkflowControllerState): void {
    this.dispatch('flow controller notification', this.flow?.notifyControllerState(state));
  }
}
