import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { GraphSnapshot, ValidCompilerAgentType, WorkflowSkillExecution } from '@cepage/shared-core';
import { toSlug } from '../../../common/utils/slug.util';
import { UserSkillsService } from '../../user-skills/user-skills.service';
import type { UserSkillRow } from '../../user-skills/user-skills.dto';
import { GraphMapperService, type ExtractedSession as MappedExtractedSession } from '../graph-mapper.service';
import { ParametrizerService, type Parameter } from '../parametrizer/parametrizer.service';
import { SchemaInferenceService } from '../schema-inference/schema-inference.service';
import { SessionExtractorService } from '../session-extractor.service';

export interface CompileOptions {
  sessionId: string;
  agentType: ValidCompilerAgentType;
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

export interface CompilerMetric {
  event:
    | 'compilation_started'
    | 'compilation_completed'
    | 'compilation_failed'
    | 'skill_published'
    | 'skill_rejected';
  timestamp: string;
  sessionId?: string;
  agentType?: ValidCompilerAgentType;
  mode?: 'draft' | 'publish';
  durationMs?: number;
  errorType?: string;
  stage?: string;
}

type CompilerSkillDraft = Omit<Partial<UserSkillRow>, 'execution' | 'graphJson'> & {
  execution: WorkflowSkillExecution;
  graphJson: Record<string, unknown>;
};

const MAX_SLUG_SUFFIX = 100;

@Injectable()
export class CompilerService {
  private metrics: CompilerMetric[] = [];

  constructor(
    private readonly sessionExtractor: SessionExtractorService,
    private readonly graphMapper: GraphMapperService,
    private readonly parametrizer: ParametrizerService,
    private readonly schemaInference: SchemaInferenceService,
    private readonly userSkillsService: UserSkillsService,
  ) {}

  getMetrics(): CompilerMetric[] {
    return [...this.metrics];
  }

  clearMetrics(): void {
    this.metrics = [];
  }

  trackSkillRejected(sessionId: string, agentType: ValidCompilerAgentType): void {
    const metric: CompilerMetric = {
      event: 'skill_rejected',
      timestamp: new Date().toISOString(),
      sessionId,
      agentType,
    };
    this.metrics.push(metric);
    console.log(`[CompilerAnalytics] ${metric.event}`, metric);
  }

  private trackEvent(metric: CompilerMetric): void {
    this.metrics.push(metric);
    console.log(`[CompilerAnalytics] ${metric.event}`, metric);
  }

  async compile(options: CompileOptions): Promise<CompilationResult> {
    const startTime = Date.now();
    this.validateOptions(options);

    this.trackEvent({
      event: 'compilation_started',
      timestamp: new Date().toISOString(),
      sessionId: options.sessionId,
      agentType: options.agentType,
      mode: options.mode,
    });

    try {
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

      if (options.mode === 'publish') {
        this.trackEvent({
          event: 'skill_published',
          timestamp: new Date().toISOString(),
          sessionId: options.sessionId,
          agentType: options.agentType,
          mode: options.mode,
        });
      }

      this.trackEvent({
        event: 'compilation_completed',
        timestamp: new Date().toISOString(),
        sessionId: options.sessionId,
        agentType: options.agentType,
        mode: options.mode,
        durationMs: Date.now() - startTime,
      });

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
    } catch (error) {
      const errorType = error instanceof HttpException
        ? error.message.split(':')[0] ?? 'UNKNOWN'
        : 'INTERNAL_ERROR';

      this.trackEvent({
        event: 'compilation_failed',
        timestamp: new Date().toISOString(),
        sessionId: options.sessionId,
        agentType: options.agentType,
        mode: options.mode,
        durationMs: Date.now() - startTime,
        errorType,
      });

      throw error;
    }
  }

  private validateOptions(options: CompileOptions): void {
    if (!options.sessionId?.trim()) {
      throw new BadRequestException('SKILL_COMPILER_SESSION_ID_REQUIRED');
    }
    const validAgents = ['opencode', 'cursor_agent', 'claude_code'];
    if (!validAgents.includes(options.agentType)) {
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
      return this.sessionExtractor.extract(options.agentType, options.sessionData!, options.sessionId);
    });
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
