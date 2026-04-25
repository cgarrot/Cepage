import { Injectable } from '@nestjs/common';
import type { WorkflowSkill } from '@cepage/shared-core';
import { WorkflowSkillsService } from '../workflow-skills/workflow-skills.service';

// Dynamic OpenAPI document generator for Cepage.
//
// Why hand-written and not `@nestjs/swagger`? Two reasons:
//   1. The typed-skill contract is the heart of the public API. A single
//      Cepage instance can host hundreds of skills — each with its own
//      inputs/outputs JSON Schema. We want those schemas to show up as
//      _typed_ paths (`/api/v1/skills/weekly-stripe-report/runs` with
//      `WeeklyStripeReportInputs` as its requestBody schema) so the
//      generated TS and Python SDKs can emit typed accessors.
//   2. `@nestjs/swagger` would force us to annotate every controller and
//      DTO. For a Phase 1/2 rollout with 10+ modules, that churn is not
//      worth it; the endpoints we care about SDK-wise are the skill
//      catalog, skill runs, sessions, and schedules — all of which fit
//      in one small, centrally-maintained module.
//
// The resulting document:
//   - Core paths (handwritten): catalog, runs, scheduled runs, sessions.
//   - Typed paths (generated):  one POST /skills/{slug}/runs per skill in
//                               the catalog, with inputsSchema/outputsSchema
//                               inlined.
//   - Components.schemas:       SkillRun, SkillRunError, UserSkill, and
//                               one `<Slug>Inputs` / `<Slug>Outputs` pair
//                               per skill.
//
// See docs/product-plan/06-distribution-and-integrations.md.

type OpenApiDocument = Record<string, unknown>;

@Injectable()
export class OpenapiService {
  constructor(private readonly catalog: WorkflowSkillsService) {}

  async buildDocument(): Promise<OpenApiDocument> {
    const skills = await this.loadSkills();
    return {
      openapi: '3.1.0',
      info: {
        title: 'Cepage',
        version: '0.1.0',
        description:
          'HTTP API exposing the Cepage typed-skill library: list catalog, run skills, manage schedules, and author new skills from sessions.',
      },
      servers: [
        { url: '/api/v1', description: 'Relative path under the Cepage HTTP server.' },
      ],
      tags: [
        { name: 'skills', description: 'Skill catalog and per-skill runs.' },
        { name: 'skill-runs', description: 'Skill run records and SSE stream.' },
        { name: 'schedules', description: 'Scheduled skill runs (cron).' },
        { name: 'sessions', description: 'Session authoring and save-as-skill.' },
        { name: 'webhooks', description: 'Outbound HMAC-signed webhook subscriptions.' },
        { name: 'skill-compiler', description: 'Compile sessions into reusable skills and validate them.' },
      ],
      paths: {
        ...this.coreSkillCatalogPaths(),
        ...this.coreRunPaths(),
        ...this.schedulePaths(),
        ...this.authoringPaths(),
        ...this.webhookPaths(),
        ...this.compilerPaths(),
        ...this.typedSkillPaths(skills),
      },
      components: {
        schemas: {
          ...this.coreComponentSchemas(),
          ...this.typedSkillSchemas(skills),
        },
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Optional for now. In Phase 3 the `local-user` shim is retired and a real Bearer token is required.',
          },
        },
      },
      security: [{ bearerAuth: [] }, {}],
    };
  }

  private async loadSkills(): Promise<WorkflowSkill[]> {
    try {
      const catalog = await this.catalog.getCatalog();
      return catalog.skills ?? [];
    } catch {
      return [];
    }
  }

  // ─── core paths (handwritten) ────────────────────────────────────────

  private coreSkillCatalogPaths(): Record<string, unknown> {
    return {
      '/workflow-skills': {
        get: {
          tags: ['skills'],
          summary: 'List all skills (filesystem + DB merged).',
          responses: {
            '200': {
              description: 'Catalog.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { type: 'array', items: { $ref: '#/components/schemas/WorkflowSkill' } },
                      {
                        type: 'object',
                        properties: {
                          skills: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/WorkflowSkill' },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      '/workflow-skills/{slug}': {
        get: {
          tags: ['skills'],
          summary: 'Fetch a single skill by slug.',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Skill.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WorkflowSkill' },
                },
              },
            },
            '404': { description: 'Skill not found.' },
          },
        },
      },
      '/skills': {
        get: {
          tags: ['skills'],
          summary: 'List DB-backed user skills only.',
          responses: {
            '200': {
              description: 'User skills.',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/UserSkill' },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['skills'],
          summary: 'Create a user skill directly (advanced).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateUserSkillBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserSkill' },
                },
              },
            },
          },
        },
      },
      '/skills/{slug}': {
        get: {
          tags: ['skills'],
          summary: 'Fetch a user skill by slug.',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'User skill.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserSkill' },
                },
              },
            },
          },
        },
      },
    };
  }

  private coreRunPaths(): Record<string, unknown> {
    return {
      '/skill-runs': {
        get: {
          tags: ['skill-runs'],
          summary: 'List skill runs.',
          parameters: [
            { name: 'skillId', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          ],
          responses: {
            '200': {
              description: 'Runs.',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/SkillRun' } },
                },
              },
            },
          },
        },
      },
      '/skill-runs/{runId}': {
        get: {
          tags: ['skill-runs'],
          summary: 'Fetch a skill run by id.',
          parameters: [
            { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Skill run.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SkillRun' },
                },
              },
            },
          },
        },
      },
      '/skill-runs/{runId}/cancel': {
        post: {
          tags: ['skill-runs'],
          summary: 'Cancel a queued or running skill run.',
          parameters: [
            { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Updated run.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SkillRun' },
                },
              },
            },
          },
        },
      },
      '/skill-runs/{runId}/stream': {
        get: {
          tags: ['skill-runs'],
          summary: 'SSE stream of lifecycle events for a run.',
          parameters: [
            { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description:
                'text/event-stream — events: snapshot, started, progress, succeeded, failed, cancelled.',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };
  }

  private schedulePaths(): Record<string, unknown> {
    return {
      '/scheduled-skill-runs': {
        get: {
          tags: ['schedules'],
          summary: 'List scheduled skill runs.',
          responses: {
            '200': {
              description: 'Schedules.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ScheduledSkillRun' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['schedules'],
          summary: 'Create a scheduled skill run.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateScheduledSkillRunBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ScheduledSkillRun' },
                },
              },
            },
          },
        },
      },
      '/scheduled-skill-runs/{id}': {
        get: {
          tags: ['schedules'],
          summary: 'Fetch a schedule by id.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Schedule.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ScheduledSkillRun' },
                },
              },
            },
          },
        },
        patch: {
          tags: ['schedules'],
          summary: 'Update a schedule.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                  description: 'Partial schedule update.',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated schedule.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ScheduledSkillRun' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['schedules'],
          summary: 'Delete a schedule.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted.' } },
        },
      },
      '/scheduled-skill-runs/{id}/run-now': {
        post: {
          tags: ['schedules'],
          summary: 'Fire a schedule immediately.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Run scaffolded.' } },
        },
      },
    };
  }

  private authoringPaths(): Record<string, unknown> {
    return {
      '/sessions/{id}/detect-inputs': {
        post: {
          tags: ['sessions'],
          summary: "Infer a JSON Schema from a session's prompt nodes.",
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Detection result.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DetectInputsResult' },
                },
              },
            },
          },
        },
      },
      '/sessions/{id}/save-as-skill': {
        post: {
          tags: ['sessions'],
          summary: 'Persist a session as a reusable user skill.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SaveAsSkillBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created user skill.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserSkill' },
                },
              },
            },
          },
        },
      },
    };
  }

  private webhookPaths(): Record<string, unknown> {
    return {
      '/webhooks': {
        get: {
          tags: ['webhooks'],
          summary: 'List webhook subscriptions (secrets redacted).',
          responses: {
            '200': {
              description: 'Subscriptions.',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Webhook' },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['webhooks'],
          summary: 'Create a webhook subscription. Returns the plaintext secret exactly once.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateWebhookBody' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Subscription (with `secret` revealed one time).',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookWithSecret' },
                },
              },
            },
          },
        },
      },
      '/webhooks/{id}': {
        get: {
          tags: ['webhooks'],
          summary: 'Fetch a webhook subscription by id.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Subscription.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Webhook' },
                },
              },
            },
          },
        },
        patch: {
          tags: ['webhooks'],
          summary: 'Update a webhook subscription (supports secret rotation).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateWebhookBody' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated subscription. The `secret` field is only present when `secretAction=rotate` was requested.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookWithSecret' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['webhooks'],
          summary: 'Delete a webhook subscription.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted.' } },
        },
      },
      '/webhooks/{id}/ping': {
        post: {
          tags: ['webhooks'],
          summary: 'Fire a `webhook.ping` event synchronously to validate the subscription.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Delivery outcome.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookPingResult' },
                },
              },
            },
          },
        },
      },
      '/webhooks/{id}/rotate-secret': {
        post: {
          tags: ['webhooks'],
          summary: 'Rotate the subscription secret. The new plaintext value is returned exactly once.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Subscription with the new `secret`.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookWithSecret' },
                },
              },
            },
          },
        },
      },
    };
  }

  private compilerPaths(): Record<string, unknown> {
    return {
      '/skill-compiler/dry-run': {
        post: {
          tags: ['skill-compiler'],
          summary: 'Validate a skill against inputs without executing it.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DryRunBody' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Dry-run report.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DryRunResult' },
                },
              },
            },
            '404': { description: 'Skill not found.' },
          },
        },
      },
      '/skill-compiler/sessions/{sessionId}/preview': {
        get: {
          tags: ['skill-compiler'],
          summary: 'Preview a compilation without persisting.',
          parameters: [
            { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'agentType',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['opencode', 'cursor_agent', 'claude_code'],
                default: 'opencode',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Compilation preview.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CompilationPreview' },
                },
              },
            },
          },
        },
      },
    };
  }

  // ─── typed per-skill paths ───────────────────────────────────────────

  private typedSkillPaths(skills: WorkflowSkill[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const skill of skills) {
      const inputsRef = `#/components/schemas/${pascalCase(skill.id)}Inputs`;
      const outputsRef = `#/components/schemas/${pascalCase(skill.id)}Outputs`;
      const path = `/skills/${skill.id}/runs`;
      out[path] = {
        post: {
          tags: ['skills'],
          operationId: `run_${toCamelCase(skill.id)}`,
          summary: `${skill.title} — ${skill.summary ?? ''}`.trim(),
          parameters: [
            {
              name: 'wait',
              in: 'query',
              schema: { type: 'boolean', default: true },
              description: 'Block until the run completes.',
            },
            {
              name: 'timeoutMs',
              in: 'query',
              schema: { type: 'integer', minimum: 1000, maximum: 1_800_000 },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['inputs'],
                  properties: {
                    inputs: { $ref: inputsRef },
                    idempotencyKey: { type: 'string' },
                    correlationId: { type: 'string' },
                    triggeredBy: {
                      type: 'string',
                      enum: ['api', 'ui', 'cli', 'mcp', 'schedule', 'webhook', 'sdk'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Skill run record.',
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { $ref: '#/components/schemas/SkillRun' },
                      {
                        type: 'object',
                        properties: {
                          outputs: {
                            oneOf: [{ $ref: outputsRef }, { type: 'null' }],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            '400': {
              description: 'Input validation failed.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SkillRunValidationFailure' },
                },
              },
            },
          },
        },
      };
    }
    return out;
  }

  private typedSkillSchemas(skills: WorkflowSkill[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const skill of skills) {
      out[`${pascalCase(skill.id)}Inputs`] = skill.inputsSchema ?? {
        type: 'object',
        description: 'No typed inputs declared for this skill.',
        additionalProperties: true,
      };
      out[`${pascalCase(skill.id)}Outputs`] = skill.outputsSchema ?? {
        type: 'object',
        description: 'No typed outputs declared for this skill.',
        additionalProperties: true,
      };
    }
    return out;
  }

  // ─── component schemas (static) ──────────────────────────────────────

  private coreComponentSchemas(): Record<string, unknown> {
    return {
      WorkflowSkill: {
        type: 'object',
        required: ['id', 'title', 'summary', 'version', 'kind'],
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          kind: { type: 'string' },
          category: { type: 'string', nullable: true },
          icon: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          inputsSchema: { type: 'object', additionalProperties: true },
          outputsSchema: { type: 'object', additionalProperties: true },
          execution: { type: 'object', additionalProperties: true, nullable: true },
          source: { type: 'object', additionalProperties: true, nullable: true },
        },
      },
      UserSkill: {
        type: 'object',
        required: ['id', 'slug', 'title', 'summary', 'inputsSchema', 'outputsSchema'],
        properties: {
          id: { type: 'string' },
          slug: { type: 'string' },
          version: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          icon: { type: 'string', nullable: true },
          category: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          inputsSchema: { type: 'object', additionalProperties: true },
          outputsSchema: { type: 'object', additionalProperties: true },
          kind: { type: 'string' },
          promptText: { type: 'string', nullable: true },
          sourceSessionId: { type: 'string', nullable: true },
          visibility: { type: 'string', enum: ['private', 'workspace', 'public'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateUserSkillBody: {
        type: 'object',
        required: ['title', 'summary', 'inputsSchema', 'outputsSchema'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          icon: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          inputsSchema: { type: 'object' },
          outputsSchema: { type: 'object' },
          kind: { type: 'string' },
          promptText: { type: 'string' },
          sourceSessionId: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'workspace', 'public'] },
        },
      },
      SkillRun: {
        type: 'object',
        required: ['id', 'skillId', 'status', 'inputs', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string' },
          skillId: { type: 'string' },
          skillVersion: { type: 'string' },
          skillKind: { type: 'string' },
          userSkillId: { type: 'string', nullable: true },
          status: {
            type: 'string',
            enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
          },
          inputs: { type: 'object', additionalProperties: true },
          outputs: { type: 'object', additionalProperties: true, nullable: true },
          error: {
            nullable: true,
            oneOf: [{ type: 'null' }, { $ref: '#/components/schemas/SkillRunError' }],
          },
          sessionId: { type: 'string', nullable: true },
          triggeredBy: { type: 'string' },
          idempotencyKey: { type: 'string', nullable: true },
          correlationId: { type: 'string', nullable: true },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          finishedAt: { type: 'string', format: 'date-time', nullable: true },
          durationMs: { type: 'integer', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SkillRunError: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: {},
        },
      },
      SkillRunValidationFailure: {
        type: 'object',
        required: ['code', 'errors'],
        properties: {
          code: { type: 'string', enum: ['INVALID_INPUT'] },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['path', 'message'],
              properties: {
                path: { type: 'string' },
                message: { type: 'string' },
                keyword: { type: 'string' },
                params: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      ScheduledSkillRun: {
        type: 'object',
        required: ['id', 'skillId', 'cron', 'request', 'status', 'nextRunAt'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string', nullable: true },
          skillId: { type: 'string' },
          cron: { type: 'string' },
          request: { type: 'object', additionalProperties: true },
          status: { type: 'string', enum: ['active', 'paused'] },
          nextRunAt: { type: 'string', format: 'date-time' },
          lastRunAt: { type: 'string', format: 'date-time', nullable: true },
          lastSessionId: { type: 'string', nullable: true },
          lastError: { type: 'string', nullable: true },
          metadata: { type: 'object', additionalProperties: true, nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateScheduledSkillRunBody: {
        type: 'object',
        required: ['skillId', 'cron', 'request'],
        properties: {
          label: { type: 'string' },
          skillId: { type: 'string' },
          cron: { type: 'string' },
          request: { type: 'object', additionalProperties: true },
          status: { type: 'string', enum: ['active', 'paused'] },
          metadata: { type: 'object', additionalProperties: true, nullable: true },
        },
      },
      DetectInputsResult: {
        type: 'object',
        required: ['sessionId', 'detected', 'inputsSchema', 'outputsSchema'],
        properties: {
          sessionId: { type: 'string' },
          detected: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'occurrences', 'inferredType'],
              properties: {
                name: { type: 'string' },
                occurrences: { type: 'integer' },
                inferredType: { type: 'string' },
                hint: { type: 'string' },
              },
            },
          },
          inputsSchema: { type: 'object', additionalProperties: true },
          outputsSchema: { type: 'object', additionalProperties: true },
          promptText: { type: 'string', nullable: true },
        },
      },
      SaveAsSkillBody: {
        type: 'object',
        required: ['title', 'summary'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          icon: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          inputsSchema: { type: 'object' },
          outputsSchema: { type: 'object' },
          visibility: { type: 'string', enum: ['private', 'workspace', 'public'] },
        },
      },
      Webhook: {
        type: 'object',
        required: ['id', 'url', 'events', 'active', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: {
            type: 'array',
            items: {
              type: 'string',
              description:
                'One of: skill-run.started, skill-run.succeeded, skill-run.failed, skill-run.cancelled, skill-run.progress, webhook.ping, or "*" for all.',
            },
          },
          skillId: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          description: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      WebhookWithSecret: {
        allOf: [
          { $ref: '#/components/schemas/Webhook' },
          {
            type: 'object',
            properties: {
              secret: {
                type: 'string',
                description:
                  'Plaintext HMAC secret. Surfaced exactly once on `create` or when `secretAction=rotate` is passed to `PATCH`.',
              },
            },
          },
        ],
      },
      CreateWebhookBody: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          secret: { type: 'string', minLength: 8 },
          events: { type: 'array', items: { type: 'string' } },
          skillId: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          description: { type: 'string' },
        },
      },
      UpdateWebhookBody: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          skillId: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          description: { type: 'string', nullable: true },
          secretAction: { type: 'string', enum: ['rotate', 'keep'] },
        },
      },
      WebhookPingResult: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id: { type: 'string', description: 'Server-generated deliveryId for the ping event.' },
          status: { type: 'string', enum: ['delivered', 'failed'] },
          httpStatus: { type: 'integer', nullable: true },
        },
      },
      DryRunBody: {
        type: 'object',
        required: ['skillId', 'inputs'],
        properties: {
          skillId: { type: 'string' },
          inputs: { type: 'object', additionalProperties: true },
          mode: { type: 'string', enum: ['strict', 'permissive'] },
        },
      },
      DryRunResult: {
        type: 'object',
        required: ['overall', 'checks', 'warnings', 'errors', 'estimatedCost'],
        properties: {
          overall: { type: 'string', enum: ['PASS', 'FAIL'] },
          checks: {
            type: 'object',
            required: ['parametric', 'schema', 'graph'],
            properties: {
              parametric: { type: 'string', enum: ['PASS', 'FAIL'] },
              schema: { type: 'string', enum: ['PASS', 'FAIL'] },
              graph: { type: 'string', enum: ['PASS', 'FAIL'] },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['check', 'message'],
              properties: {
                check: { type: 'string' },
                field: { type: 'string', nullable: true },
                message: { type: 'string' },
              },
            },
          },
          estimatedCost: { type: 'number' },
        },
      },
      CompilationPreview: {
        type: 'object',
        required: ['skill', 'report'],
        properties: {
          skill: { type: 'object', additionalProperties: true },
          report: {
            type: 'object',
            required: ['parameters', 'estimatedCost', 'graphStats', 'warnings'],
            properties: {
              parameters: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'occurrences', 'inferredType'],
                  properties: {
                    name: { type: 'string' },
                    occurrences: { type: 'integer' },
                    inferredType: { type: 'string' },
                    hint: { type: 'string', nullable: true },
                  },
                },
              },
              estimatedCost: { type: 'number' },
              graphStats: {
                type: 'object',
                required: ['nodes', 'edges'],
                properties: {
                  nodes: { type: 'integer' },
                  edges: { type: 'integer' },
                },
              },
              warnings: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

export function pascalCase(raw: string): string {
  return raw
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join('');
}

export function toCamelCase(raw: string): string {
  const p = pascalCase(raw);
  if (!p) return p;
  return p.charAt(0).toLowerCase() + p.slice(1);
}
