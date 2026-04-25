import { Module, forwardRef } from '@nestjs/common';
import { SkillMiningWorker } from './skill-mining.worker';
import { SkillMiningService } from './skill-mining.service';
import { SkillMiningController } from './skill-mining.controller';
import { SkillCompilerModule } from '../skill-compiler/skill-compiler.module';
import { SessionAnalysisModule } from '../session-analysis/session-analysis.module';

@Module({
  imports: [forwardRef(() => SkillCompilerModule), SessionAnalysisModule],
  controllers: [SkillMiningController],
  providers: [SkillMiningWorker, SkillMiningService],
  exports: [SkillMiningWorker, SkillMiningService],
})
export class SkillMiningModule {}
