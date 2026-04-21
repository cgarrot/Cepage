import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { GraphNode } from '@cepage/shared-core';
import { GraphService } from '../graph/graph.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkflowSkillsService } from '../workflow-skills/workflow-skills.service';
import { WorkflowCopilotService } from '../workflow-copilot/workflow-copilot.service';
import { WorkflowManagedFlowService } from '../agents/workflow-managed-flow.service';
import {
  type SessionFromSkillBodyDto,
  type SessionFromSkillResult,
  type SessionFromSkillMode,
} from './session-from-skill.dto';

// Generic skill-driven session bootstrapper.
//
// Given any workflow skill registered in the catalog, this service:
//   1. validates the skill exists,
//   2. creates a fresh session,
//   3. configures workspace if requested (parent dir + optional name),
//   4. seeds files / directories from caller-provided spec,
//   5. either imports an inline workflow_transfer JSON or asks the
//      workflow-copilot to architect the graph from the skill prompt,
//   6. optionally pins a target agent on every agent_step node,
//   7. optionally triggers the first managed_flow it finds.
//
// The service contains zero domain-specific logic: every "what to seed",
// "which agent to pin", and "what message to send to the copilot" is
// driven by the caller. Reusable across totally unrelated workflows.

const PLACEHOLDER_WORKSPACE_ABS_PATH = '{{WORKSPACE_ABS_PATH}}';

type SeedReport = {
  filesWritten: number;
  directoriesCopied: number;
};

@Injectable()
export class SessionFromSkillService {
  private readonly log = new Logger(SessionFromSkillService.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly skills: WorkflowSkillsService,
    private readonly graph: GraphService,
    private readonly copilot: WorkflowCopilotService,
    private readonly flows: WorkflowManagedFlowService,
  ) {}

  async scaffold(
    skillId: string,
    body: SessionFromSkillBodyDto,
  ): Promise<SessionFromSkillResult> {
    const skill = await this.skills.getSkill(skillId);

    const sessionName = (body.name?.trim() || `${skill.title} — ${new Date().toISOString()}`).slice(
      0,
      200,
    );
    const created = await this.sessions.create(sessionName);
    const sessionId = created.data.id;

    const workspaceDir = await this.applyWorkspace(sessionId, body.workspace);
    const seedReport = await this.applySeed(workspaceDir, body.seed);

    let mode: SessionFromSkillMode = 'empty';
    let threadId: string | undefined;
    let copilotMessageId: string | undefined;

    if (body.workflowTransfer) {
      const prepared = this.prepareWorkflowTransfer(body.workflowTransfer, {
        workspaceDir,
        agent: body.agent,
      });
      await this.graph.replaceWorkflow(sessionId, prepared);
      mode = 'workflow_transfer';
    } else if (body.copilot) {
      const result = await this.runCopilotArchitect(sessionId, skillId, skill.title, body);
      threadId = result.threadId;
      copilotMessageId = result.messageId;
      mode = 'copilot';
    }

    let flowNodeId: string | undefined;
    let flowId: string | undefined;
    let flowStatus: string | undefined;
    if (body.autoRun && mode !== 'empty') {
      const located = await this.findFirstManagedFlow(sessionId);
      if (located) {
        flowNodeId = located.id;
        const ran = await this.flows.run(sessionId, located.id, {
          requestId: `from-skill:${skillId}:${Date.now()}`,
        });
        flowId = (ran as { id?: string }).id;
        flowStatus = (ran as { status?: string }).status;
      } else {
        this.log.warn(
          `[from-skill ${skillId}] autoRun requested but no managed_flow node found in session ${sessionId}`,
        );
      }
    }

    this.log.log(
      `[from-skill ${skillId}] session=${sessionId} mode=${mode} workspace=${workspaceDir ?? 'none'} files=${seedReport.filesWritten} dirs=${seedReport.directoriesCopied}${flowId ? ` flow=${flowId} status=${flowStatus}` : ''}`,
    );

    return {
      sessionId,
      skillId,
      workspaceDir,
      mode,
      ...(threadId ? { threadId } : {}),
      ...(copilotMessageId ? { copilotMessageId } : {}),
      ...(flowNodeId ? { flowNodeId } : {}),
      ...(flowId ? { flowId } : {}),
      ...(flowStatus ? { flowStatus } : {}),
    };
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private async applyWorkspace(
    sessionId: string,
    workspace?: SessionFromSkillBodyDto['workspace'],
  ): Promise<string | null> {
    const parentDirectory =
      workspace?.parentDirectory?.trim()
      || process.env.SESSION_FROM_SKILL_DEFAULT_WORKSPACE_ROOT?.trim()
      || process.env.CEPAGE_DEFAULT_WORKSPACE_ROOT?.trim()
      || null;
    if (!parentDirectory) {
      return null;
    }
    const updated = await this.sessions.updateWorkspace(
      sessionId,
      parentDirectory,
      workspace?.directoryName,
    );
    const ws = updated.data.workspace;
    return ws?.workingDirectory ?? null;
  }

  private async applySeed(
    workspaceDir: string | null,
    seed: SessionFromSkillBodyDto['seed'],
  ): Promise<SeedReport> {
    const report: SeedReport = { filesWritten: 0, directoriesCopied: 0 };
    if (!seed) return report;
    if ((seed.files?.length ?? 0) === 0 && (seed.directories?.length ?? 0) === 0) {
      return report;
    }
    if (!workspaceDir) {
      throw new BadRequestException('SESSION_FROM_SKILL_SEED_REQUIRES_WORKSPACE');
    }
    await fs.mkdir(workspaceDir, { recursive: true });

    const allowedRoots = parseAllowedRoots(process.env.SESSION_FROM_SKILL_SEED_ALLOWED_ROOTS);

    for (const file of seed.files ?? []) {
      const dest = resolveSafe(workspaceDir, file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.content, 'utf8');
      report.filesWritten += 1;
    }

    for (const dir of seed.directories ?? []) {
      const source = path.resolve(dir.source);
      ensureSourceAllowed(source, allowedRoots);
      const dest = resolveSafe(workspaceDir, dir.destination);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(source, dest, { recursive: true, force: true });
      report.directoriesCopied += 1;
    }

    return report;
  }

  private prepareWorkflowTransfer(
    raw: unknown,
    opts: {
      workspaceDir: string | null;
      agent?: SessionFromSkillBodyDto['agent'];
    },
  ): unknown {
    let serialized = JSON.stringify(raw);
    if (opts.workspaceDir) {
      serialized = serialized.split(PLACEHOLDER_WORKSPACE_ABS_PATH).join(opts.workspaceDir);
    } else if (serialized.includes(PLACEHOLDER_WORKSPACE_ABS_PATH)) {
      throw new BadRequestException(
        `SESSION_FROM_SKILL_WORKSPACE_REQUIRED_FOR_PLACEHOLDER:${PLACEHOLDER_WORKSPACE_ABS_PATH}`,
      );
    }
    const obj = JSON.parse(serialized) as {
      graph?: { nodes?: Array<{ type?: string; content?: Record<string, unknown> }> };
    };
    if (opts.agent && Array.isArray(obj.graph?.nodes)) {
      const agent = opts.agent;
      for (const node of obj.graph!.nodes!) {
        if (node.type === 'agent_step' || node.type === 'agent_spawn') {
          node.content = {
            ...(node.content ?? {}),
            agentType: agent.agentType,
            model: { providerID: agent.providerID, modelID: agent.modelID },
            agentSelection: {
              mode: 'locked',
              selection: {
                type: agent.agentType,
                model: { providerID: agent.providerID, modelID: agent.modelID },
              },
            },
          };
        }
      }
    }
    return obj;
  }

  private async runCopilotArchitect(
    sessionId: string,
    skillId: string,
    skillTitle: string,
    body: SessionFromSkillBodyDto,
  ): Promise<{ threadId: string; messageId?: string }> {
    const copilotOpts = body.copilot ?? {};
    const ensureBody = {
      surface: 'sidebar' as const,
      ...(copilotOpts.title ? { title: copilotOpts.title } : {}),
      autoApply: copilotOpts.autoApply ?? true,
      autoRun: copilotOpts.autoRun ?? true,
      ...(body.agent
        ? {
            agentType: body.agent.agentType,
            model: { providerID: body.agent.providerID, modelID: body.agent.modelID },
          }
        : {}),
      metadata: {
        skill: { id: skillId, title: skillTitle },
        lockSkill: true,
      },
    };
    const thread = await this.copilot.ensureThread(sessionId, ensureBody);
    const message =
      copilotOpts.message?.trim()
      || `Use the skill "${skillId}" to architect a complete workflow ready to run end-to-end.`;

    // Architect dispatches an LLM call that may take several minutes.
    // Don't block the HTTP caller; emit assistant updates via realtime events.
    void this.copilot
      .sendMessage(sessionId, thread.thread.id, { content: message })
      .catch((err: unknown) => {
        this.log.error(
          `[from-skill ${skillId}] copilot.sendMessage failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return { threadId: thread.thread.id };
  }

  private async findFirstManagedFlow(sessionId: string): Promise<GraphNode | null> {
    const snapshot = await this.graph.loadSnapshot(sessionId);
    return snapshot.nodes.find((entry: GraphNode) => entry.type === 'managed_flow') ?? null;
  }
}

// ─── private utils ────────────────────────────────────────────────────

function resolveSafe(workspaceDir: string, relativePath: string): string {
  const normalized = relativePath.trim();
  if (!normalized) {
    throw new BadRequestException('SESSION_FROM_SKILL_SEED_PATH_EMPTY');
  }
  if (path.isAbsolute(normalized)) {
    throw new BadRequestException(`SESSION_FROM_SKILL_SEED_PATH_NOT_RELATIVE:${normalized}`);
  }
  const dest = path.resolve(workspaceDir, normalized);
  const wsAbs = path.resolve(workspaceDir);
  if (!dest.startsWith(`${wsAbs}${path.sep}`) && dest !== wsAbs) {
    throw new BadRequestException(`SESSION_FROM_SKILL_SEED_PATH_ESCAPES_WORKSPACE:${normalized}`);
  }
  return dest;
}

function parseAllowedRoots(envValue: string | undefined): string[] | null {
  if (!envValue) return null;
  const list = envValue
    .split(/[,;:\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  return list.length > 0 ? list : null;
}

function ensureSourceAllowed(source: string, allowedRoots: string[] | null): void {
  if (!path.isAbsolute(source)) {
    throw new BadRequestException(`SESSION_FROM_SKILL_SEED_SOURCE_NOT_ABSOLUTE:${source}`);
  }
  if (!allowedRoots) return;
  const ok = allowedRoots.some((root) => source === root || source.startsWith(`${root}${path.sep}`));
  if (!ok) {
    throw new BadRequestException(`SESSION_FROM_SKILL_SEED_SOURCE_NOT_ALLOWED:${source}`);
  }
}
