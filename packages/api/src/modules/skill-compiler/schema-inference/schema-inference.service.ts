import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@cepage/shared-core';
import type { Parameter } from '../parametrizer/parametrizer.service';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export interface SchemaInferenceResult {
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
}

@Injectable()
export class SchemaInferenceService {
  private readonly ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  inferSchema(parameters: Parameter[]): SchemaInferenceResult {
    const validated = this.validateParameters(parameters);
    const grouped = this.groupByName(validated);
    const inputsSchema = this.buildInputsSchema(grouped);
    const outputsSchema = this.buildOutputsSchema(grouped);

    this.ajv.compile(inputsSchema);
    this.ajv.compile(outputsSchema);

    return { inputsSchema, outputsSchema };
  }

  private validateParameters(parameters: Parameter[]): Parameter[] {
    if (!Array.isArray(parameters)) return [];
    return parameters.filter((p) => p && typeof p.name === 'string' && p.name.length > 0);
  }

  private groupByName(parameters: Parameter[]): Map<string, Parameter[]> {
    const grouped = new Map<string, Parameter[]>();
    for (const param of parameters) {
      const existing = grouped.get(param.name) ?? [];
      existing.push(param);
      grouped.set(param.name, existing);
    }
    return grouped;
  }

  private buildInputsSchema(grouped: Map<string, Parameter[]>): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [name, params] of grouped) {
      const schema = this.inferParameterSchema(params);
      properties[name] = schema;
      required.push(name);
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  }

  private inferParameterSchema(params: Parameter[]): JsonSchema {
    const param = params[0];
    if (!param) {
      return { type: 'string' };
    }

    if (param.isSecret || param.inferredType === 'secret') {
      return {
        type: 'string',
        format: 'password',
        writeOnly: true,
        default: '',
      };
    }

    const allValues = params.map((p) => p.originalValue);
    const parsedValues = allValues.map((v) => this.tryParseJson(v));
    const allParsedArrays = parsedValues.every((v) => Array.isArray(v));
    const allParsedBooleans = parsedValues.every((v) => typeof v === 'boolean');
    const allParsedNumbers = parsedValues.every((v) => typeof v === 'number');

    if (allParsedArrays && parsedValues.length > 0) {
      const arrays = parsedValues as unknown[][];
      const allElements = arrays.flat();
      return this.inferArraySchema(allElements, param, arrays[0]);
    }

    if (allParsedBooleans) {
      return { type: 'boolean', default: parsedValues[0] };
    }

    if (allParsedNumbers) {
      const nums = parsedValues as number[];
      const allIntegers = nums.every((n) => Number.isInteger(n));
      return { type: allIntegers ? 'integer' : 'number', default: nums[0] };
    }

    const firstValue = allValues[0] ?? '';

    if (allValues.every((v) => /^(true|false)$/i.test(v))) {
      return { type: 'boolean', default: firstValue.toLowerCase() === 'true' };
    }

    if (allValues.every((v) => /^-?\d+$/.test(v))) {
      return { type: 'integer', default: parseInt(firstValue, 10) };
    }
    if (allValues.every((v) => /^-?\d+\.\d+$/.test(v))) {
      return { type: 'number', default: parseFloat(firstValue) };
    }

    const format = this.detectFormat(firstValue);
    const enumValues = this.detectEnum(allValues);

    const schema: JsonSchema = {
      type: 'string',
      default: param.suggestedDefault,
    };

    if (format) {
      schema.format = format;
    }

    if (enumValues) {
      schema.enum = enumValues;
    }

    return schema;
  }

  private inferArraySchema(
    allElements: unknown[],
    _param: Parameter,
    defaultArray: unknown[],
  ): JsonSchema {
    if (allElements.length === 0) {
      return { type: 'array', items: { type: 'string' }, default: defaultArray };
    }

    const firstElement = allElements[0];

    if (typeof firstElement === 'string') {
      const allStrings = allElements.every((item) => typeof item === 'string');
      if (allStrings) {
        const stringElements = allElements as string[];
        const enumValues = this.detectEnum(stringElements);
        const itemFormat = this.detectFormat(stringElements[0]);

        const items: JsonSchema = { type: 'string' };
        if (enumValues) {
          items.enum = enumValues;
        }
        if (itemFormat) {
          items.format = itemFormat;
        }

        return { type: 'array', items, default: defaultArray };
      }
    }

    if (typeof firstElement === 'number') {
      const allNumbers = allElements.every((item) => typeof item === 'number');
      if (allNumbers) {
        const allIntegers = allElements.every((item) => Number.isInteger(item as number));
        return {
          type: 'array',
          items: { type: allIntegers ? 'integer' : 'number' },
          default: defaultArray,
        };
      }
    }

    if (typeof firstElement === 'boolean') {
      const allBooleans = allElements.every((item) => typeof item === 'boolean');
      if (allBooleans) {
        return { type: 'array', items: { type: 'boolean' }, default: defaultArray };
      }
    }

    return { type: 'array', items: { type: 'string' }, default: defaultArray };
  }

  private detectFormat(value: string): string | undefined {
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) {
      return 'email';
    }
    if (/^https?:\/\/[^\s]+$/.test(value)) {
      return 'uri';
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      return 'date-time';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return 'date';
    }
    return undefined;
  }

  private detectEnum(values: string[]): string[] | undefined {
    const unique = [...new Set(values)];
    if (unique.length > 1 && unique.length <= 5) {
      return unique.sort();
    }
    return undefined;
  }

  private buildOutputsSchema(grouped: Map<string, Parameter[]>): JsonSchema {
    const properties: Record<string, JsonSchema> = {
      sessionId: {
        type: 'string',
        description: 'ID of the session spawned to execute the skill.',
      },
      mode: {
        type: 'string',
        enum: ['workflow_transfer', 'copilot', 'empty'],
        description: 'Execution mode taken by the session bootstrapper.',
      },
    };

    const required = ['sessionId', 'mode'];

    for (const [name, params] of grouped) {
      if (/output|result|response|return/i.test(name) && !params[0]?.isSecret) {
        const schema = this.inferParameterSchema(params);
        properties[name] = {
          ...schema,
          description: `Observed output parameter ${name}.`,
        };
        required.push(name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
