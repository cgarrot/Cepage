import { Module } from '@nestjs/common';
import { SessionAnalyzerService } from './session-analyzer.service';
import { SessionPatternService } from './session-pattern.service';

@Module({
  providers: [SessionAnalyzerService, SessionPatternService],
  exports: [SessionAnalyzerService, SessionPatternService],
})
export class SessionAnalysisModule {}
