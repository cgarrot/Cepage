import { Module } from '@nestjs/common';
import { GraphService } from './graph.service';
import { BranchesController } from './branches.controller';
import { FileNodeController } from './file-node.controller';
import { FileNodeService } from './file-node.service';
import { GraphController } from './graph.controller';
import { ActivityModule } from '../activity/activity.module';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Module({
  imports: [CollaborationModule, ActivityModule],
  controllers: [GraphController, BranchesController, FileNodeController],
  providers: [GraphService, FileNodeService],
  exports: [GraphService, FileNodeService],
})
export class GraphModule {}
