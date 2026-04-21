# Workflow API Operator Skill

This file keeps its historical filename for continuity in the prompt library, but the content now covers the broader workflow API operator surface, not only `workflow-copilot`.

## Goal

Use the API as an operator-style skill so another agent can:

1. create a session
2. configure a workspace
3. generate or update workflows with `workflow-copilot`
4. execute workflows through the right entrypoint
5. monitor runs until terminal state
6. handle parse failures, blocked states, approvals, and retries
7. validate that the final published artifacts match the user request

This document is based on the same API path that was used to generate and run the validated `Three.js` vanilla documentation-pack example in this library, then generalized to cover the other workflow/runtime control surfaces exposed by the API.

## Preconditions

- The API is reachable, typically at `http://127.0.0.1:31947/api/v1`.
- If you plan to execute workflows, at least one execution worker should be running.
- You know the target workspace parent directory and desired session directory name.
- You know which agent/model pair to lock for the copilot and for generated agent steps.

## Coverage

This operator skill now covers these lanes:

- `workflow-copilot` thread lifecycle: create, patch, send, stop, manual apply, restore checkpoint
- generated `managed_flow` execution and monitoring
- direct `workflow/run` execution
- `input`-driven starts via `inputs/:nodeId/start`
- loop-controller execution via `controllers/:nodeId/run`
- runtime targets via `runtime/targets/:targetNodeId/run`
- runtime run stop/restart/preview
- pending approval inspection and resolution

Preferred lane:

- If the goal is “ask an agent to generate a workflow, run it, and monitor it”, the preferred path remains:
  `workflow-copilot -> graph inspection -> managed_flow run -> graph/workspace validation`

Other lanes matter when:

- you already have the workflow graph and do not need copilot generation
- you need to kick off a workflow from a specific input template
- you need to resume or drive a loop controller directly
- you need to manage a runtime target or preview a runnable result
- the system is blocked on approval resolution

## Deliberate boundaries

This skill is now general across workflow operation, but it is still not meant to be a full raw-graph authoring manual.

It deliberately focuses on:

- session creation and workspace setup
- workflow generation and execution entrypoints
- runtime and approval handling
- monitoring, recovery, and validation

It does not try to fully document:

- low-level `POST /sessions/:sessionId/nodes` and `POST /sessions/:sessionId/edges` authoring flows
- branch management and graph-edit conflict resolution
- every possible node type or every graph patch shape

If an agent needs to do raw graph surgery, pair this skill with the graph API docs or direct code inspection of the graph module.

## Response Shape Notes

- Most session, graph, workflow-copilot, and flow endpoints return a wrapper shaped like:

```json
{
  "success": true,
  "data": { "...": "..." }
}
```

- `GET /execution/workers` is an exception: it returns a raw array, not a `success/data` wrapper.
- When writing scripts, unwrap `.data` when present and handle `/execution/workers` separately.

## Endpoints Used By This Skill

### Session and graph

| Endpoint | Purpose |
|----------|---------|
| `GET /execution/workers` | Confirm a worker is available before executing workflows. |
| `POST /sessions` | Create a new session shell. |
| `PATCH /sessions/:sessionId/workspace` | Set `parentDirectory` and `directoryName`; response includes the resolved workspace. |
| `GET /sessions/:sessionId/graph` | Read the full graph bundle, including nodes, edges, runs, controllers, flows, and activity context. |
| `GET /sessions/:sessionId/events` | Optional low-level graph event stream for debugging. |
| `GET /sessions/:sessionId/timeline` | Optional activity feed for human-readable auditing. |

### Workflow-copilot thread lifecycle

| Endpoint | Purpose |
|----------|---------|
| `POST /sessions/:sessionId/workflow-copilot/thread` | Create or ensure a copilot thread. |
| `GET /sessions/:sessionId/workflow-copilot/threads/:threadId` | Inspect thread state and message history. |
| `PATCH /sessions/:sessionId/workflow-copilot/threads/:threadId` | Change title, scope, mode, agent/model, `autoApply`, `autoRun`, or `externalSessionId`. |
| `POST /sessions/:sessionId/workflow-copilot/threads/:threadId/messages` | Send a generation or revision prompt. |
| `POST /sessions/:sessionId/workflow-copilot/threads/:threadId/stop` | Stop an in-flight copilot turn. |
| `POST /sessions/:sessionId/workflow-copilot/threads/:threadId/messages/:messageId/apply` | Manually apply a completed assistant message when `autoApply` is off. |
| `POST /sessions/:sessionId/workflow-copilot/threads/:threadId/checkpoints/:checkpointId/restore` | Restore the workflow graph to a prior checkpoint. |

### Workflow execution entrypoints

| Endpoint | Purpose |
|----------|---------|
| `POST /sessions/:sessionId/flows/:nodeId/run` | Run or resume a `managed_flow`. |
| `POST /sessions/:sessionId/flows/:flowId/cancel` | Cancel a `managed_flow`. |
| `POST /sessions/:sessionId/controllers/:nodeId/run` | Run or resume a `loop` controller directly. |
| `POST /sessions/:sessionId/workflow/run` | Directly spawn an agent workflow run from a trigger node or prepared inputs. |
| `POST /sessions/:sessionId/inputs/:nodeId/start` | Start from a specific template input node. |

### Runtime and approvals

| Endpoint | Purpose |
|----------|---------|
| `POST /sessions/:sessionId/runtime/targets/:targetNodeId/run` | Launch a runtime target. |
| `POST /sessions/:sessionId/runtime/runs/:runNodeId/stop` | Stop a runtime run. |
| `POST /sessions/:sessionId/runtime/runs/:runNodeId/restart` | Restart a runtime run. |
| `GET /sessions/:sessionId/runtime/runs/:runNodeId/preview` | Fetch runtime preview HTML. |
| `GET /sessions/:sessionId/runtime/runs/:runNodeId/preview/*assetPath` | Fetch preview assets. |
| `GET /sessions/:sessionId/approvals/pending` | Inspect pending approvals. |
| `POST /sessions/:sessionId/approvals/:approvalId/resolve` | Approve, reject, or cancel a pending approval. |

## Recommended Defaults

For copilot-driven workflow generation, the most reliable defaults used in the validated run were:

- thread `mode`: `edit`
- thread `surface`: `sidebar`
- thread `scope`: `{ "kind": "session" }`
- `autoApply`: `true`
- `autoRun`: `false`
- `agentType`: `cursor_agent`
- `model`: `{ "providerID": "cursor_agent", "modelID": "composer-2-fast" }`

Why:

- `edit` lets the copilot change the graph.
- `autoApply: true` removes the extra apply call when the copilot output parses cleanly.
- `autoRun: false` keeps generation and execution separate, which makes failures easier to diagnose.

Other valid thread settings worth knowing:

- `surface`: `sidebar` or `node`
- `scope.kind`: `session`, `node`, or `subgraph`
- `mode`: `edit` or `ask`

Use these variants deliberately:

- `autoApply: false` when you want to review the assistant output first, then call `.../messages/:messageId/apply` manually
- `autoRun: true` when you trust the copilot to emit execution intents and want the server to execute them automatically
- `mode: ask` when you want read-only reasoning about the current workflow and do not want graph edits

## Attachments and uploads

There are two different attachment mechanisms:

### Copilot JSON attachments

`POST /sessions/:sessionId/workflow-copilot/threads/:threadId/messages`

- attachments are JSON objects with:
  - `filename`
  - `relativePath` optional
  - `mime`
  - `data` as a data URL
- max attachment count: `64`
- max decoded size per attachment: `4 MB`
- max decoded size across one message: `16 MB`
- for `cursor_agent`, only text-like payloads are reliably inlined (`text/*` and `application/json`)
- `cursor_agent` attachment inline context is capped more tightly; large attachment batches can fail with a “context too large” error

### Workflow/input multipart uploads

`POST /sessions/:sessionId/workflow/run`
and
`POST /sessions/:sessionId/inputs/:nodeId/start`

- these routes support multipart file uploads
- per-file size limit: `12 MB`
- uploaded file fields must match the `field` names referenced by workflow input parts
- use this path when a workflow or input node expects file/image parts instead of plain text

## Standard Runbook

### 1. Check the API and worker

- Call `GET /execution/workers`.
- Require at least one worker with `status: "running"` before executing a flow.
- If you only want to generate a workflow, the worker is less important, but keep the API healthy first.

### 2. Create a session

```json
POST /sessions
{
  "name": "Three.js workflow validate 20260410-082504"
}
```

Record the returned `sessionId`.

### 3. Configure the workspace

```json
PATCH /sessions/:sessionId/workspace
{
  "parentDirectory": "/Users/me/Documents",
  "directoryName": "test-docs-creation-threejs-20260410-082504"
}
```

Use the returned `workspace.workingDirectory` later to inspect files directly from the filesystem.

### 4. Create the workflow-copilot thread

```json
POST /sessions/:sessionId/workflow-copilot/thread
{
  "surface": "sidebar",
  "title": "Three.js docs workflow",
  "scope": { "kind": "session" },
  "mode": "edit",
  "agentType": "cursor_agent",
  "model": {
    "providerID": "cursor_agent",
    "modelID": "composer-2-fast"
  },
  "autoApply": true,
  "autoRun": false
}
```

Record the returned `thread.id`.

### 5. Send the workflow generation prompt

Send the actual user request as a copilot message. For stable results:

- say whether the copilot should generate only or also run
- name the exact final directory and files
- explicitly require `cleanup/publish` before final verify
- explicitly say whether per-run intermediate outputs are acceptable
- explicitly say whether user docs must be persisted onto the graph before implementation starts
- explicitly say that final outputs must not live only in `tmp`, process temp folders, or `run-*` scratch paths
- keep the prompt compact if the graph can be large

Example payload:

```json
POST /sessions/:sessionId/workflow-copilot/threads/:threadId/messages
{
  "content": "Create a workflow that builds a multi-file documentation pack about Three.js vanilla for game development, not React Three Fiber. Use only cursor_agent with composer-2-fast. Generate the workflow now, but do not run it yet. Require research, scaffold, derive_input, loop with per-run drafts, cleanup/publish to docs/context/frameworks/three-js/<slug>.md, and final runtime_verify_phase that writes outputs/verify.txt ending with VERIFY_OK.",
  "agentType": "cursor_agent",
  "model": {
    "providerID": "cursor_agent",
    "modelID": "composer-2-fast"
  },
  "autoApply": true,
  "autoRun": false
}
```

### 6. Inspect whether generation succeeded

Use both:

- `GET /sessions/:sessionId/workflow-copilot/threads/:threadId`
- `GET /sessions/:sessionId/graph`

Success criteria:

- the latest assistant message has `status: "completed"`
- the graph now contains at least one `managed_flow` node
- the generated flow contains the expected phases
- publish / verify nodes reflect the requested stable final layout
- source-of-truth docs are represented as `file_summary` or `workspace_file` nodes and linked to consumers
- no orphan executable nodes remain outside the intended flow topology

Failure criteria:

- latest assistant message has `status: "error"`
- thread error is `WORKFLOW_COPILOT_PARSE_FAILED`
- graph remains unchanged or contains no `managed_flow`

### 7. Retry strategy when parsing fails

The most common observed failure in this workflow family was `WORKFLOW_COPILOT_PARSE_FAILED`.

The successful recovery pattern was:

- send a smaller retry prompt
- ask for a compact graph
- limit node count
- remove decorative nodes
- require one connected topology from the main `managed_flow`
- keep the final output requirements explicit

Working retry language:

```text
Retry with a smaller graph because your last JSON failed to parse.
Keep it minimal.
Include one managed_flow with phases:
research, scaffold, derive-chunks, chunk-loop, publish, final-verify.
Allow per-run chunk drafts during execution, but publish stable files under docs/context/frameworks/three-js/<slug>.md.
Persist attached source docs onto the graph before the workflow consumes them.
Do not leave orphan executable nodes.
Do not run anything yet.
```

### 8. Execute the generated managed flow

Find the generated `managed_flow` node id from `GET /sessions/:sessionId/graph`, then call:

```json
POST /sessions/:sessionId/flows/:managedFlowNodeId/run
{}
```

To restart from scratch when a previous flow exists:

```json
POST /sessions/:sessionId/flows/:managedFlowNodeId/run
{
  "forceRestart": true
}
```

The run result includes fields such as:

- `flowId`
- `entryNodeId`
- `status`
- `launchMode`
- `currentPhaseId`
- `currentPhaseKind`

### 9. Select the right node when multiple flows exist

Do not blindly take the first `managed_flow` in the graph unless you know the session is clean.

Prefer this selection order:

1. exact title match or closest title match
2. phase shape match
3. connected stable output paths match the user request
4. most recently updated matching node

Practical check:

- inspect the candidate flow phases
- inspect publish / verify node briefs
- confirm the stable output directory matches what the user requested

## Manual apply and autoRun modes

### Manual apply lane

Use this when you want a human or supervisory agent to inspect the assistant turn before mutating the graph.

Recommended settings:

- thread `autoApply: false`
- message `autoApply: false`
- usually keep `autoRun: false`

Flow:

1. send the copilot message
2. inspect `GET /threads/:threadId`
3. if the latest assistant message is good, call:

```json
POST /sessions/:sessionId/workflow-copilot/threads/:threadId/messages/:messageId/apply
```

4. if the apply introduces a bad graph shape, restore a checkpoint:

```json
POST /sessions/:sessionId/workflow-copilot/threads/:threadId/checkpoints/:checkpointId/restore
```

### autoRun lane

Use this when you trust the copilot to emit execution intents directly.

What can be auto-executed:

- `workflow_run`
- `managed_flow_run`
- `controller_run`

When `autoRun` is on, inspect the assistant message for:

- `executions`
- `executionResults`

Keep it off by default for debugging-heavy sessions.

## Other execution lanes

### Direct workflow run

Use this when the graph already exists and you want to spawn an agent run directly instead of going through a `managed_flow`.

Body fields supported by `POST /sessions/:sessionId/workflow/run`:

- `type`
- `role` optional
- `workingDirectory` optional
- `triggerNodeId` optional
- `wakeReason` optional
- `model` optional
- `input` optional
- `inputs` optional
- `newExecution` optional

Minimal JSON example:

```json
{
  "type": "cursor_agent",
  "triggerNodeId": "step-node-id",
  "model": {
    "providerID": "cursor_agent",
    "modelID": "composer-2-fast"
  },
  "newExecution": true
}
```

Text input example:

```json
{
  "type": "cursor_agent",
  "triggerNodeId": "step-node-id",
  "inputs": {
    "global_objective": {
      "parts": [
        { "type": "text", "text": "Build a documentation pack about Three.js vanilla." }
      ]
    }
  }
}
```

### Input-template start

Use this when you know the specific template input node to fill and want the system to materialize the bound input for you.

Body fields supported by `POST /sessions/:sessionId/inputs/:nodeId/start`:

- `type`
- `role` optional
- `workingDirectory` optional
- `wakeReason` optional
- `model` optional
- `input` optional
- `sourceNodeIds` optional
- `newExecution` optional

Minimal text example:

```json
{
  "type": "cursor_agent",
  "input": {
    "parts": [
      { "type": "text", "text": "Produce a Three.js vanilla game-dev context pack." }
    ]
  },
  "newExecution": true
}
```

Use `sourceNodeIds` instead of `input` when the input should be materialized from existing graph nodes rather than direct text.

### Loop controller run

Use `POST /sessions/:sessionId/controllers/:nodeId/run` when you need to drive a `loop` controller directly.

Supported body fields:

- `requestId` optional
- `workingDirectory` optional
- `forceRestart` optional

This is especially useful if:

- a controller already exists and you want to resume it
- you want to restart a loop without rebuilding the whole `managed_flow`

### Runtime target operations

Use runtime endpoints when a workflow produced a runnable target or run node:

- `POST /sessions/:sessionId/runtime/targets/:targetNodeId/run`
- `POST /sessions/:sessionId/runtime/runs/:runNodeId/stop`
- `POST /sessions/:sessionId/runtime/runs/:runNodeId/restart`
- `GET /sessions/:sessionId/runtime/runs/:runNodeId/preview`

Use preview endpoints to verify that a runnable output actually serves something useful, not just that files exist.

## Monitoring Run Health

### Primary source: graph polling

Poll `GET /sessions/:sessionId/graph` and inspect:

- the `managed_flow` node metadata at `node.metadata.flow`
- the current loop node metadata at `node.metadata.controller`
- the current `agent_step` metadata at `node.metadata.artifacts`

### Managed flow fields worth watching

On the `managed_flow` node:

- `status`
- `currentPhaseId`
- `currentPhaseKind`
- `completedPhaseCount`
- `phaseCount`
- `waitKind`
- `waitDetail`

Useful status interpretations:

- `queued`: accepted, not yet progressed
- `running`: actively advancing phases
- `waiting`: usually waiting on a child execution, controller, or validator
- `blocked`: needs intervention
- `completed`: terminal success
- `failed`: terminal failure
- `cancelled`: terminal cancellation

### Loop-controller fields worth watching

On the `loop` node:

- `metadata.controller.status`
- `metadata.controller.totalItems`
- `metadata.controller.counts.completed`
- `metadata.controller.attemptsTotal`
- `metadata.controller.lastDecision`
- `metadata.controller.lastDecisionDetail`

Important heuristic from the validated run:

- `managed_flow.metadata.flow.status == "waiting"` with `waitKind == "controller"` is **not automatically a problem**
- if the loop node shows `metadata.controller.status == "completed"` and `counts.completed == totalItems`, the flow may still be healthy and simply about to advance to publish / verify

### Agent artifact fields worth watching

On an `agent_step` node:

- `metadata.artifacts.cwd`
- `metadata.artifacts.executionId`
- `metadata.artifacts.runId`
- `metadata.artifacts.counts`
- `metadata.artifacts.files[]`

These give direct evidence about what a phase wrote to disk.

## Approvals and blocked states

When a workflow is blocked, do not guess. Check approvals explicitly.

### Inspect pending approvals

```json
GET /sessions/:sessionId/approvals/pending
```

### Resolve an approval

```json
POST /sessions/:sessionId/approvals/:approvalId/resolve
{
  "status": "approved",
  "summary": "Approved by operator after review.",
  "resolvedByType": "human",
  "resolvedById": "operator"
}
```

Valid resolution statuses:

- `approved`
- `rejected`
- `cancelled`

Important behavior:

- approving can queue the underlying action for resumption, including runtime start or agent run continuation
- if a flow is `blocked`, approval resolution may be the correct next step instead of a force restart

## Remediation matrix

| Symptom | Likely meaning | Recommended action |
|---------|----------------|-------------------|
| assistant message `status: error`, `WORKFLOW_COPILOT_PARSE_FAILED` | Copilot generated invalid or oversized graph JSON | Retry with a smaller prompt, fewer nodes, fewer decorative elements, same final output constraints. |
| no `managed_flow` after copilot turn | Apply failed, parse failed, or prompt stayed too abstract | Inspect thread warnings/errors, then retry or manually apply if `autoApply` was off. |
| `managed_flow.status == waiting`, `waitKind == controller` | Often normal loop execution or post-loop handoff | Inspect the loop node metadata before intervening. |
| `loop.metadata.controller.status == completed` but flow still `waiting` | Usually healthy transition state | Keep polling unless it stalls abnormally long. |
| `managed_flow.status == blocked` | Human action or approval likely required | Check `GET /approvals/pending`, then inspect validator and phase metadata. |
| agent or flow enters `waiting_input` | A template input was not materialized | Use `POST /inputs/:nodeId/start` or rerun with explicit `inputs`. |
| `WORKFLOW_CONTROLLER_ALREADY_RUNNING` | Controller already active | Resume it instead of restarting, or use `forceRestart` only when safe. |
| no worker with `status: running` | Execution plane unavailable | Start or restore a worker before executing workflows. |
| copilot attachment unsupported for `cursor_agent` | Non-inlineable MIME type or too much attachment data | Switch to text/json attachments, reduce size, or use another agent type. |
| flow `completed` but final artifact tree is wrong | Publish phase or validator was too weak | Inspect stable outputs directly, then tighten publish instructions or validator checks and rerun. |
| flow topology looks disconnected or contains orphan executable nodes | Structured refs were incomplete or edge materialization was too weak | Inspect `managed_flow` phases, file-context nodes, and orphan step nodes before running. Regenerate with a stricter topology checklist if needed. |

## Final Validation Checklist

Do not stop at `flow.status == "completed"`. Also validate the workspace contents directly.

Recommended checks:

1. `outputs/verify.txt` exists and its last line is exactly `VERIFY_OK`
2. the stable published directory exists
3. the final README points to stable published files first
4. the manifest remains coherent with the published outputs
5. the workspace is not relying only on `outputs/run-*` directories as the final handoff
6. source-of-truth docs were persisted onto the graph and linked to the phases that consume them
7. no orphan executable nodes (`agent_step`, `loop`, `sub_graph`, `decision`, `runtime_target`, `managed_flow`) remain outside the intended flow

In the validated `Three.js` example, the final success signal was:

- `outputs/verify.txt` ended with `VERIFY_OK`
- `docs/context/frameworks/three-js/` existed
- the stable slug files matched the manifest
- `docs/context/frameworks/README.md` linked to the stable files first

## Minimal Python Skeleton

```python
import json
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:31947/api/v1"

def req(method, path, data=None, wrapped=True):
    body = None
    headers = {"Content-Type": "application/json"}
    if data is not None:
        body = json.dumps(data).encode()
    r = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=180) as resp:
        raw = json.loads(resp.read().decode())
    return raw["data"] if wrapped else raw

workers = req("GET", "/execution/workers", wrapped=False)
assert any(w.get("status") == "running" for w in workers), "No running worker"

session = req("POST", "/sessions", {"name": "API skill demo"})
sid = session["id"]

workspace = req(
    "PATCH",
    f"/sessions/{sid}/workspace",
    {
        "parentDirectory": "/Users/me/Documents",
        "directoryName": "api-skill-demo",
    },
)
wd = Path(workspace["workspace"]["workingDirectory"])

thread = req(
    "POST",
    f"/sessions/{sid}/workflow-copilot/thread",
    {
        "surface": "sidebar",
        "title": "Workflow generation",
        "scope": {"kind": "session"},
        "mode": "edit",
        "agentType": "cursor_agent",
        "model": {"providerID": "cursor_agent", "modelID": "composer-2-fast"},
        "autoApply": True,
        "autoRun": False,
    },
)
tid = thread["thread"]["id"]

prompt = """Create a workflow that builds a multi-file documentation pack about Three.js vanilla for game development, not React Three Fiber. Use only cursor_agent with composer-2-fast. Generate the workflow now, but do not run it yet. Require research, scaffold, derive_input, loop with per-run drafts, cleanup/publish to docs/context/frameworks/three-js/<slug>.md, and final runtime_verify_phase that writes outputs/verify.txt ending with VERIFY_OK."""

req(
    "POST",
    f"/sessions/{sid}/workflow-copilot/threads/{tid}/messages",
    {
        "content": prompt,
        "agentType": "cursor_agent",
        "model": {"providerID": "cursor_agent", "modelID": "composer-2-fast"},
        "autoApply": True,
        "autoRun": False,
    },
)

thread_state = req("GET", f"/sessions/{sid}/workflow-copilot/threads/{tid}")
assistant = thread_state["messages"][-1]
assert assistant["role"] == "assistant"
assert assistant["status"] == "completed", assistant.get("error")

graph = req("GET", f"/sessions/{sid}/graph")
flows = [n for n in graph["nodes"] if n["type"] == "managed_flow"]
assert flows, "No managed_flow generated"
flow_node_id = flows[0]["id"]

run = req("POST", f"/sessions/{sid}/flows/{flow_node_id}/run", {})
print("started", run)

while True:
    graph = req("GET", f"/sessions/{sid}/graph")
    flow = next(n for n in graph["nodes"] if n["id"] == flow_node_id)
    meta = flow.get("metadata", {}).get("flow", {})
    print(meta)
    if meta.get("status") in {"completed", "failed", "cancelled"}:
        break
    time.sleep(10)

verify = wd / "outputs" / "verify.txt"
if verify.exists():
    print(verify.read_text())
```

## Validated Example To Reuse

If you want a ready-made prompt/example pair to hand to another agent:

- prompt pattern: [`three-js-vanilla-clean-return.md`](three-js-vanilla-clean-return.md)
- this operator runbook: [`workflow-copilot-api-skill.md`](workflow-copilot-api-skill.md)

Together they are enough for an agent to:

- generate the workflow
- retry if the copilot parse fails
- execute the generated `managed_flow`
- monitor the loop and publish phases
- validate the final stable artifact tree
