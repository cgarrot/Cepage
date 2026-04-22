# ADR-0001: Skill Compiler Pivot

## Status

**Accepted** — 2026-04-22

## Context

Cepage began as a **generic multi-agent orchestrator**: a visual canvas where humans design workflows by wiring together nodes that spawn real coding agents (Cursor, Claude Code, Codex, OpenCode). The original vision, documented in [01-vision.md](docs/product-plan/01-vision.md), positioned Cepage as the only open-source, local-first platform combining a visual canvas, multi-vendor coding agents, typed skill contracts, and MCP-native distribution.

By early 2026, the orchestrator market had saturated. Dify exceeded 100k stars, CrewAI reached 48k, and LangGraph hit 28k. More importantly, **orchestration was being solved natively** by the agents themselves: Cursor 2.0 introduced eight parallel agents, Claude Code added subagents, and OpenClaw (362k stars) became the dominant open-source orchestration framework. The five-column competitive moat described in [01-vision.md](docs/product-plan/01-vision.md) was eroding fast.

At the same time, a new discipline called **"harness engineering"** became mainstream (Hashimoto, OpenAI, Fowler, early 2026). The industry converged on the formula `Agent = Model + Harness`. But no tool addressed the fundamental waste: every successful agent session represented $5–50 of API spend and 5–30 minutes of human time that was **not captured, parameterized, or reused**. Data from the UC Berkeley MAST study (NeurIPS 2025) showed that 79% of multi-agent failures are coordination issues, but the hidden cost is that **every successful session is lost work**.

Cepage already possessed real technical assets: a graph engine (`packages/graph-core`), a daemon architecture (`apps/daemon`), agent adapters (`packages/agent-core`), a skill system with JSON Schema support ([03-typed-skill-contract.md](docs/product-plan/03-typed-skill-contract.md)), and a functional MCP server (`packages/mcp`). These assets could support a new direction without a rewrite.

The question was not whether to change, but **what to become**.

## Decision

Cepage pivots from **"generic multi-agent orchestrator"** to **"the skill compiler for coding agents"**.

A compiler transforms source code into an executable artifact. Cepage transforms an **agent session** into a **production-grade, typed skill** with parametric inputs, auto-generated tests, and cross-agent distribution via MCP.

### What stays

The Studio canvas remains a first-class surface. Humans can still design multi-agent workflows visually, with live execution streaming and human-in-the-loop approval nodes. The graph engine, the daemon, and the adapter contract are all preserved. See [01-vision.md](docs/product-plan/01-vision.md) and [04-architecture.md](docs/product-plan/04-architecture.md) for the original architecture.

### What changes

A second surface is added: the **Skill Compiler**. After a user finishes a session with their favorite agent, they explicitly send the session artifacts to Cepage. Cepage parses transcripts, diffs, and tool calls into a canonical execution graph, replaces concrete values with typed parameters, generates a validation suite, and packages the result for distribution via MCP, SDK, CLI, and OpenAPI.

The five compilation phases are:

1. **Capture** — User explicitly sends session artifacts (hook, export, or wrapper).
2. **Extract** — Parse artifacts into a canonical execution graph.
3. **Parameterize** — Replace concrete values with typed placeholders and infer JSON Schema.
4. **Validate** — Dry-run with mock LLM and check parametric coverage.
5. **Package & Distribute** — Emit MCP schema, TypeScript SDK, Python SDK, OpenAPI spec, and CLI command from a single source.

Both surfaces feed the same **typed skill library** and distribution layer. This dual-surface architecture is described in detail in [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md), §1.5.

### Governance rule

Every new feature must serve **at least one** of the two surfaces **and** the shared Library. Features serving only the Studio or only the Compiler are deferred to Phase 3.

### BYOA: Bring Your Own Agent

Cepage does not replace the agent. It compiles the agent's output. The user keeps their workflow, their prompts, and their tool chain. After a session, they explicitly capture it and send it to Cepage. Compilation is intentional, not automatic.

This philosophy is documented in [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md), §7.

### Explicit capture, not background observation

Cepage cannot watch proprietary agents in the background. Cursor stores sessions in a local SQLite database with a proprietary schema. Claude Code offers hooks, but they must be installed by the user. Agents run in sandboxes. External tools cannot intercept their internals.

Capture is therefore **explicit**: hooks for Claude Code, export/import for Cursor, and wrapper execution for OpenCode. This model is described in [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md), §7, and [06-distribution-and-integrations.md](docs/product-plan/06-distribution-and-integrations.md).

### Deviation: "Cursor + OpenCode first" instead of "Claude Code MVP"

The pivot document [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md) explicitly recommends **Claude Code as the MVP agent** because its native `SessionEnd` hooks make capture the easiest and most reliable integration. However, the implementation plan deviates to **Cursor + OpenCode first**.

**Rationale for the deviation:**

1. **Existing adapter maturity.** OpenCode already has a functional adapter (`packages/agent-core/src/opencode-run.ts`) with SDK integration, SSE streaming, and session reuse. Cursor already has a CLI wrapper (`packages/agent-core/src/cursor-agent.ts`). Claude Code has only an enum entry in the adapter schema with no implementation.

2. **Team familiarity.** The current codebase has been tested end-to-end with OpenCode and Cursor. Building on known foundations reduces Phase 1 risk.

3. **Claude Code hook uncertainty.** The hook mechanism (`~/.claude/hooks/cepage-compile.sh`) is documented in [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md) but unvalidated. Building the entire Phase 1 gate on an unvalidated capture mechanism is a single point of failure.

4. **Cursor market share.** Cursor 2.0 is the most widely adopted coding agent among the target audience. A Cursor integration delivers more beta-user value than a Claude Code integration in the same timeframe.

5. **Parallel track.** Claude Code hooks are not abandoned. They are moved to a **parallel validation track** in Phase 1 (Week 1-2) alongside the Cursor SQLite parser. If hooks validate cleanly, Claude Code is promoted to a first-class surface in Phase 1 Week 7-8.

This deviation is recorded in the decision log below.

## Consequences

### Positive

- **New defensible niche.** No competitor compiles agent sessions into typed, tested, versioned skills. The orchestrator+compiler combination is unique.
- **Preserves existing assets.** The graph engine, daemon, adapters, and skill system are all reused. No rewrite is required.
- **Economic value.** Compilation reduces the marginal cost of reuse by 10–30x. A $12 exploration session becomes a $0.45 skill run.
- **Cross-agent distribution.** Via MCP, a skill compiled from a Cursor session runs in Claude Code, Codex, or OpenCode.
- **Data flywheel.** More sessions lead to better extraction, which leads to better compilation, which leads to more skills, which attracts more users. This loop is described in [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md), §13.

### Negative

- **Dual surface complexity.** Two input surfaces (Studio + Compiler) risk product confusion. The UI and documentation must maintain clear separation.
- **Capture friction.** Explicit capture requires user action. If friction is too high, the compiler surface fails regardless of technical quality.
- **Session extraction fragility.** Cursor's SQLite schema can change without notice. Claude hooks can break. The Studio canvas remains the credible fallback when capture fails.
- **Scope expansion.** Phase 1 grows from a Studio/Library build to a Studio/Library + Compiler build. The 8-week timeline assumes 2–3 engineers.
- **Competitive response risk.** Cursor could add native skill saving. OpenClaw could add typed compilation. Speed of shipping is the mitigation.

## Alternatives Considered

### 1. Stay the course (orchestrator only)

**Rejected.** The orchestrator market is saturated. Cursor 2.0, OpenClaw, and Claude Code subagents solve orchestration natively. Cepage's Studio canvas is a moat, but orchestration alone is no longer defensible. See competitive analysis in [02-competitive-landscape.md](docs/product-plan/02-competitive-landscape.md).

### 2. Replace the Studio with the Compiler

**Rejected.** The Studio canvas offers unique value: live multi-agent streaming, human-in-the-loop approval nodes, and a visual surface no competitor owns. Deprecating it would waste a built asset and remove the fallback when external session capture fails. See rationale in [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md), §1.5.

### 3. Build a new coding agent

**Rejected.** Cepage is not a model provider and does not compete with Cursor, Claude Code, or Codex. The value is in compiling agent output, not generating it. This is an explicit anti-goal in [01-vision.md](docs/product-plan/01-vision.md).

### 4. Background observation (passive capture)

**Rejected.** Proprietary agents cannot be observed externally. Cursor's SQLite database is local and proprietary. Claude Code has no public API for session inspection. Sandboxed agents isolate their internals. Explicit capture is the only technically feasible model. See [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md), §7.

### 5. Claude Code as sole MVP agent

**Considered and modified.** The pivot document recommends Claude Code as the MVP priority due to native hooks. The implementation plan deviates to Cursor + OpenCode first for the reasons documented in the "Deviation" section above. Claude Code remains a parallel validation track and is promoted if hooks validate cleanly.

## References

- [01-vision.md](docs/product-plan/01-vision.md) — Original vision, positioning, and five-column moat.
- [02-competitive-landscape.md](docs/product-plan/02-competitive-landscape.md) — Competitive analysis showing orchestrator saturation.
- [03-typed-skill-contract.md](docs/product-plan/03-typed-skill-contract.md) — The technical pivot: JSON Schema inputs/outputs and the nine derivatives.
- [04-architecture.md](docs/product-plan/04-architecture.md) — Module map and data model.
- [05-api-and-ux.md](docs/product-plan/05-api-and-ux.md) — Endpoints, screens, and flows.
- [06-distribution-and-integrations.md](docs/product-plan/06-distribution-and-integrations.md) — MCP, SDK, CLI, and external integrations.
- [07-roadmap.md](docs/product-plan/07-roadmap.md) — Phases, effort estimates, and files to touch.
- [08-go-to-market.md](docs/product-plan/08-go-to-market.md) — Launch strategy and narrative.
- [09-risks-and-decisions.md](docs/product-plan/09-risks-and-decisions.md) — Risks and pre-coding decisions.
- [10-memory-and-auto-skill.md](docs/product-plan/10-memory-and-auto-skill.md) — Memory, auto-skill, and recursion analysis.
- [11-harness-layer-pivot.md](docs/product-plan/11-harness-layer-pivot.md) — The full pivot document: skill compiler definition, dual surface, BYOA, unit economics, phased roadmap, and decision log.
- [AGENTS.md](AGENTS.md) — Monorepo architecture, daemon lifecycle, and adapter contract.

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-22 | Pivot from "generic multi-agent orchestrator" to "skill compiler for coding agents" | Orchestration is being solved natively by agents (Cursor 2.0, OpenClaw, Claude Code subagents). The unsolved gap is turning successful sessions into reusable, typed, tested skills. |
| 2026-04-22 | Dual surface: Studio canvas + Skill Compiler | The Studio canvas is retained as a first-class surface alongside the new Compiler. Both feed the same typed skill library. Rationale: (1) external capture is fragile, (2) the canvas is a unique moat no competitor owns, (3) the graph engine is already built, (4) some workflows require native human-in-the-loop that cannot be inferred from an external session. |
| 2026-04-22 | Governance rule: one feature, two surfaces | Every new feature must serve at least one surface AND the shared Library. Features serving only one surface are deferred to Phase 3. This prevents scope creep. |
| 2026-04-22 | BYOA (Bring Your Own Agent) | Users want to keep their preferred agent. Cepage augments, not replaces. |
| 2026-04-22 | Explicit capture, not passive observation | Agents are proprietary or sandboxed. Real-time observation is technically impossible for Cursor and Claude Code without user-installed hooks. Compilation requires explicit user action. |
| 2026-04-22 | MCP as primary distribution mechanism | Cursor, Claude Code, Codex, and OpenCode all support MCP. One integration equals all agents can run compiled skills. |
| 2026-04-22 | Acknowledge "harness engineering" as existing discipline | Hashimoto, OpenAI, and Fowler coined the term in early 2026. Claiming it as our own would damage credibility. Cepage implements harness engineering focused on compilation. |
| 2026-04-22 | Deviation: Cursor + OpenCode first, Claude Code parallel | The pivot document recommends Claude Code as MVP due to native hooks. The implementation deviates because: (1) OpenCode and Cursor adapters already exist and are tested, (2) Claude Code hooks are unvalidated, (3) Cursor has the largest market share among the target audience, (4) building Phase 1 on an unvalidated capture mechanism is high risk. Claude Code hooks remain a parallel validation track and are promoted if they prove reliable. |
| 2026-04-22 | Phase 1 scope: 8 weeks, 2–3 engineers | The compilation pipeline is a product effort, not a small gap. Complex features (auto-mining, security pipeline, advanced parameterization) are deferred to Phases 2–4. |
| 2026-04-22 | Kill criteria defined | If "would use" rate < 50% after Phase 1, stop. If dry-run pass rate < 50%, reduce scope to simpler parameterization. |
