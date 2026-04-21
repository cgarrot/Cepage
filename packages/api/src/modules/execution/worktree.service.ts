import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class WorktreeService {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(input: {
    sessionId: string;
    runId?: string;
    executionId?: string;
    cwd: string;
    branchName?: string;
  }) {
    const session = await this.prisma.session.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        workspaceParentDirectory: true,
        workspaceDirectoryName: true,
      },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const stored = readSessionWorkspace(process.cwd(), session);
    const root =
      stored?.workingDirectory
      ?? input.cwd;
    const safe = (input.executionId ?? input.runId ?? 'shared').replace(/[^a-zA-Z0-9_-]/g, '-');
    const planned = path.resolve(root, '.cepage', 'worktrees', safe);
    await fs.mkdir(planned, { recursive: true });
    return this.prisma.worktreeAllocation.create({
      data: {
        sessionId: input.sessionId,
        runId: input.runId,
        executionId: input.executionId,
        status: 'active',
        rootPath: planned,
        branchName: input.branchName,
        metadata: {
          requestedCwd: input.cwd,
          isolation: 'logical',
        },
      },
    });
  }

  async releaseByRun(runId: string): Promise<void> {
    await this.prisma.worktreeAllocation.updateMany({
      where: {
        runId,
        status: 'active',
      },
      data: {
        status: 'released',
        releasedAt: new Date(),
      },
    });
  }
}
