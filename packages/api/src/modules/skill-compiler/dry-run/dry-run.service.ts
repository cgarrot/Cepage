import { Injectable } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { GraphSnapshot } from '@cepage/shared-core';
import { nodeTypeSchema } from '@cepage/shared-core';
import type { UserSkillRow } from '../../user-skills/user-skills.dto';

export interface DryRunResult {
  overall: 'PASS' | 'FAIL';
  checks: {
    parametric: 'PASS' | 'FAIL';
    schema: 'PASS' | 'FAIL';
    graph: 'PASS' | 'FAIL';
  };
  warnings: string[];
  errors: Array<{ check: string; field?: string; message: string }>;
  estimatedCost: number;
}

@Injectable()
export class DryRunService {
  private readonly ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
    addFormats(this.ajv);
  }

  validate(
    skill: UserSkillRow,
    inputs: Record<string, unknown>,
    mode: 'strict' | 'permissive' = 'permissive',
  ): DryRunResult {
    const warnings: string[] = [];
    const errors: DryRunResult['errors'] = [];

    const parametricResult = this.checkParametricCoverage(skill, inputs, warnings, errors);
    const schemaResult = this.checkSchemaValidation(skill, inputs, warnings, errors);
    const graphResult = this.checkGraphIntegrity(skill, warnings, errors);

    const hasFailures = parametricResult === 'FAIL' || schemaResult === 'FAIL' || graphResult === 'FAIL';
    const hasWarnings = warnings.length > 0;

    let overall: 'PASS' | 'FAIL';
    if (hasFailures) {
      overall = 'FAIL';
    } else if (mode === 'strict' && hasWarnings) {
      overall = 'FAIL';
    } else {
      overall = 'PASS';
    }

    return {
      overall,
      checks: {
        parametric: parametricResult,
        schema: schemaResult,
        graph: graphResult,
      },
      warnings,
      errors,
      estimatedCost: this.estimateCost(skill),
    };
  }

  private checkParametricCoverage(
    skill: UserSkillRow,
    inputs: Record<string, unknown>,
    warnings: string[],
    errors: DryRunResult['errors'],
  ): 'PASS' | 'FAIL' {
    const required: string[] = skill.inputsSchema?.required ?? [];
    let failed = false;

    for (const field of required) {
      if (!(field in inputs) || inputs[field] === undefined || inputs[field] === null) {
        errors.push({ check: 'parametric', field, message: `Missing required input: ${field}` });
        failed = true;
      }
    }

    const properties = skill.inputsSchema?.properties ? Object.keys(skill.inputsSchema.properties) : [];
    for (const key of Object.keys(inputs)) {
      if (!properties.includes(key) && !required.includes(key)) {
        warnings.push(`Unexpected input field: ${key}`);
      }
    }

    return failed ? 'FAIL' : 'PASS';
  }

  private checkSchemaValidation(
    skill: UserSkillRow,
    inputs: Record<string, unknown>,
    warnings: string[],
    errors: DryRunResult['errors'],
  ): 'PASS' | 'FAIL' {
    if (!skill.inputsSchema || Object.keys(skill.inputsSchema).length === 0) {
      warnings.push('No inputsSchema defined; skipping schema validation.');
      return 'PASS';
    }

    try {
      const validate = this.ajv.compile(skill.inputsSchema as object);
      const valid = validate(inputs);
      if (!valid) {
        for (const err of validate.errors ?? []) {
          errors.push({
            check: 'schema',
            field: (err.instancePath || '/').replace(/^\//, '').replace(/\//g, '.') || '(root)',
            message: err.message ?? 'invalid',
          });
        }
        return 'FAIL';
      }
      return 'PASS';
    } catch (compileError) {
      errors.push({
        check: 'schema',
        message: `Invalid inputsSchema: ${compileError instanceof Error ? compileError.message : String(compileError)}`,
      });
      return 'FAIL';
    }
  }

  private checkGraphIntegrity(
    skill: UserSkillRow,
    warnings: string[],
    errors: DryRunResult['errors'],
  ): 'PASS' | 'FAIL' {
    if (!skill.graphJson) {
      warnings.push('No graphJson defined; skipping graph integrity check.');
      return 'PASS';
    }

    const graph = skill.graphJson as unknown as GraphSnapshot;
    let failed = false;

    if (!Array.isArray(graph.nodes)) {
      errors.push({ check: 'graph', message: 'graphJson.nodes is not an array' });
      return 'FAIL';
    }

    if (!Array.isArray(graph.edges)) {
      errors.push({ check: 'graph', message: 'graphJson.edges is not an array' });
      return 'FAIL';
    }

    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const validNodeTypes = new Set(nodeTypeSchema.options);

    for (const node of graph.nodes) {
      if (!node.id) {
        errors.push({ check: 'graph', message: 'Node missing id' });
        failed = true;
      }
      if (!validNodeTypes.has(node.type)) {
        errors.push({ check: 'graph', field: node.id, message: `Invalid node type: ${node.type}` });
        failed = true;
      }
    }

    for (const edge of graph.edges) {
      if (!edge.id) {
        errors.push({ check: 'graph', message: 'Edge missing id' });
        failed = true;
      }
      if (!nodeIds.has(edge.source)) {
        errors.push({ check: 'graph', field: edge.id, message: `Dangling edge: source node ${edge.source} not found` });
        failed = true;
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({ check: 'graph', field: edge.id, message: `Dangling edge: target node ${edge.target} not found` });
        failed = true;
      }
    }

    if (graph.nodes.length === 0) {
      warnings.push('Graph contains no nodes.');
    }

    return failed ? 'FAIL' : 'PASS';
  }

  private estimateCost(skill: UserSkillRow): number {
    const graph = skill.graphJson as unknown as GraphSnapshot | undefined;
    if (!graph || !Array.isArray(graph.nodes)) {
      return 0;
    }

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

    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;

    return Number((nodeWeight + edgeCount * 0.2).toFixed(2));
  }
}
