import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { GraphSnapshot, WorkflowSkillExecution } from '@cepage/shared-core';
import { toSlug } from '../../../common/utils/slug.util';
import { UserSkillsService } from '../../user-skills/user-skills.service';
import type { UserSkillRow } from '../../user-skills/user-skills.dto';
import { GraphMapperService, type ExtractedSession as MappedExtractedSession } from '../graph-mapper.service';
import { CursorExtractorService } from '../extractors/cursor-extractor.service';
import { OpencodeExtractorService, type OpenCodeEvent } from '../extractors/opencode-extractor.service';
import { ParametrizerService, type Parameter } from '../parametrizer/parametrizer.service';
import { SchemaInferenceService } from '../schema-inference/schema-inference.service';

export interface CompileOptions {
  sessionId: string;
  agentType: 'opencode' | 'cursor';
  mode: 'draft' | 'publish';
  sessionData?: string;
  inputsSchema?: Record<string, unknown>;
}

export interface CompilationReport {
  parameters: Parameter[];
  estimatedCost: number;
  graphStats: { nodes: number; edges: number };
  warnings: string[];
}

export interface CompilationResult {
  skill: Partial<UserSkillRow>;
  report: CompilationReport;
}

type CompilerSkillDraft = Omit<Partial<UserSkillRow>, 'execution' | 'graphJson'> & {
  execution: WorkflowSkillExecution;
  graphJson: Record<string, unknown>;
};

type OpencodeFixture =
  | OpenCodeEvent[]
  | {
      events: OpenCodeEvent[];
      sessionName?: string;
      name?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };

const MAX_SLUG_SUFFIX = 100;

@Injectable()
export class CompilerService {
  constructor(
    private readonly opencodeExtractor: OpencodeExtractorService,
    private readonly cursorExtractor: CursorExtractorService,
    private readonly graphMapper: GraphMapperService,
    private readonly parametrizer: ParametrizerService,
    private readonly schemaInference: SchemaInferenceService,
    private readonly userSkillsService: UserSkillsService,
  ) {}

  async compile(options: CompileOptions): Promise<CompilationResult> {
    this.validateOptions(options);

    const extracted = await this.extractSession(options);
    if (!extracted.nodes.length) {
      throw new BadRequestException(`SKILL_COMPILER_EMPTY_SESSION:${options.sessionId}`);
    }

    const graph = this.runStage('MAP', () =>
      this.graphMapper.map({
        ...extracted,
        metadata: {
          ...(extracted.metadata ?? {}),
          sessionId: options.sessionId,
        },
      }),
    );

    if (!graph.nodes.length) {
      throw new BadRequestException(`SKILL_COMPILER_EMPTY_GRAPH:${options.sessionId}`);
    }

    const parameterized = this.runStage('PARAMETERIZE', () => this.parametrizer.parameterize(graph));
    const schemas = this.runStage('INFER_SCHEMA', () =>
      this.schemaInference.inferSchema(parameterized.parameters),
    );

    const title = this.resolveSessionTitle(options.sessionId, extracted.metadata);
    const slug = await this.generateUniqueSlug(title);
    const execution = this.buildExecution(options.sessionId);
    const warnings = this.collectWarnings(
      extracted.warnings,
      parameterized.warnings,
      options.mode === 'draft' ? ['Draft mode generated a preview without saving.'] : undefined,
    );

    const draftSkill: CompilerSkillDraft = {
      slug,
      title,
      summary: this.buildSummary(title, options, parameterized.parameters, graph),
      kind: 'workflow_template',
      tags: ['compiled', options.agentType],
      category: 'compiled',
      inputsSchema: options.inputsSchema ?? schemas.inputsSchema,
      outputsSchema: schemas.outputsSchema,
      graphJson: graph as unknown as Record<string, unknown>,
      execution,
      sourceSessionId: options.sessionId,
      visibility: 'private',
      promptText: null,
    };

    const skill =
      options.mode === 'publish'
        ? await this.persistSkill(draftSkill)
        : draftSkill;

    return {
      skill,
      report: {
        parameters: parameterized.parameters,
        estimatedCost: this.estimateCost(graph, parameterized.parameters),
        graphStats: {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
        warnings,
      },
    };
  }

  private validateOptions(options: CompileOptions): void {
    if (!options.sessionId?.trim()) {
      throw new BadRequestException('SKILL_COMPILER_SESSION_ID_REQUIRED');
    }
    if (!['opencode', 'cursor'].includes(options.agentType)) {
      throw new BadRequestException(`SKILL_COMPILER_UNSUPPORTED_AGENT:${options.agentType}`);
    }
    if (!['draft', 'publish'].includes(options.mode)) {
      throw new BadRequestException(`SKILL_COMPILER_UNSUPPORTED_MODE:${options.mode}`);
    }
    if (!options.sessionData?.trim()) {
      throw new BadRequestException(`SKILL_COMPILER_SESSION_DATA_REQUIRED:${options.agentType}`);
    }
  }

  private async extractSession(options: CompileOptions): Promise<MappedExtractedSession> {
    return this.runStage('EXTRACT', async () => {
      if (options.agentType === 'cursor') {
        const sessionPath = this.resolveAllowedSessionPath(options.sessionData!);
        const extracted = this.cursorExtractor.parse(sessionPath);
        return {
          ...extracted,
          metadata: {
            ...(extracted.metadata ?? {}),
            sessionId: options.sessionId,
            sessionDataPath: sessionPath,
          },
          warnings: extracted.warnings ?? [],
        };
      }

      const fixture = await this.readOpencodeFixture(options.sessionData!);
      const events = Array.isArray(fixture) ? fixture : fixture.events;
      const extracted = this.opencodeExtractor.parse(events);
      const fixtureMetadata = Array.isArray(fixture)
        ? {}
        : {
            ...(fixture.metadata ?? {}),
            ...(fixture.sessionName ? { sessionName: fixture.sessionName } : {}),
            ...(fixture.name ? { name: fixture.name } : {}),
            ...(fixture.title ? { title: fixture.title } : {}),
          };

      return {
        ...extracted,
        metadata: {
          ...(extracted.metadata ?? {}),
          ...fixtureMetadata,
          sessionId: options.sessionId,
        },
        warnings: [],
      };
    });
  }

  private async readOpencodeFixture(source: string): Promise<OpencodeFixture> {
    const raw = await this.readSourceText(source);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('SKILL_COMPILER_INVALID_OPENCODE_SESSION');
    }

    if (Array.isArray(parsed)) {
      return parsed as OpenCodeEvent[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)) {
      return parsed as OpencodeFixture;
    }

    throw new BadRequestException('SKILL_COMPILER_INVALID_OPENCODE_SESSION:expected event array');
  }

  private async readSourceText(source: string): Promise<string> {
    try {
      return await readFile(this.resolveAllowedSessionPath(source), 'utf8');
    } catch {
      throw new BadRequestException('SKILL_COMPILER_SESSION_DATA_UNREADABLE');
    }
  }

  private resolveAllowedSessionPath(source: string): string {
    const resolvedPath = resolve(source);
    const allowedRoots = [resolve(process.cwd()), resolve(tmpdir())];

    const isAllowed = allowedRoots.some((root) => {
      const pathRelative = relative(root, resolvedPath);
      return pathRelative === '' || (!pathRelative.startsWith('..') && !pathRelative.includes(`..`));
    });

    if (!isAllowed) {
      throw new BadRequestException('SKILL_COMPILER_INVALID_SESSION_PATH');
    }

    return resolvedPath;
  }

  private resolveSessionTitle(sessionId: string, metadata?: Record<string, unknown>): string {
    const rawTitle = [metadata?.sessionName, metadata?.title, metadata?.name, sessionId].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );

    return rawTitle?.trim() || `Compiled skill ${sessionId}`;
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const base = toSlug(title);
    let index = 1;

    while (index <= MAX_SLUG_SUFFIX) {
      const suffix = index === 1 ? '' : `-${index}`;
      const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      try {
        await this.userSkillsService.getBySlug(candidate);
        index += 1;
      } catch (error) {
        if (error instanceof NotFoundException) {
          return candidate;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException('SKILL_COMPILER_SLUG_EXHAUSTED');
  }

  private buildExecution(sessionId: string): WorkflowSkillExecution {
    return {
      mode: 'session',
      graphRef: sessionId,
      copilotFallback: true,
      autoRun: true,
    };
  }

  private buildSummary(
    title: string,
    options: CompileOptions,
    parameters: Parameter[],
    graph: GraphSnapshot,
  ): string {
    return [
      `Compiled from ${options.agentType} session \"${title}\".`,
      `Graph contains ${graph.nodes.length} nodes, ${graph.edges.length} edges, and ${parameters.length} detected parameters.`,
    ].join(' ');
  }

  private async persistSkill(skill: CompilerSkillDraft): Promise<UserSkillRow> {
    return this.runStage('PUBLISH', () =>
      this.userSkillsService.create({
        slug: skill.slug,
        title: skill.title ?? 'Compiled skill',
        summary: skill.summary ?? 'Compiled skill',
        icon: skill.icon ?? undefined,
        category: skill.category ?? undefined,
        tags: skill.tags ?? [],
        inputsSchema: skill.inputsSchema ?? {},
        outputsSchema: skill.outputsSchema ?? {},
        kind: skill.kind ?? 'workflow_template',
        promptText: skill.promptText ?? undefined,
        graphJson: skill.graphJson,
        execution: skill.execution,
        sourceSessionId: skill.sourceSessionId ?? undefined,
        visibility: skill.visibility ?? 'private',
      }),
    );
  }

  private collectWarnings(...warningGroups: Array<string[] | undefined>): string[] {
    return [...new Set(warningGroups.flatMap((group) => group ?? []))];
  }

  private estimateCost(graph: GraphSnapshot, parameters: Parameter[]): number {
    const nodeWeight = graph.nodes.reduce((total, node) => {
      switch (node.type) {
        case 'runtime_target':
          return total + 4;
        case 'runtime_run':
          return total + 2;
        case 'file_diff':
          return total + 1.5;
        case 'agent_step':
          return total + 1;
        case 'agent_output':
          return total + 0.5;
        default:
          return total + 0.25;
      }
    }, 0);

    return Number((nodeWeight + graph.edges.length * 0.2 + parameters.length * 0.5).toFixed(2));
  }

  private runStage<T>(stage: string, operation: () => Promise<T>): Promise<T>;
  private runStage<T>(stage: string, operation: () => T): T;
  private runStage<T>(stage: string, operation: () => T | Promise<T>): T | Promise<T> {
    try {
      const result = operation();
      if (result instanceof Promise) {
        return result.catch((error) => {
          if (error instanceof HttpException) {
            throw error;
          }
          throw new InternalServerErrorException(`SKILL_COMPILER_${stage}_FAILED`);
        });
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(`SKILL_COMPILER_${stage}_FAILED`);
    }
  }
}
