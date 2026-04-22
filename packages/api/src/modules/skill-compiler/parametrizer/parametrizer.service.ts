import { Injectable } from '@nestjs/common';
import type { GraphNode, GraphSnapshot } from '@cepage/shared-core';

export type ParameterInferredType = 'string' | 'number' | 'boolean' | 'secret';

export interface Parameter {
  name: string;
  originalValue: string;
  inferredType: ParameterInferredType;
  isSecret: boolean;
  suggestedDefault: string;
}

export interface ParameterizationResult {
  graph: GraphSnapshot;
  parameters: Parameter[];
  warnings: string[];
}

type DetectionKind = 'url' | 'api_key' | 'email' | 'entity' | 'file_path';

type DetectedPattern = {
  kind: DetectionKind;
  value: string;
  start: number;
  end: number;
  isSecret: boolean;
};

const URL_RE = /https?:\/\/[^\s"'`<>]+/g;
const API_KEY_RE = /\b(?:sk_(?:live|test)_[A-Za-z0-9]+|pk_[A-Za-z0-9]+)\b/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const FILE_PATH_RE = /\/[a-zA-Z0-9_/\-.]+/g;
const ENTITY_RE = /\b(?:Stripe|PayPal|GitHub)\b/g;

const DETECTION_PRIORITY: Record<DetectionKind, number> = {
  api_key: 0,
  url: 1,
  email: 2,
  file_path: 3,
  entity: 4,
};

const REDACTED_SECRET = '[REDACTED]';

@Injectable()
export class ParametrizerService {
  parameterize(graph: GraphSnapshot): ParameterizationResult {
    const nextGraph = structuredClone(graph);
    const parameters: Parameter[] = [];
    const warnings: string[] = [];
    const parameterByKey = new Map<string, Parameter>();
    const usedNames = new Set<string>();

    for (const node of nextGraph.nodes) {
      this.parameterizeNode(node, parameters, warnings, parameterByKey, usedNames);
    }

    return {
      graph: nextGraph,
      parameters,
      warnings: Array.from(new Set(warnings)),
    };
  }

  private parameterizeNode(
    node: GraphNode,
    parameters: Parameter[],
    warnings: string[],
    parameterByKey: Map<string, Parameter>,
    usedNames: Set<string>,
  ): void {
    for (const [key, value] of Object.entries(node.content)) {
      if (typeof value !== 'string' || !value) continue;
      const detected = this.detectPatterns(value);
      if (!detected.length) continue;

      let parameterized = value;
      for (const match of [...detected].sort((a, b) => b.start - a.start)) {
        const existing = parameterByKey.get(this.getParameterKey(match));
        const parameter = existing ?? this.createParameter(match, value, key, warnings, usedNames);
        if (!existing) {
          parameterByKey.set(this.getParameterKey(match), parameter);
          parameters.push(parameter);
        }
        parameterized =
          parameterized.slice(0, match.start) + `{{${parameter.name}}}` + parameterized.slice(match.end);
      }

      node.content[key] = parameterized;
    }
  }

  private detectPatterns(content: string): DetectedPattern[] {
    const matches: DetectedPattern[] = [];
    this.collectMatches(matches, content, API_KEY_RE, 'api_key', true);
    this.collectMatches(matches, content, URL_RE, 'url', false, this.trimTrailingPunctuation);
    this.collectMatches(matches, content, EMAIL_RE, 'email', false);
    this.collectMatches(matches, content, FILE_PATH_RE, 'file_path', false, this.trimTrailingPunctuation);
    this.collectMatches(matches, content, ENTITY_RE, 'entity', false);

    return matches
      .sort((a, b) => a.start - b.start || DETECTION_PRIORITY[a.kind] - DETECTION_PRIORITY[b.kind])
      .filter((match, index, all) => {
        for (let i = 0; i < index; i += 1) {
          const prev = all[i];
          if (match.start < prev.end && match.end > prev.start) return false;
        }
        return true;
      });
  }

  private collectMatches(
    matches: DetectedPattern[],
    content: string,
    regex: RegExp,
    kind: DetectionKind,
    isSecret: boolean,
    normalize?: (value: string) => string,
  ): void {
    regex.lastIndex = 0;
    let result: RegExpExecArray | null;
    while ((result = regex.exec(content)) != null) {
      const rawValue = result[0];
      const value = normalize ? normalize(rawValue) : rawValue;
      if (!value) continue;
      const start = result.index;
      const end = start + value.length;
      if (end <= start) continue;
      matches.push({ kind, value, start, end, isSecret });
    }
  }

  private createParameter(
    match: DetectedPattern,
    context: string,
    contentKey: string,
    warnings: string[],
    usedNames: Set<string>,
  ): Parameter {
    const name = this.ensureUniqueName(this.generateParameterName(match, context, contentKey), usedNames);
    const inferredType: ParameterInferredType = match.isSecret ? 'secret' : 'string';

    if (match.isSecret) {
      warnings.push(`Secret detected for parameter ${name}; default value was redacted.`);
    }

    return {
      name,
      originalValue: match.isSecret ? REDACTED_SECRET : match.value,
      inferredType,
      isSecret: match.isSecret,
      suggestedDefault: match.isSecret ? '' : match.value,
    };
  }

  private generateParameterName(match: DetectedPattern, context: string, contentKey: string): string {
    const lowerContext = context.toLowerCase();
    const keyHint = this.toSnakeCase(contentKey);

    if (match.kind === 'api_key') {
      const provider = this.detectProvider(context);
      if (provider) return `${provider}_api_key`;
      if (/token/i.test(context)) return 'access_token';
      return 'api_key';
    }

    if (match.kind === 'url') {
      if (/webhook/i.test(context) || /\/webhooks?\b/i.test(match.value)) return 'webhook_url';
      try {
        const parsed = new URL(match.value);
        const host = parsed.hostname.toLowerCase();
        if (host.startsWith('api.') && !parsed.pathname.replace(/\/+$/, '')) return 'api_base_url';
        const provider = this.detectProvider(`${context} ${host}`);
        if (provider && host.startsWith('api.')) return `${provider}_api_url`;
      } catch {
        // Ignore invalid URL parsing and fall through to context heuristics.
      }
      if (keyHint.includes('url') || keyHint.includes('endpoint')) return keyHint;
      if (/api/i.test(lowerContext)) return 'api_url';
      return 'service_url';
    }

    if (match.kind === 'email') {
      if (/support/i.test(context)) return 'support_email';
      if (/notify|notification/i.test(context)) return 'notification_email';
      return keyHint.includes('email') ? keyHint : 'email_address';
    }

    if (match.kind === 'file_path') {
      if (keyHint.includes('path')) return keyHint;
      if (/output/i.test(context)) return 'output_file_path';
      if (/input/i.test(context)) return 'input_file_path';
      return 'file_path';
    }

    if (match.kind === 'entity') {
      if (/payment|billing|checkout|refund|invoice|integration/i.test(context)) return 'payment_provider';
      if (/git|repository|repo/i.test(context)) return 'git_provider';
      return 'service_name';
    }

    return keyHint || 'parameter';
  }

  private detectProvider(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes('stripe')) return 'stripe';
    if (lower.includes('paypal')) return 'paypal';
    if (lower.includes('github')) return 'github';
    return null;
  }

  private ensureUniqueName(baseName: string, usedNames: Set<string>): string {
    const normalized = this.toSnakeCase(baseName) || 'parameter';
    if (!usedNames.has(normalized)) {
      usedNames.add(normalized);
      return normalized;
    }

    let index = 2;
    let candidate = `${normalized}_${index}`;
    while (usedNames.has(candidate)) {
      index += 1;
      candidate = `${normalized}_${index}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  private getParameterKey(match: DetectedPattern): string {
    return `${match.kind}:${match.value.toLowerCase()}`;
  }

  private trimTrailingPunctuation(value: string): string {
    return value.replace(/[.,;!?)]*$/g, '');
  }

  private toSnakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .toLowerCase();
  }
}
