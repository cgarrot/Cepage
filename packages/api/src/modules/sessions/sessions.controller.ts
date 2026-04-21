import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { SessionsService } from './sessions.service';
import { TimelineService } from './timeline.service';

class CreateSessionDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

class UpdateSessionWorkspaceDto {
  @IsString()
  @MinLength(1)
  parentDirectory!: string;

  @IsOptional()
  @IsString()
  directoryName?: string;
}

class ChooseParentDirectoryDto {
  @IsOptional()
  @IsString()
  defaultPath?: string;
}

class DuplicateSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}

class PatchSessionStatusDto {
  @IsIn(['active', 'archived'])
  status!: 'active' | 'archived';
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly timeline: TimelineService,
  ) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') statusRaw?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    let filter: 'active' | 'archived' | undefined;
    if (statusRaw === 'active' || statusRaw === 'archived') {
      filter = statusRaw;
    } else if (statusRaw != null && statusRaw !== '') {
      throw new BadRequestException('INVALID_STATUS_FILTER');
    }
    return this.sessions.list(
      q,
      filter,
      limit != null ? Number(limit) : undefined,
      offset != null ? Number(offset) : undefined,
    );
  }

  @Post()
  create(@Body() body: CreateSessionDto) {
    return this.sessions.create(body.name);
  }

  @Post('choose-parent-directory')
  chooseParentDirectory(@Body() body: ChooseParentDirectoryDto) {
    return this.sessions.chooseParentDirectory(body.defaultPath);
  }

  @Post(':sessionId/duplicate')
  duplicate(
    @Param('sessionId') sessionId: string,
    @Body() body: DuplicateSessionDto,
  ) {
    return this.sessions.duplicateSession(sessionId, body.name);
  }

  @Get(':sessionId')
  getMeta(@Param('sessionId') sessionId: string) {
    return this.sessions.getMeta(sessionId);
  }

  @Patch(':sessionId/workspace')
  updateWorkspace(
    @Param('sessionId') sessionId: string,
    @Body() body: UpdateSessionWorkspaceDto,
  ) {
    return this.sessions.updateWorkspace(sessionId, body.parentDirectory, body.directoryName);
  }

  @Post(':sessionId/workspace/open')
  openWorkspace(@Param('sessionId') sessionId: string) {
    return this.sessions.openWorkspaceDirectory(sessionId);
  }

  @Patch(':sessionId')
  patchSessionMeta(
    @Param('sessionId') sessionId: string,
    @Body() body: PatchSessionStatusDto,
  ) {
    return this.sessions.setStatus(sessionId, body.status);
  }

  @Delete(':sessionId')
  removeArchived(@Param('sessionId') sessionId: string) {
    return this.sessions.removeArchived(sessionId);
  }

  @Get(':sessionId/graph')
  getGraph(@Param('sessionId') sessionId: string) {
    return this.sessions.getGraphBundle(sessionId);
  }

  @Get(':sessionId/timeline')
  listTimeline(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('actorType') actorType?: string,
    @Query('runId') runId?: string,
  ) {
    let type: 'human' | 'agent' | 'system' | undefined;
    if (actorType === 'human' || actorType === 'agent' || actorType === 'system') {
      type = actorType;
    } else if (actorType != null && actorType !== '') {
      throw new BadRequestException('INVALID_TIMELINE_ACTOR');
    }
    return this.timeline.list(sessionId, limit != null ? Number(limit) : undefined, before, type, runId);
  }

  @Get(':sessionId/snapshots')
  listSnapshots(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.sessions.listSnapshots(sessionId, limit != null ? Number(limit) : undefined, before);
  }

  @Get(':sessionId/snapshots/:snapshotId')
  getSnapshot(
    @Param('sessionId') sessionId: string,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.sessions.getSnapshot(sessionId, snapshotId);
  }

  @Get(':sessionId/workflow/export')
  exportWorkflow(@Param('sessionId') sessionId: string) {
    return this.sessions.exportWorkflow(sessionId);
  }
}
