import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Module({
  imports: [CollaborationModule],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
