import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import type { GraphNode, GraphSnapshot } from '@cepage/shared-core';
import type { UserSkillRow } from '../../user-skills/user-skills.dto';
import { DryRunService } from './dry-run.service.js';

export type SandboxExecutionStatus = 'simulated' | 'skipped' | 'PASS' | 'FAIL';

export interface SandboxNodeResult {
  nodeId: string;
  status: SandboxExecutionStatus;
  detail?: string;
}

export interface SandboxExecutionResult {
  overall: 'PASS' | 'FAIL';
  perNode: SandboxNodeResult[];
  estimatedCost: number;
  warnings: string[];
}

export interface SandboxExecutionOptions {
  mode?: 'strict' | 'permissive';
}

@Injectable()
export class DryRunSandboxService {
  constructor(private readonly dryRunService: DryRunService) {}

  execute(
    skill: UserSkillRow,
    inputs: Record<string, unknown>,
    options?: SandboxExecutionOptions,
  ): SandboxExecutionResult {
    const dryRunResult = this.dryRunService.validate(skill, inputs, options?.mode ?? 'permissive');
    if (dryRunResult.overall === 'FAIL') {
      const perNode: SandboxNodeResult[] = [];
      for (const error of dryRunResult.errors) {
        perNode.push({
          nodeId: error.field ?? '',
          status: 'FAIL',
          detail: `${error.check}: ${error.message}`,
        });
      }
      return {
        overall: 'FAIL',
        perNode,
        estimatedCost: 0,
        warnings: dryRunResult.warnings,
      };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cepage-sandbox-'));
    const warnings: string[] = [...dryRunResult.warnings];
    const perNode: SandboxNodeResult[] = [];

    try {
      const graph = skill.graphJson as unknown as GraphSnapshot;
      if (!graph || !Array.isArray(graph.nodes)) {
        return { overall: 'PASS', perNode, estimatedCost: 0, warnings };
      }

      for (const node of graph.nodes) {
        if (!this.isGraphNode(node)) continue;
        const result = this.processNode(node, tempDir, warnings);
        perNode.push(result);
      }
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
      }
    }

    const overall = perNode.some((n) => n.status === 'FAIL') ? 'FAIL' : 'PASS';
    return { overall, perNode, estimatedCost: 0, warnings };
  }

  private isGraphNode(value: unknown): value is GraphNode {
    if (!value || typeof value !== 'object') return false;
    const n = value as GraphNode;
    return typeof n.id === 'string' && typeof n.type === 'string';
  }

  private processNode(
    node: GraphNode,
    tempDir: string,
    warnings: string[],
  ): SandboxNodeResult {
    switch (node.type) {
      case 'agent_step': {
        const text = String(
          node.content?.text ?? node.content?.summary ?? node.content?.prompt ?? '',
        );
        return { nodeId: node.id, status: 'simulated', detail: text || undefined };
      }
      case 'runtime_run': {
        const command = String(node.content?.command ?? node.content?.toolName ?? '');
        if (!command) {
          return { nodeId: node.id, status: 'FAIL', detail: 'Missing command' };
        }
        const exists = this.commandExists(command);
        if (!exists) {
          return {
            nodeId: node.id,
            status: 'FAIL',
            detail: `Command not found: ${command}`,
          };
        }
        return { nodeId: node.id, status: 'PASS' };
      }
      case 'file_diff': {
        const diffContent = String(
          node.content?.content ?? node.content?.patch ?? '',
        );
        if (!diffContent) {
          return { nodeId: node.id, status: 'FAIL', detail: 'Missing diff content' };
        }
        const pathValue = String(node.content?.path ?? '');
        const ext = pathValue ? path.extname(pathValue).toLowerCase() : '.patch';
        const outputPath = path.join(tempDir, `${node.id}${ext}`);
        try {
          fs.writeFileSync(outputPath, diffContent);
        } catch (err) {
          return {
            nodeId: node.id,
            status: 'FAIL',
            detail: `Failed to write patch: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (pathValue) {
          const syntaxError = this.checkSyntax(outputPath, ext);
          if (syntaxError) {
            return { nodeId: node.id, status: 'FAIL', detail: syntaxError };
          }
          if (!['.ts', '.js', '.py'].includes(ext)) {
            warnings.push(`Node ${node.id}: unknown extension ${ext}, skipping syntax check`);
          }
        } else {
          warnings.push(`Node ${node.id}: file_diff missing path, skipping syntax check`);
        }
        return { nodeId: node.id, status: 'PASS' };
      }
      default:
        return { nodeId: node.id, status: 'skipped' };
    }
  }

  private commandExists(command: string): boolean {
    try {
      const result = spawnSync('command', ['-v', command.split(' ')[0]], {
        shell: true,
        stdio: 'ignore',
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private checkSyntax(filePath: string, ext: string): string | undefined {
    switch (ext) {
      case '.ts': {
        const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
          fileName: filePath,
          reportDiagnostics: true,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        });
        const diagnostic = result.diagnostics?.find((d) => d.category === ts.DiagnosticCategory.Error);
        if (diagnostic) {
          return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') || 'TypeScript syntax check failed';
        }
        break;
      }
      case '.js': {
        const result = spawnSync('node', ['--check', filePath], {
          shell: false,
          stdio: 'pipe',
        });
        if (result.status !== 0) {
          return result.stderr.toString().trim() || 'JavaScript syntax check failed';
        }
        break;
      }
      case '.py': {
        const result = spawnSync('python', ['-m', 'py_compile', filePath], {
          shell: false,
          stdio: 'pipe',
        });
        if (result.status !== 0) {
          return result.stderr.toString().trim() || 'Python syntax check failed';
        }
        break;
      }
      default: {
        return undefined;
      }
    }
    return undefined;
  }
}
