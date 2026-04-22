import { Module } from '@nestjs/common';
import { WorkflowSkillsModule } from '../workflow-skills/workflow-skills.module';
import { OpenapiController } from './openapi.controller';
import { OpenapiService } from './openapi.service';

@Module({
  imports: [WorkflowSkillsModule],
  controllers: [OpenapiController],
  providers: [OpenapiService],
  exports: [OpenapiService],
})
export class OpenapiModule {}
