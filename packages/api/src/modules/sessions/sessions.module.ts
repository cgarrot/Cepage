import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { TimelineService } from './timeline.service';
import { WorkspaceFilesController } from './workspace-files.controller';
import { WorkspaceFilesService } from './workspace-files.service';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [GraphModule],
  controllers: [SessionsController, WorkspaceFilesController],
  providers: [SessionsService, TimelineService, WorkspaceFilesService],
  exports: [SessionsService],
})
export class SessionsModule {}
