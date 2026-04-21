import { createReadStream, type ReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { readSessionWorkspace } from '../../common/utils/session-workspace.util';
import { resolveWorkspaceFilePath } from '../agents/run-artifacts.util';
import { detectMimeType, isTextMime } from './workspace-files.util';

export type WorkspaceFileMeta = {
  path: string;
  size: number;
  mtimeMs: number;
  mime: string;
  isText: boolean;
};

export type WorkspaceFileStream = {
  path: string;
  mime: string;
  size: number;
  filename: string;
  stream: ReadStream;
};

@Injectable()
export class WorkspaceFilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMeta(sessionId: string, requestedPath: string): Promise<WorkspaceFileMeta> {
    const { absolutePath, relativePath } = await this.resolve(sessionId, requestedPath);
    const stat = await this.statFile(absolutePath);
    const mime = detectMimeType(relativePath);
    return {
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mime,
      isText: isTextMime(mime),
    };
  }

  async openStream(sessionId: string, requestedPath: string): Promise<WorkspaceFileStream> {
    const { absolutePath, relativePath } = await this.resolve(sessionId, requestedPath);
    const stat = await this.statFile(absolutePath);
    const mime = detectMimeType(relativePath);
    return {
      path: relativePath,
      mime,
      size: stat.size,
      filename: path.basename(relativePath),
      stream: createReadStream(absolutePath),
    };
  }

  private async resolve(
    sessionId: string,
    requestedPath: string,
  ): Promise<{ absolutePath: string; relativePath: string }> {
    const root = await this.resolveSessionWorkspaceRoot(sessionId);
    try {
      return resolveWorkspaceFilePath(root, requestedPath);
    } catch (errorValue) {
      throw new BadRequestException(
        errorValue instanceof Error ? errorValue.message : 'WORKSPACE_FILE_PATH_INVALID',
      );
    }
  }

  private async resolveSessionWorkspaceRoot(sessionId: string): Promise<string> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        workspaceParentDirectory: true,
        workspaceDirectoryName: true,
      },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const workspace = readSessionWorkspace(process.cwd(), session);
    if (!workspace) {
      throw new BadRequestException('SESSION_WORKSPACE_NOT_CONFIGURED');
    }
    return workspace.workingDirectory;
  }

  private async statFile(absolutePath: string) {
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        throw new BadRequestException('WORKSPACE_FILE_PATH_IS_DIRECTORY');
      }
      if (!stat.isFile()) {
        throw new BadRequestException('WORKSPACE_FILE_PATH_NOT_FILE');
      }
      return stat;
    } catch (errorValue) {
      const code = (errorValue as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new NotFoundException('WORKSPACE_FILE_NOT_FOUND');
      }
      if (errorValue instanceof BadRequestException || errorValue instanceof NotFoundException) {
        throw errorValue;
      }
      throw errorValue;
    }
  }
}
