# Cepage Product Plan — Option C "Blended"

> **Design once on a canvas. Run anywhere — as commands, as APIs, as scheduled jobs.**

This directory contains the full product plan for the next phase of Cepage. It is the reference document for the "Option C — Blended" strategic direction: turn the existing Studio into a save-and-reuse workflow platform with a Library surface, a typed skill contract, an MCP server, SDKs, and reference integrations with OpenClaw, Hermes, Cursor, Claude Code, Codex, OpenCode.

---

## How to read this folder

| File | When to read | Who should read |
|---|---|---|
| [01-vision.md](./01-vision.md) | You want the narrative, positioning, taglines, moat | Everyone |
| [02-competitive-landscape.md](./02-competitive-landscape.md) | You want to know what exists in 2026 and where we fit | Product, marketing |
| [03-typed-skill-contract.md](./03-typed-skill-contract.md) | You want to understand THE technical pivot | Engineering |
| [04-architecture.md](./04-architecture.md) | You want the module map + data model | Engineering |
| [05-api-and-ux.md](./05-api-and-ux.md) | You want endpoints + screens + flows | Engineering, design |
| [06-distribution-and-integrations.md](./06-distribution-and-integrations.md) | You want MCP + SDK + CLI + external integrations | Engineering, DevRel |
| [07-roadmap.md](./07-roadmap.md) | You want phases, effort estimates, files to touch | Engineering, PM |
| [08-go-to-market.md](./08-go-to-market.md) | You want the 10k-stars plan | Marketing, founder |
| [09-risks-and-decisions.md](./09-risks-and-decisions.md) | You want the 6 decisions to make before coding | Founder, tech lead |
| [10-memory-and-auto-skill.md](./10-memory-and-auto-skill.md) | You want the deep-dive on memory, auto-skill, and why "recursion" is a mirage | Engineering, founder |

**Shortest path if you have 5 minutes**: read this README + [01-vision.md](./01-vision.md) + [03-typed-skill-contract.md](./03-typed-skill-contract.md).

---

## Executive summary

### Problem

Developers run multiple coding agents side by side (Cursor, Claude Code, Codex, OpenCode). The good multi-agent workflows they discover stay trapped in one-off conversations. There is no clean way to save a workflow, re-run it with different inputs, call it from code, or share it across a team.

### Promise

Cepage becomes the open-source, local-first, multi-agent workflow platform where:

1. You design workflows visually on an infinite canvas.
2. You save any workflow as a **typed skill** (JSON Schema inputs and outputs).
3. You run that skill from anywhere — your IDE via MCP, your code via SDK, your CI, or a scheduled job.

### Strategic direction

**Option C — Blended**. Build both a consumer UX (Library, command palette, forms) and a developer surface (SDK, CLI, MCP, OpenAPI), bound together by a single pivot concept: the **Typed Skill Contract**.

### The one concept you need to remember

**Typed Skill Contract** = add `inputsSchema` and `outputsSchema` (JSON Schema) to every skill in [`packages/shared-core/src/workflow-skill.ts`](../../packages/shared-core/src/workflow-skill.ts). From that single addition, you get for free (via codegen):

- Auto-generated React forms in the Library UI
- TypeScript SDK with typed skill methods
- Python SDK with Pydantic models
- OpenAPI spec per skill
- Runtime input/output validation
- MCP tool schema for Cursor/Claude Code/Codex/OpenCode
- Typed chaining between skills
- CLI argument parsing

One source, nine derivatives.

### Two surfaces, one engine

| Studio (existing) | Library (new) |
|---|---|
| "I prototype a workflow" | "I execute a known workflow" |
| Chat + canvas | Forms + runs + schedules |
| Like Google AI Studio, Cursor composer | Like Raycast, Copilot, Zapier, slash commands |
| Output: a saved skill | Output: runs with typed inputs |

### Unique moat

Among all competitors in 2026 (Dify, Flowise, Langflow, Vellum, OpenAI Agent Builder, Circuit, AgentBase, CodeGrid, Mastra, n8n, Gumloop, Lindy), **nobody combines all five**:

1. Visual canvas
2. Multi-vendor coding agents as first-class citizens
3. Save-as-typed-API with SDK codegen
4. Local-first (native daemon)
5. Open-source

Cepage owns this intersection if it ships phase 1 within the next 4-6 weeks.

### Roadmap in one sentence

- **Phase 1 (4-6 weeks)** — Typed Skill Contract + Save-as-skill + Library UI + run endpoint
- **Phase 2 (3-4 weeks)** — MCP server + SDK TS/Python + CLI + OpenClaw/Hermes/Cursor reference integrations
- **Phase 3 (ongoing)** — Chaining, marketplace, importers, templates

### Target metric

- **10k GitHub stars in 12 months**, driven by: phase 1 "Show HN" launch, phase 2 ProductHunt + MCP registry listing + coding-agent integrations, and weekly content.

---

## Status

| File | Owner | Last updated |
|---|---|---|
| README.md | — | creation |
| 01-vision.md | — | creation |
| 02-competitive-landscape.md | — | creation |
| 03-typed-skill-contract.md | — | creation |
| 04-architecture.md | — | creation |
| 05-api-and-ux.md | — | creation |
| 06-distribution-and-integrations.md | — | creation |
| 07-roadmap.md | — | creation |
| 08-go-to-market.md | — | creation |
| 09-risks-and-decisions.md | — | creation |

Update this table whenever a section is reviewed or revised.
