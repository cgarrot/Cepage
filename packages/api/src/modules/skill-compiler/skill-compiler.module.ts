import { Module } from '@nestjs/common';
import { UserSkillsModule } from '../user-skills/user-skills.module';
import { SkillCompilerController } from './skill-compiler.controller';
import { OpencodeExtractorService } from './extractors/opencode-extractor.service';
import { CursorExtractorService } from './extractors/cursor-extractor.service';
import { ClaudeCodeExtractorService } from './extractors/claude-code-extractor.service';
import { GraphMapperService } from './graph-mapper.service';
import { ParametrizerService } from './parametrizer/parametrizer.service';
import { SchemaInferenceService } from './schema-inference/schema-inference.service';
import { SessionExtractorService } from './session-extractor.service';
import { SessionArchiveService } from './session-archive.service';
import { CompilerService } from './compiler/compiler.service';
import { DryRunService } from './dry-run/dry-run.service';

@Module({
  imports: [UserSkillsModule],
  controllers: [SkillCompilerController],
  providers: [
    OpencodeExtractorService,
    CursorExtractorService,
    ClaudeCodeExtractorService,
    SessionExtractorService,
    SessionArchiveService,
    GraphMapperService,
    ParametrizerService,
    SchemaInferenceService,
    CompilerService,
    DryRunService,
  ],
  exports: [
    OpencodeExtractorService,
    CursorExtractorService,
    ClaudeCodeExtractorService,
    SessionExtractorService,
    SessionArchiveService,
    GraphMapperService,
    ParametrizerService,
    SchemaInferenceService,
    CompilerService,
    DryRunService,
  ],
})
export class SkillCompilerModule {}
