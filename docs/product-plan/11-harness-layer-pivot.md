# Cepage — The Skill Compiler

> **Your agent builds features. Cepage compiles them into reusable systems.**

**Date**: 2026-04-22  
**Status**: Strategic pivot — research complete, implementation started  
**Owner**: Cepage Core Team  
**Classification**: Internal — pre-launch

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Dual Surface — Studio Canvas + Skill Compiler](#15-dual-surface--studio-canvas--skill-compiler)
3. [State of the Art — Why "Harness" Became Mainstream](#2-state-of-the-art--why-harness-became-mainstream)
3. [The Problem — Why One-Off Agent Sessions Don't Scale](#3-the-problem--why-one-off-agent-sessions-dont-scale)
4. [The Solution — Cepage as the Skill Compiler](#4-the-solution--cepage-as-the-skill-compiler)
5. [Positionnement & Narrative](#5-positionnement--narrative)
6. [Architecture Technique](#6-architecture-technique)
7. [Intégration BYOA — Bring Your Own Agent](#7-intégration-byoa--bring-your-own-agent)
8. [User Journey — The Skill Compiler in Action](#8-user-journey--the-skill-compiler-in-action)
9. [Unit Economics & Operating Modes](#9-unit-economics--operating-modes)
10. [Roadmap Phasée](#10-roadmap-phasée)
11. [Métriques & Gates](#11-métriques--gates)
12. [Risques & Mitigations](#12-risques--mitigations)
13. [Analyse Concurrentielle](#13-analyse-concurrentielle)
14. [Appendices](#14-appendices)

---

## 1. Executive Summary

### The Decision

Cepage pivots from **"generic multi-agent orchestrator"** to **"the skill compiler for coding agents"**.

**What this means concretely:**
- **New:** Your favorite agent (Cursor, Claude Code, Codex, OpenCode) runs a complex task. You explicitly send the session to Cepage. Cepage extracts the workflow graph, replaces concrete values with parameters, generates tests, and emits a typed, reusable skill.
- **Still true:** The Studio canvas remains a first-class surface for designing multi-agent workflows visually, with human-in-the-loop approval nodes and live execution streaming. See [§1.5](#15-dual-surface--studio-canvas--skill-compiler) for the relationship between the two surfaces.

The Skill Compiler is an **additional** surface, not a replacement. Both feed into the same typed skill library and distribution layer.

**Critical clarification:** Cepage does **not** magically watch your agent in the background. Agents are sandboxed or proprietary. Cepage compiles what you explicitly feed it — via hooks, session exports, or running the agent through Cepage.

**Why this pivot:**
1. The orchestrator market is saturated (Dify 100k+⭐, CrewAI 48k⭐, LangGraph 28k⭐).
2. **Orchestration is being solved natively** by Cursor 2.0 (8 parallel agents), Claude Code (subagents), and OpenClaw (362k⭐ orchestration framework). Cepage's Studio canvas still offers unique value (live multi-agent streaming, human-in-the-loop), but orchestration alone is no longer a defensible moat.
3. **The gap no one fills:** Turning a one-off agent session into a reusable, tested, versioned skill with typed inputs/outputs.
4. Cepage already has real foundations (graph engine, adapters, daemon, skill system, MCP server). The compilation pipeline itself must be built.
5. Data shows that **79% of multi-agent failures are coordination issues** (UC Berkeley MAST, 2025), but the bigger unsolved problem is that **every successful session is lost work**.

### The Unique Niche

> **Cepage is the only tool that compiles an agent session into a production-grade, typed skill — complete with parametric inputs, auto-generated tests, and cross-agent distribution via MCP.**

**Official tagline:**
> *Your agent builds features. Cepage compiles them into reusable systems.*

**Taglines by audience (Skill Compiler):**

| Audience | Tagline |
|---|---|
| Dev solo / vibe coder | "Ship the same feature 10x without rebuilding from scratch." |
| Team lead / startup | "Turn any successful agent session into a reusable, auditable workflow." |
| Agent builder | "The compiler your agent needs for production-grade reusability." |
| Tweet / HN | "Cursor builds functions. Cepage compiles them into systems." |

---

## 1.5 Dual Surface — Studio Canvas + Skill Compiler

Cepage operates through **two input surfaces** that converge on the same typed skill library and distribution layer. This document (11) introduces the Skill Compiler; it does not replace the Studio canvas described in [01–10](README.md).

| Dimension | Studio Canvas (Option C) | Skill Compiler (this doc) |
|---|---|---|
| **Who creates the workflow?** | Human designer on the canvas | External agent (Cursor, Claude, Codex, OpenCode) |
| **Input to system** | Native `GraphNode`/`GraphEdge` model | Session artifacts (JSONL, SQLite export, SSE logs) |
| **Human-in-the-loop** | Native — approval nodes, edit mid-run, pause/resume | Post-hoc review before compilation |
| **Use case** | Complex orchestration with multiple agents and checkpoints | Reuse of a successful one-off agent session |
| **Output** | `UserSkill` with `inputsSchema`/`outputsSchema` | `UserSkill` with `inputsSchema`/`outputsSchema` |
| **Distribution** | MCP, SDK, CLI, Library, OpenAPI | MCP, SDK, CLI, Library, OpenAPI |

**Governance rule:** Every feature must serve **at least one** of the two surfaces AND the shared Library. If a feature serves only the Studio without benefiting the Compiler (or vice versa), it is deferred to Phase 3.

**Why keep both?**
1. External session capture is fragile (Cursor's SQLite schema changes, Claude hooks can break, OpenCode is monolithic). The Studio is the credible fallback when capture fails.
2. The visual canvas with live agent streaming is a moat no competitor owns (Dify has canvas but no compilation; OpenClaw has orchestration but no canvas; Cursor has agents but no visual surface).
3. The graph engine (`packages/graph-core`) is already built. Deprecating it would waste a real technical asset.
4. Some workflows require native human-in-the-loop (approval nodes, conditional branches) that cannot be inferred from an external agent session.

**What changes from 01–10:**
- The Studio is no longer the *only* primary surface. It is one of two equal entry points.
- The roadmap in §10 is *extended* (not replaced) to include the compilation pipeline alongside the Studio/Library UI.
- The competitive positioning shifts from "orchestrator vs. orchestrator" to "orchestrator + compiler vs. everyone else".

| Audience | Tagline |
|---|---|
| Dev solo / vibe coder | "Ship the same feature 10x without rebuilding from scratch." |
| Team lead / startup | "Turn any successful agent session into a reusable, auditable workflow." |
| Agent builder | "The compiler your agent needs for production-grade reusability." |
| Tweet / HN | "Cursor builds functions. Cepage compiles them into systems." |

---

## 2. State of the Art — Why "Harness" Became Mainstream

### We Did Not Invent the Harness

The term **"harness engineering"** became mainstream in early 2026. We must acknowledge this explicitly — claiming it as our own would damage credibility.

| Date | Source | Contribution |
|------|--------|------------|
| Feb 2026 | Mitchell Hashimoto (HashiCorp) | Coined "Engineer the Harness" in his AI adoption journey |
| Feb 2026 | OpenAI (Ryan Lopopolo) | Published *"Harness engineering: leveraging Codex in an agent-first world"* — 1M+ lines of agent-generated code |
| Feb 2026 | Martin Fowler / Birgitta Böckeler | Published *"Harness engineering for coding agent users"* — the canonical reference |
| Mar 2026 | LangChain | Demonstrated harness changes moved their coding agent from Top 30 to Top 5 on Terminal Bench 2.0 |
| Mar 2026 | HumanLayer, Augment Code, ComputeLeap | Industry-wide adoption of the term |

The formula is now universal:

```
Agent = Model + Harness
```

**What Cepage adds:** We are not "the harness layer." We are **a specialized implementation** of harness engineering focused on one thing nobody else does — **compiling agent sessions into reusable skills**.

### What the industry already solves (and where we differentiate)

| Problem | Who solves it | How | Cepage's take |
|---------|--------------|-----|---------------|
| Multi-agent orchestration | Cursor 2.0, OpenClaw, Claude Code | Native parallel agents, subagents, worktrees | Our Studio canvas still offers live multi-agent streaming + human-in-the-loop, but this is no longer our sole moat. |
| Tool calling standard | MCP (Anthropic/OpenAI/Google) | 97M installs, de facto standard | We distribute compiled skills via MCP — we don't compete with the protocol. |
| Prompt caching / context | Claude Code, Cursor | Built into agent harness | We leverage it; we don't rebuild it. |
| Code generation | Codex, Claude, GPT-5 | The model layer | We compile model output into reusable skills. |

**What the industry does NOT solve:**
- No agent natively **packages** a successful session as a reusable artifact.
- No framework auto-generates **typed inputs/outputs** from session logs.
- No tool **mines** past sessions to suggest compilable patterns.
- No system **validates** that a skill still works when parameters change (Stripe → PayPal).

**This is Cepage's territory — and it complements our existing Studio canvas rather than replacing it.**

---

## 3. The Problem — Why One-Off Agent Sessions Don't Scale

### The Symptom

You ask Cursor: *"Create a Stripe integration with webhooks, auth, and admin dashboard."*

**What happens:**
- Cursor 2.0 spins up 4 parallel agents. They build it in 5 minutes. It works.
- Cost: $12. Time: 5 min. Result: One working prototype.

**Two weeks later:**
- PM says: "Same thing for PayPal."
- You re-run the prompt. Another $12. Another 5 minutes. Similar bugs. No reuse.

**The session is lost. The knowledge is lost. The $12 is lost.**

### The Root Cause

Current coding agents are optimized for **disposable execution**, not **reusable systems**:

| Feature | Current State |
|---------|--------------|
| **Session persistence** | Chat history, not structured workflow |
| **Parameterization** | None — "Stripe" is hardcoded in prompts |
| **Validation** | Runtime only — no compile-time checks |
| **Distribution** | Copy-paste prompts, no packaging |
| **Versioning** | None — "v2" means "run the prompt again" |

### Market Data

**UC Berkeley MAST Study (NeurIPS 2025, 1,642 annotated traces):**

| Failure Category | % | Description |
|---|---|---|
| System Design Issues | ~41.8% | Poor architecture, vague specs |
| Inter-Agent Misalignment | ~36.9% | Coordination breakdown |
| Task Verification | ~21.3% | No quality gates |

**GitHub Blog (Feb 2026):** *"Most multi-agent failures aren't caused by weak models — they're caused by weak reasoning architecture."*

**But the hidden cost is reuse:** Every successful session represents $5-50 of API spend and 5-30 min of human time that is **not captured**. At 10 sessions/day, that's $500-5,000/month of **sunk intellectual capital**.

### What Devs Do Today (Workarounds)

1. **Copy-paste prompts** — "Here's the prompt that worked for Stripe, replace with PayPal." (Fragile, error-prone)
2. **Manual abstraction** — Dev manually extracts patterns into scripts. (Time-consuming, not typed)
3. **OpenClaw skills** — Write markdown configs. (No validation, no typed I/O)
4. **Abandon reuse** — "It's faster to rebuild than to figure out why the old prompt broke."

**None of these turn a session into a compiled, tested, versioned artifact.**

---

## 4. The Solution — Cepage as the Skill Compiler

### Definition: Skill Compiler

A **compiler** transforms source code into an executable artifact. Cepage transforms an **agent session** into a **production skill**.

**How it works in practice:**
1. You finish a session with your agent.
2. You explicitly send the session to Cepage (hook, export, or wrapper).
3. Cepage parses the session artifacts (transcripts, diffs, tool calls) and reconstructs an execution graph.
4. It identifies concrete values that can be parameterized.
5. It generates a validation suite and packages the skill for distribution.

**The 5 compilation phases:**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CAPTURE                                                  │
│    └─ User explicitly sends session artifacts to Cepage     │
│       (Claude Code hook, Cursor export, OpenCode wrapper)   │
│                                                             │
│ 2. EXTRACT                                                  │
│    └─ Parse artifacts into a canonical execution graph      │
│       (nodes: agent calls, file edits, tests, deploys)      │
│                                                             │
│ 3. PARAMETERIZE                                             │
│    └─ Replace concrete values with typed parameters         │
│       "Stripe" → {{payment_provider}}                       │
│       "sk_live_xxx" → {{api_key}}                           │
│                                                             │
│ 4. VALIDATE                                                 │
│    └─ Generate test suite from observed behavior            │
│       - Dry-run with mock LLM ($0 cost)                     │
│       - Check parametric coverage                           │
│                                                             │
│ 5. PACKAGE & DISTRIBUTE                                     │
│    └─ Emit multi-format artifacts from single source:       │
│       - MCP tool schema (for Cursor/Claude/Codex)          │
│       - TypeScript SDK (`cepage.skills.mySkill.run()`)     │
│       - Python SDK (`cepage.skills.my_skill.run()`)        │
│       - OpenAPI spec                                        │
│       - CLI command (`cepage run my-skill --provider=x`)   │
│       - Registry, versioning, marketplace                   │
└─────────────────────────────────────────────────────────────┘
```

**Important:** Cepage does not run in the background watching your agent. Agents are proprietary or sandboxed. Compilation requires explicit capture.

### What Cepage Adds to an Existing Agent

```
User: "Build me a Stripe integration"
       │
       ▼
Cursor 2.0: (runs 4 parallel agents, builds it, $12 spent)
       │
       ▼
User: [Runs capture command or hook fires]
       │
       ▼
Cepage Skill Compiler:
  ┌─────────────────────────────────────────────────────────────┐
  │ CAPTURE                                                     │
  │  ├─ Source: Claude Code hook / Cursor export / OpenCode API│
  │  └─ Artifacts: transcript, file diffs, tool outputs         │
  │                                                             │
  │ EXTRACT                                                     │
  │  ├─ Graph: Design → Backend(∥)Frontend → Tests → Deploy    │
  │  ├─ 14 files modified, 3 tests written, 1 deploy config    │
  │  └─ Cost: $12.34, Time: 4m 32s                              │
  │                                                             │
  │ PARAMETERIZE                                                │
  │  ├─ "Stripe" → {{payment_provider}}                         │
  │  ├─ "sk_live_xxx" → {{api_key}}                             │
  │  ├─ "https://api.stripe.com" → {{api_base_url}}            │
  │  └─ Inferred JSON Schema for inputs                         │
  │                                                             │
  │ VALIDATE                                                    │
  │  ├─ Dry-run with mock LLM: PASS                            │
  │  ├─ Parametric coverage: 3/3 required fields                │
  │  └─ Estimated cost per run: $0.45                           │
  │                                                             │
  │ PACKAGE                                                     │
  │  ├─ MCP tool: `cepage_stripe_integration_v1`               │
  │  ├─ TS SDK: `cepage.skills.stripeIntegrationV1.run()`      │
  │  ├─ Python SDK: `cepage.skills.stripe_integration_v1()`    │
  │  └─ CLI: `cepage run stripe-integration-v1`                │
  │                                                             │
  │ DISTRIBUTE                                                  │
  │  └─ Saved to library: "payment-integration-v1"             │
  └─────────────────────────────────────────────────────────────┘
       │
       ▼
User: "Same thing for PayPal"
       │
       ▼
Cursor: "Using skill 'payment-integration-v1'. Diff:"
  ┌─────────────────────────────────────────────────────────────┐
  │ - payment_provider: "stripe" → "paypal"                     │
  │ - api_base_url: "https://api.stripe.com"                    │
  │   → "https://api.paypal.com"                                │
  │ - webhook_events: 12 → 8                                    │
  │ - Estimated cost: $0.45                                     │
  │                                                             │
  │ [Preview] [Run] [Edit]                                      │
  └─────────────────────────────────────────────────────────────┘
```

### Difference from Existing Tools

| | Orchestrator (Dify, CrewAI) | Native Agent (Cursor 2.0) | Skill Framework (OpenClaw) | **Cepage (Skill Compiler)** |
|---|---|---|---|---|
| **Who triggers?** | Human builds workflow | Human prompts agent | Human writes skill config | **Human sends session → Cepage compiles** |
| **Reuse** | Manual templates | None (disposable sessions) | Markdown configs, no types | **Auto-extracted, typed, tested** |
| **Parameterization** | Manual | None | String replacement | **Inferred JSON Schema** |
| **Validation** | Basic | Runtime only | None | **Dry-run + test suite** |
| **Distribution** | API export | None | Community repo | **MCP + SDK + CLI + OpenAPI** |
| **Cross-agent** | No | N/A | Partial | **BYOA via MCP** |

---

## 5. Positionnement & Narrative

### Narrative for Hacker News / Launch

> "Cursor 2.0, Claude Code, Codex — they're incredible at building features. But every feature is a one-off.
>
> You built a Stripe integration yesterday. Today your PM wants PayPal. You rebuild from scratch. Another $12. Another 5 minutes. Same bugs.
>
> Cepage is the skill compiler. You send it your agent session. It extracts the workflow, replaces 'Stripe' with `{{payment_provider}}`, generates tests, and emits a typed skill you can call from any agent.
>
> You keep your favorite agent. Cepage makes its best work permanent."

### Narrative for Technical Devs

> "Cepage doesn't replace your agent. It compiles its output.
>
> When an agent completes a complex session, you capture the artifacts (hook, export, or API). Cepage parses the execution graph, parameterizes concrete values into typed inputs, generates a validation suite, and packages it as a distributable skill.
>
> The skill is a typed contract (JSON Schema inputs/outputs) — so next time, you just say `cepage run payment-integration --provider=paypal`."

### Anti-Positioning (What We Are NOT)

| We are NOT | Why |
|---|---|
| A new coding agent | We don't replace Cursor. We compile what Cursor builds. |
| An IDE | No code editor. We package agent-generated code. |
| A replacement for CrewAI/LangGraph | We integrate with them, we don't replace them. |
| The inventor of "harness engineering" | We implement it. Hashimoto/OpenAI/Fowler coined it. |
| Background spyware | We cannot watch proprietary agents. You explicitly send us the session. |
| An orchestrator *only* | We DO orchestrate on the Studio canvas (live multi-agent workflows), AND we compile external sessions. Both are true. |

---

## 6. Architecture Technique

### 6.1 Existing Assets (real foundations)

Cepage has solid foundations. The compilation pipeline must be built on top of them.

**Agent Adapters:**

| Agent | File | Status | Notes |
|---|---|---|---|
| OpenCode | `packages/agent-core/src/opencode-run.ts` | ✅ Functional | SDK integration, SSE streaming, session reuse, multimodal |
| Cursor | `packages/agent-core/src/cursor-agent.ts` | ⚠️ CLI wrapper | Spawns `cursor-agent` binary, parses stdout/stderr. No deep API. |
| Claude Code | `packages/agent-core/src/adapter.ts` | ⚠️ Schema only | Enum defined, no adapter implementation yet |
| Codex | `packages/agent-core/src/adapter.ts` | ⚠️ Schema only | Enum defined, no adapter implementation yet |
| Custom | `packages/agent-core/src/adapter.ts` | ✅ Contract ready | `AgentAdapter` interface stable |

**Graph Engine:**
- `packages/graph-core/src/graph-store.ts` — In-memory graph CRUD with event emission and snapshot replay
- `packages/shared-core/src/graph.ts` — Types: `GraphNode`, `GraphEdge`, `Branch`, graph event payloads
- `packages/api/src/modules/agents/workflow-managed-flow.service.ts` — Multi-phase executor
- `packages/api/src/modules/agents/workflow-controller.service.ts` — Loop controller

**Skill System:**
- `packages/shared-core/src/workflow-skill.ts` — `WorkflowSkill` schema with optional `inputsSchema`/`outputsSchema` (JSON Schema)
- `packages/api/src/modules/skill-authoring/skill-authoring.service.ts` — Save graph snapshot as skill + regex-based placeholder detection (`{{VAR}}`)
- `packages/api/src/modules/user-skills/` — User skill catalog

**Daemon:**
- `apps/daemon/src/daemon.ts` — Register, heartbeat, claim, execute loop
- `apps/daemon/src/job-runner.ts` — Dispatch: `agent_run`, `workflow_copilot_run`, `runtime_start/stop`
- `apps/daemon/src/runtime-registry.ts` — Process spawn/readiness/stop

**MCP Server:**
- `packages/mcp/src/server.ts` — Real MCP stdio server using official SDK. Exposes saved skills as tools.

### 6.2 What Must Be Built (the compilation pipeline)

The following components do **not yet exist** and constitute the core of the Skill Compiler:

#### Component 1 — Session Extractor

**Problem:** No component reads captured session artifacts (transcripts, diffs, tool logs) and reconstructs a compilable execution graph.

**Solution:** Build an extractor that:
1. Accepts session artifacts from multiple sources (Claude Code JSONL, Cursor SQLite export, OpenCode API)
2. Reconstructs an execution graph (tool calls, file edits, test runs, deploys)
3. Deduplicates retries, collapses loops
4. Maps the graph onto Cepage's `GraphNode`/`GraphEdge` model

**Files:**
- `packages/api/src/modules/skill-compiler/session-extractor.service.ts` **NEW**

#### Component 2 — Parametrizer

**Problem:** No component identifies concrete values that should become typed parameters.

**Solution:** Parametrizer service that:
1. Scans extracted graph for hardcoded values (URLs, API keys, entity names)
2. Replaces them with placeholders
3. Infers JSON Schema from observed values and usage context

**Files:**
- `packages/api/src/modules/skill-compiler/parametrizer.service.ts` **NEW**

#### Component 3 — Skill Compiler

**Problem:** No pipeline turns a parameterized graph into packaged artifacts.

**Solution:** Compiler service that emits:
- MCP tool schema
- TypeScript SDK methods
- Python SDK methods
- OpenAPI spec fragment
- CLI command registration

**Files:**
- `packages/api/src/modules/skill-compiler/skill-compiler.service.ts` **NEW**
- `packages/sdk-ts/` **NEW**
- `packages/sdk-py/` **NEW**

#### Component 4 — Dry-Run Sandbox

**Problem:** No way to validate a skill without spending API dollars.

**Solution:** Mock LLM + isolated git worktree that replays the graph with fake LLM responses to verify structural correctness.

**Files:**
- `packages/api/src/modules/skill-compiler/dry-run.service.ts` **NEW**
- `apps/daemon/src/sandbox/` **NEW**

#### Component 5 — Skill Mining (Phase 2)

**Problem:** Cold-start — no skills without users, no users without skills.

**Solution:** Background worker that watches completed sessions and proposes compilation.

**Files:**
- `packages/api/src/modules/skill-mining/skill-mining.worker.ts` **NEW**

### 6.3 Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         INPUT SURFACES                                  │
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │   STUDIO CANVAS (Option C)  │  │      SKILL COMPILER (this doc)  │  │
│  │                             │  │                                 │  │
│  │  Human designs workflow on  │  │  External agent session →       │  │
│  │  canvas with live agents    │  │  Capture → Extract → Parametrize│  │
│  │  and approval nodes         │  │  → Validate → Package           │  │
│  │                             │  │                                 │  │
│  │  Output: native GraphNode/  │  │  Output: reconstructed graph    │  │
│  │  GraphEdge skill            │  │  mapped to GraphNode/GraphEdge  │  │
│  └──────────────┬──────────────┘  └────────────────┬────────────────┘  │
│                 │                                   │                   │
│                 └───────────────┬───────────────────┘                   │
│                                 │                                       │
│                                 ▼                                       │
│              ┌──────────────────────────────────────┐                   │
│              │      TYPED SKILL LIBRARY (shared)    │                   │
│              │  inputsSchema + outputsSchema (JSON) │                   │
│              │  Source: user | imported | compiled  │                   │
│              └──────────────────┬───────────────────┘                   │
│                                 │                                       │
│              ┌──────────────────┼──────────────────┐                    │
│              ▼                  ▼                  ▼                    │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐           │
│  │  MCP Server     │ │  SDK (TS + Py)  │ │  CLI + OpenAPI  │           │
│  │  Cursor/Claude  │ │  Typed methods  │ │  `cepage run`   │           │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘           │
│                                                                         │
│              ┌──────────────────┬──────────────────┐                    │
│              ▼                  ▼                  ▼                    │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────┐    │
│  │   SKILL LIBRARY     │  │   SKILL MARKETPLACE │  │   SCHEDULER  │    │
│  │  (Private/Team)     │  │  (Public/Community) │  │  (Cron/Web)  │    │
│  └─────────────────────┘  └─────────────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Intégration BYOA — Bring Your Own Agent

### Philosophy

**We don't replace the agent. We compile its output.**

The user keeps their workflow. After a session, they explicitly capture it and send it to Cepage. Compilation is intentional, not automatic.

**Why explicit capture?**
- Cursor is proprietary. There is no API to observe local sessions.
- Claude Code has hooks, but they must be installed by the user.
- Agents run in sandboxes. External tools cannot intercept their internals.

### Integration by Agent

#### Claude Code (Easiest — Recommended for MVP)

**Mechanism:** Native hooks (`SessionEnd`)

**Flow:**
```
User: "Build me a Stripe integration"
Claude Code: (completes task)
Hook fires: POST session artifacts to Cepage
Cepage: "Detected compilable pattern. Compile to skill? [Y/n]"
User: [Y]
Cepage: extracts, parameterizes, validates, packages
Claude Code: "Skill saved as 'payment-integration-v1'. 
             Next time: `cepage run payment-integration-v1 --provider=paypal`"
```

**Implementation:**
- Hook script: `~/.claude/hooks/cepage-compile.sh`
- One-line install: `cepage hook install claude-code`

#### Cursor

**Mechanism:** Session export + CLI import

**Flow:**
```
User: "Build me a Stripe integration"
Cursor 2.0: (runs parallel agents, completes in 5 min)
User: `cepage import cursor --session-id=...`
Cepage: parses Cursor SQLite export, extracts graph, compiles
```

**Limitations:**
- Cursor stores sessions in `~/.cursor/chats/` (SQLite, proprietary schema).
- No API for real-time observation.
- Export may be manual or require periodic polling.

**Implementation:**
- CLI: `cepage import cursor --session-id=...`
- Parser for Cursor SQLite schema

#### OpenCode / OpenClaw

**Mechanism:** Direct API (OpenCode SDK) or wrapper

**Flow:**
```
User: "Build me a game"
OpenCode: (completes task)
User ran via Cepage wrapper: session already captured
Cepage: compiles and returns skill ID
```

**Implementation:**
- Run OpenCode through Cepage: `cepage run opencode --prompt "..."`
- Cepage captures the full SSE stream and stores the session graph

### MCP Server Specification (Distribution Only)

```typescript
// packages/mcp-server/src/index.ts
const server = new Server({ name: "cepage", version: "1.0.0" });

// Tool: run_skill (compile_session requires explicit capture first)
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "cepage_run_skill") {
    const { skillId, inputs } = req.params.arguments;
    const result = await cepage.runSkill(skillId, inputs);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
});
```

**Clarification:** MCP is for **running compiled skills**, not for capturing sessions. Session capture happens via hooks, exports, or wrappers.

---

## 8. User Journey — The Skill Compiler in Action

### Scenario: "Build me a Stripe integration"

#### Step 0 — Setup (one time)

```bash
# Install Cepage
npm install -g @cepage/cli
cepage init

# Configure agent capture
cepage hook install claude-code   # or: cepage agent add cursor
```

#### Step 1 — Prompt (in Claude Code)

```
User: "I need a Stripe integration for my SaaS. Subscriptions, webhooks,
        auth, and an admin dashboard to view transactions."
```

#### Step 2 — Agent Execution (Claude Code)

```
Claude Code: (completes task)
```

#### Step 3 — Capture & Compilation Proposal (Cepage)

```
[Hook fires automatically on session end]

Cepage: "Session captured. Detected compilable workflow."

┌──────────────────────────────────────────────────────────────┐
│ CEPAGE COMPILATION PROPOSAL                                  │
│                                                              │
│ Session: stripe-integration-2026-04-22                       │
│ Cost: $12.34 | Time: 4m 32s | Files: 14                     │
│                                                              │
│ Detected pattern: Payment Provider Integration               │
│                                                              │
│ Parameterizable values:                                      │
│  ├─ "Stripe" → {{payment_provider}}                          │
│  ├─ "sk_live_xxx" → {{api_key}}                              │
│  ├─ "https://api.stripe.com" → {{api_base_url}}             │
│  └─ 12 webhook events → {{webhook_events}}                   │
│                                                              │
│ [Compile] [Review Graph] [Ignore]                            │
└──────────────────────────────────────────────────────────────┘

User: [Compile]
```

#### Step 4 — Skill Compilation (Cepage)

```
Cepage Skill Compiler:
  ┌──────────────────────────────────────────────────────────────┐
  │ EXTRACT                                                      │
  │  ├─ Graph: 4 phases, 7 nodes, 6 edges                        │
  │  └─ Collapsed 3 retry loops                                  │
  │                                                              │
  │ PARAMETERIZE                                                 │
  │  ├─ Inferred JSON Schema (4 required inputs)                 │
  │  └─ Optional inputs: 3 (with defaults)                       │
  │                                                              │
  │ VALIDATE (Dry-run)                                           │
  │  ├─ Mock LLM replay: PASS                                    │
  │  ├─ Structural checks: PASS                                  │
  │  └─ Estimated cost per run: $0.45                            │
  │                                                              │
  │ PACKAGE                                                      │
  │  ├─ MCP tool: cepage_payment_integration_v1                │
  │  ├─ TS SDK: cepage.skills.paymentIntegrationV1.run()       │
  │  ├─ Python SDK: cepage.skills.payment_integration_v1()     │
  │  └─ CLI: `cepage run payment-integration-v1`               │
  └──────────────────────────────────────────────────────────────┘
```

#### Step 5 — Delivery

```
Claude Code: "Your Stripe integration is ready."
  ├─ Backend: http://localhost:3000/api
  ├─ Frontend: http://localhost:3000/admin
  ├─ Tests: All pass (94% coverage)
  └─ Docker: Ready for deploy

Claude Code: "The workflow has been compiled into a skill."
  Skill: "payment-integration-v1"
  Inputs: { paymentProvider, apiKey, apiBaseUrl, webhookEvents }
  Outputs: { backendUrl, frontendUrl, testReport, dockerConfig }
  Cost/run: $0.45 (vs $12.34 original)

Claude Code: "Next time, just say:
         `cepage run payment-integration-v1 --provider=paypal`"
```

#### Step 6 — Reuse (next week)

```
User: "Same thing but for PayPal"

Claude Code: "Using skill 'payment-integration-v1'. Here's the diff:"
  ┌──────────────────────────────────────────────────────────────┐
  │ Adaptation: PayPal                                           │
  │                                                              │
  │ - payment_provider: "stripe" → "paypal"                      │
  │ - api_base_url: "https://api.stripe.com"                     │
  │   → "https://api.paypal.com"                                 │
  │ - webhook_events: 12 → 8                                     │
  │ - auth_flow: "OAuth2 PKCE" → "OAuth2 client_credentials"     │
  │                                                              │
  │ Estimated cost: $0.45 | Estimated time: 2m 10s               │
  │                                                              │
  │ [Preview Full Diff] [Run] [Edit Parameters]                  │
  └──────────────────────────────────────────────────────────────┘

User: [Run]

# Result: Same workflow, adapted for PayPal, in 1/10th the time
```

---

## 9. Unit Economics & Operating Modes

### The Cost Problem

A 4-phase workflow with 2 parallel agents costs $5-12 per run. For a dev running 10 sessions/day, that's $1,500-3,600/month of **disposable spend**.

**Cepage reduces the marginal cost of reuse by 10-30x through compilation.**

### Clarification

The $12 → $0.45 comparison is:
- **$12** = Cost of original exploration (iterations, errors, parallel agents)
- **$0.45** = Marginal cost of re-running the compiled skill with new parameters

The compiled skill still executes code generation, but it skips exploration, retries, and architectural decisions. It runs the known path.

### Operating Modes

| Mode | Description | Cost | When to use |
|------|-------------|------|-------------|
| **Compile** | Extract graph, parameterize, package | $0.01 | After any successful session |
| **Dry-run** | Replay graph with mock LLM, no API calls | $0 | CI checks, regression tests |
| **Eco** | Smaller models, fewer validators | 30% of Full | Prototyping, iteration |
| **Full** | Frontier models, full validation | 100% | Production deployment |

### Economic Model

| Metric | Before Cepage | After Cepage |
|--------|--------------|--------------|
| Cost per Stripe integration (exploration) | $12.34 | $12.34 (unchanged) |
| Cost per PayPal adaptation | $12.34 (rebuild) | $0.45 (skill run) |
| Time per adaptation | 5 min (rebuild) | 2 min (parameter swap) |
| Reproducibility | None | Versioned, tested |

**Break-even:** After 2 reuses, the $0.01 compilation cost is amortized.

---

## 10. Roadmap Phasée

### Phase 0 — Foundation (Week 0)

**Goal:** Audit existing infrastructure and validate extraction feasibility per agent.

- [ ] Audit existing adapters (OpenCode ✅, Cursor ⚠️)
- [ ] Validate Claude Code hook mechanism (transcript format, hook reliability)
- [ ] Validate Cursor SQLite parsing (schema stability, completeness)
- [ ] Audit graph engine (can it represent execution graphs, not just canvas nodes?)
- [ ] Audit skill system (save-as-skill flow, JSON Schema fields)
- [ ] Audit MCP server (skill distribution is already real)

**Deliverables:**
- Technical audit doc
- Capture mechanism decision per agent
- ADR for the pivot

### Phase 1 — Dual Surface MVP (Weeks 1-8)

**Goal:** Both surfaces are functional and converge on the same Library.

**Scope clarification:** This extends the Option C foundation with the compilation pipeline. The Studio canvas and Library UI (from 01–10) are built in parallel with the compiler backend.

**Week 1-2: Session Extractor + Studio Foundation**
- [ ] Create `packages/api/src/modules/skill-compiler/session-extractor.service.ts`
- [ ] Claude Code extractor (JSONL parser) — **MVP priority**
- [ ] Cursor extractor (SQLite export parser) — **stretch goal**
- [ ] OpenCode extractor (SSE log replay) — **stretch goal**
- [ ] Extend `workflowSkillSchema` with `inputsSchema`, `outputsSchema`, `source`, `execution` (from 03)
- [ ] New Prisma models: `UserSkill`, `SkillRun`, `WebhookSubscription`
- [ ] Test: 10 sessions per agent, verify graph fidelity

**Week 3-4: Parametrizer + Library UI Skeleton**
- [ ] Create `packages/api/src/modules/skill-compiler/parametrizer.service.ts`
- [ ] Identify replaceable values (strings, URLs, entities)
- [ ] Infer JSON Schema for inputs
- [ ] Route `/library` with grid + filters + search
- [ ] Skill detail page `/library/[slug]` with auto-generated form via `@rjsf/core`
- [ ] Test: 10 sessions, verify parameter coverage

**Week 5-6: Compiler + Dry-run + Run Pipeline**
- [ ] Create `packages/api/src/modules/skill-compiler/skill-compiler.service.ts`
- [ ] Emit MCP schema + CLI command
- [ ] Dry-run sandbox V1: lint-only validation + parametric coverage checks
- [ ] `POST /skills/:slug/runs` with ajv validation and SSE stream
- [ ] Run history + run detail pages
- [ ] Test: compile 5 skills, dry-run all, verify structural correctness

**Week 7-8: Integration, Studio Polish & Demo**
- [ ] Claude Code hook installer (`cepage hook install claude-code`)
- [ ] Cursor import CLI (`cepage import cursor`) — **if stable**
- [ ] `SaveAsSkillDialog` wired in Studio session header
- [ ] CommandPalette (`Cmd+K`) across the app
- [ ] Demo video (5 min max) showing BOTH surfaces: Studio save-as-skill + Compiler from Claude Code hook
- [ ] Documentation "Getting Started"

**Gate:**
- [ ] Functional demo recorded and shared with 10 beta users
- [ ] "Would use" rate > 70% (for both surfaces combined)
- [ ] Compilation time < 30 sec for a 5-phase session
- [ ] Studio "Save as skill" flow < 60 seconds end-to-end

### Phase 2 — Distribution (Weeks 9-14)

**Goal:** Compiled skills are reusable and distributable.

**Week 9-10: SDK**
- [ ] TypeScript SDK: `cepage.skills.mySkill.run(inputs)`
- [ ] Python SDK: `cepage.skills.my_skill.run(inputs)`
- [ ] Auto-generation from JSON Schema

**Week 11-12: Skill Mining**
- [ ] Background worker watching captured sessions
- [ ] Pattern detection (graph fingerprint similarity)
- [ ] User prompt: "This session looks compilable. Compile?"

**Week 13-14: Launch Prep**
- [ ] Landing page (cepage.dev)
- [ ] Blog post "Your agent builds features. Cepage compiles them."
- [ ] Hacker News launch strategy
- [ ] Product Hunt launch strategy

**Gate:**
- [ ] 100+ GitHub stars in 7 days post-launch
- [ ] 10+ active MCP installations
- [ ] 50+ sessions compiled (via capture or manual)

### Phase 3 — Auto-Improvement (Weeks 15-24)

**Goal:** The compiler improves itself.

**Week 15-18: Session Analysis**
- [ ] `SessionAnalyzerService` — graph fingerprint + LLM summary
- [ ] Post-session hook in capture pipeline

**Week 19-20: Pattern Detection**
- [ ] `SessionPatternService` — hybrid matching (graph hash + text embedding)
- [ ] Adaptive threshold for compilation proposals

**Week 21-22: Advanced Parameterization**
- [ ] `ParametrizerV2` — infer nested objects, conditional branches
- [ ] Support for enum inference from observed values

**Week 23-24: Security Pipeline**
- [ ] Quarantine (isolated temp dir)
- [ ] Lint LLM-as-judge
- [ ] Dry-run sandbox (Docker/Modal)

**Gate:**
- [ ] Compilation acceptance rate > 30% (users accept proposed compilations)
- [ ] 0 security incidents (poisoned skill)
- [ ] 1000+ GitHub stars

### Phase 4 — Scale (Weeks 25+)

**Goal:** Ecosystem and community.

- [ ] Public skill marketplace
- [ ] Team features (workspace sharing, permissions)
- [ ] Self-hosted option
- [ ] Enterprise features (SSO, audit logs)

---

## 11. Métriques & Gates

### KPIs by Phase

| Phase | KPI | Target | Measurement |
|---|---|---|---|
| **Phase 1** | "Would use" rate | >70% | Beta user survey |
| **Phase 1** | Compilation time | <30 sec | Logs |
| **Phase 1** | Dry-run pass rate | >80% | Logs |
| **Phase 2** | GitHub stars (7d post-launch) | >100 | GitHub API |
| **Phase 2** | Sessions compiled | >50 | DB query |
| **Phase 2** | Active MCP installs | >10 | MCP server logs |
| **Phase 3** | Compilation acceptance rate | >30% | DB (proposal → accept) |
| **Phase 3** | Security incidents | 0 | Security audit |
| **Phase 3** | GitHub stars | >1000 | GitHub API |
| **Phase 4** | MAU | >5000 | Analytics |
| **Phase 4** | Public marketplace skills | >100 | DB query |

### Kill Criteria

| Gate | Condition | Action if Failed |
|---|---|---|
| **Gate 1** (End Phase 1) | "Would use" < 50% | Stop. The problem doesn't exist or the capture friction is too high. |
| **Gate 2** (End Phase 1) | Dry-run pass rate < 50% | Reduce scope (simpler parameterization). |
| **Gate 3** (End Phase 2) | Stars < 50 in 7 days | Pivot narrative. The message doesn't resonate. |
| **Gate 4** (End Phase 3) | Compilation acceptance < 20% | Remove auto-mining. Keep manual compile only. |

---

## 12. Risques & Mitigations

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Session extraction misses critical steps** | High | Fatal | Human-in-the-loop: user reviews graph before compilation. |
| **Parameterization hallucinates wrong types** | High | High | Dry-run catches structural mismatches. User validates schema. |
| **Compiled skill fails on parameter change** | Medium | High | Dry-run with sampled parameter values. Test suite per skill. |
| **Context too large for LLM** | High | High | Graph compression. Summarize phase outputs. |
| **Sandbox dry-run fails environmentally** | Medium | Medium | Fallback to lint-only validation. Don't block if sandbox unavailable. |
| **Capture friction is too high** | High | Fatal | Start with Claude Code hooks (easiest). Cursor export as fallback. |

### Market Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Cursor adds native skill saving** | Very High | Fatal | Differentiation: cross-agent (Cursor + Claude + Codex), typed contracts, SDK codegen. Cursor will likely stay Cursor-only. |
| **OpenClaw adds typed skill compilation** | High | High | Differentiation: visual canvas for graph review, deep IDE integration via MCP, focus on code-only workflows. OpenClaw is general-purpose; we are code-specific. |
| **OpenCode adds session replay as skill** | Medium | High | Speed. Ship first. Build community. |
| **API cost explodes** | High | High | Budget display from MVP. Rate limiting. Eco mode. Compilation is $0.01, not $12. |

### Organizational Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Scope creep** | Very High | Fatal | Strict ADR: every feature must pass "does it improve compilation quality or distribution?" AND serve at least one surface + the shared Library. |
| **Product confusion (dual surface)** | Medium | High | Maintain clear separation in docs and UI: Studio = design canvas, Compiler = session capture. Shared Library is the convergence point. |
| **Team too small for roadmap** | High | High | Phase 1 = 8 weeks with 2-3 engineers. If impossible, cut SDK, keep MCP+CLI. |
| **Burnout before launch** | Medium | High | 4-week sprints max. Demo every Friday. Celebrate milestones. |

---

## 13. Analyse Concurrentielle

### Honest Competitive Matrix

| | Cepage | Cursor 2.0 | OpenClaw | Dify | Claude Code | LangGraph |
|---|---|---|---|---|---|---|
| **Multi-agent orchestration** | ✅ (Studio canvas) | ✅ (8 parallel agents) | ✅ (native) | ✅ (visual) | ✅ (subagents) | ✅ (graph) |
| **Session compilation** | ✅ **(core)** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Typed skills (JSON Schema)** | ✅ | ❌ | ⚠️ (markdown) | ⚠️ (basic templates) | ❌ | ❌ |
| **Skill auto-extraction** | ✅ (explicit capture) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Cross-agent distribution** | ✅ (MCP) | ❌ (Cursor-only) | ⚠️ (partial) | ❌ | ❌ | ❌ |
| **Dry-run validation** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Visual canvas** | ✅ (live agents) | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Real-time observation** | ❌ (explicit capture) | ✅ | ✅ | ⚠️ (logs) | ⚠️ | ⚠️ |
| **Open source** | ✅ (MIT) | ❌ | ✅ | ✅ (Apache) | ❌ | ✅ |
| **Local-first** | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ |

### Why Not Just Use...?

**Cursor 2.0?**
- Cursor already has the best multi-agent orchestration. But every session is disposable.
- Cepage compiles Cursor's output into reusable skills. We are complementary, not competitive.
- **Limitation:** Cursor must export sessions explicitly. No real-time observation.

**OpenClaw?**
- OpenClaw has ~362K stars and 5,700+ community skills. But skills are markdown configs without typed I/O, validation, or SDK codegen.
- Anecdotal community analyses report high invalid-output rates (~43% in one measured pipeline) from unvalidated community skills (Kowshik Jallipalli, DEV.to, Apr 2026).
- 341 malicious skills found in the ClawHavoc incident (Feb 2026), later growing to 824+ by Mar 2026.
- Cepage differentiates with: (1) compiled artifacts with JSON Schema + test suites, (2) a visual Studio canvas for designing workflows, (3) multi-format distribution via MCP/SDK/CLI.

**Claude Code + Hooks?**
- Hooks provide runtime validation. Cepage provides compile-time packaging and cross-session reuse.
- Hooks are agent-specific. Cepage skills work across agents.
- **Advantage:** Claude Code is the easiest agent to integrate (native hooks).

**Dify / LangGraph?**
- These are orchestrators where humans build workflows. Cepage does this too (Studio canvas), but we ALSO compile agent-discovered workflows into reusable skills.
- Cepage is the only platform that covers both: human-designed workflows on a canvas AND agent-discovered workflows compiled from external sessions.

### Our Moat — Realistic Assessment

| Moat | Durability | Commentary |
|---|---|---|
| **Cross-agent compilation** | 12-18 months | MCP makes integration easy, but the compilation logic is non-trivial. |
| **Graph extraction fidelity** | 18-24 months | Requires session data and iteration. Data moat once we have 10K+ sessions. |
| **Typed Skill Contract + codegen** | 12-18 months | SDK codegen is hard to replicate, but not impossible. |
| **Auto-mining from sessions** | 24-36 months | Requires session volume. True flywheel once launched. |
| **Community marketplace** | 5+ years | The ultimate moat, but requires bootstrapping. |

**Key insight:** Our moat is not a single feature. It is the **loop**:

```
More sessions → Better extraction → Better compilation → More skills → 
More users → More sessions → ...
```

This flywheel takes 6-12 months to spin up. We must ship Phase 1 before Cursor or OpenClaw realize this is the next battleground.

---

## 14. Appendices

### A. Glossary

| Term | Definition |
|---|---|
| **Skill Compiler** | System that transforms an agent session into a reusable, typed, tested skill. |
| **BYOA** | Bring Your Own Agent. User keeps their preferred agent (Cursor, Claude, etc.). |
| **MCP** | Model Context Protocol. Standard for connecting tools to agents. Used by Cepage for skill distribution, not session capture. |
| **Skill** | Compiled workflow with JSON Schema inputs/outputs, reusable and versioned. |
| **Session Capture** | Explicit mechanism to send agent session artifacts to Cepage (hook, export, wrapper). |
| **Session Extraction** | Process of building a canonical graph from captured session artifacts. |
| **Parameterization** | Replacing concrete values in a session with typed input parameters. |
| **Dry-run** | Validation of a compiled skill using mock LLM and isolated environment. |
| **Skill Mining** | Automatic detection of compilable patterns in captured sessions. |

### B. Key Technical References

| File | Description |
|---|---|
| `packages/agent-core/src/adapter.ts` | `AgentAdapter` interface |
| `packages/agent-core/src/registry.ts` | Adapter registry |
| `packages/agent-core/src/opencode-run.ts` | OpenCode adapter (functional) |
| `packages/agent-core/src/cursor-agent.ts` | Cursor adapter (CLI wrapper) |
| `packages/graph-core/src/graph-store.ts` | Graph CRUD |
| `packages/shared-core/src/graph.ts` | Graph types |
| `packages/shared-core/src/workflow-skill.ts` | Skill schema |
| `packages/api/src/modules/skill-authoring/skill-authoring.service.ts` | Save-as-skill + regex placeholder detection |
| `packages/mcp/src/server.ts` | MCP server (skill distribution) |
| `apps/daemon/src/daemon.ts` | Daemon main loop |
| `apps/daemon/src/job-runner.ts` | Job dispatch |

### C. External References

- UC Berkeley MAST Study (NeurIPS 2025) — *Why Do Multi-Agent LLM Systems Fail?* (arXiv:2503.13657)
- GitHub Blog (Feb 2026) — *Multi-agent workflows often fail. Here's how to engineer ones that don't.*
- OpenAI Engineering Blog (Feb 2026) — *Harness engineering: leveraging Codex in an agent-first world*
- Martin Fowler (Apr 2026) — *Harness engineering for coding agent users* (Birgitta Böckeler)
- Mitchell Hashimoto (Feb 2026) — *My AI Adoption Journey* (origin of "Engineer the Harness")
- Cursor 2.0 Announcement (Oct 2025) — *Introducing Cursor 2.0 and Composer*
- OpenClaw Project — ~362K GitHub stars, agent orchestration framework (as of Apr 2026)
- MCP Ecosystem — 97M installs, 13K+ servers (Mar 2026)
- DEV.to (Apr 2026) — *247K Stars Hide OpenClaw's Skill Boundary Failures* — analysis of untyped skills and security issues

### D. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-22 | Pivot from orchestrator to skill compiler | Orchestration is being solved natively by agents. The gap is compilation/reuse. |
| 2026-04-22 | Dual surface: Studio canvas + Skill Compiler | The Studio canvas (Option C) is retained as a first-class surface alongside the new Skill Compiler. Both feed the same typed skill library. Rationale: (1) external capture is fragile, (2) the canvas is a unique moat, (3) the graph engine is already built, (4) some workflows need native human-in-the-loop. |
| 2026-04-22 | Governance rule: one feature, two surfaces | Every new feature must serve at least one surface AND the shared Library. Features serving only one surface are deferred to Phase 3. |
| 2026-04-22 | BYOA (Bring Your Own Agent) | Users want to keep their agent. We augment, not replace. |
| 2026-04-22 | Explicit capture, not passive observation | Agents are proprietary/sandboxed. Real-time observation is technically impossible for Cursor/Claude without user-installed hooks. |
| 2026-04-22 | MCP as primary distribution mechanism | Cursor, Claude Code, Codex all support MCP. One integration = all agents can run compiled skills. |
| 2026-04-22 | Acknowledge "harness engineering" as existing discipline | Credibility. We implement it, we didn't invent it. |
| 2026-04-22 | Phase 1 scope: 8 weeks, 2-3 engineers | Building the compilation pipeline is a product effort, not a small gap. Complex features (auto-mining, security pipeline) come later. |
| 2026-04-22 | Claude Code as MVP agent | Native hooks make it the easiest and most credible integration. |
| 2026-04-22 | Kill criteria defined | If "would use" rate < 50% after Phase 1, stop. |

---

*Document version: 3.1*  
*Last updated: 2026-04-22*  
*Next review: After Phase 1 Gate (Week 8)*

---

**Immediate Action Items:**

1. [ ] Review this doc with the team (30 min meeting)
2. [ ] Assign Phase 1 owners (extractor, parametrizer, compiler, dry-run)
3. [ ] Build Claude Code hook prototype (validate capture mechanism)
4. [ ] Build Cursor SQLite parser prototype (validate extraction feasibility)
5. [ ] Setup weekly demo ritual (every Friday, 5 min video)
6. [ ] Create GitHub project board with Phase 1 tasks
7. [ ] Schedule Phase 1 Gate review (Week 8)
