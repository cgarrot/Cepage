#!/usr/bin/env node
// scaffold-from-skill.mjs
//
// Generic CLI helper for the `POST /api/v1/sessions/from-skill/:skillId`
// endpoint. Bootstraps a fresh cepage session by:
//   1. validating the skill exists in the catalog,
//   2. (optionally) configuring a workspace + seeding files & directories,
//   3. EITHER importing an inline workflow_transfer JSON
//      OR starting a workflow-copilot architect thread that drafts
//      and applies the graph from the skill prompt,
//   4. (optionally) pinning a target agent on every agent_step,
//   5. (optionally) auto-running the first managed_flow.
//
// This script is fully generic: it does NOT know anything about a
// specific skill. The caller drives the behaviour via flags + a small
// JSON config.
//
// Usage:
//   node scripts/scaffold-from-skill.mjs --skill-id <id> [options]
//
// Options:
//   --skill-id <id>            (required) workflow skill id from the catalog
//   --api-url <url>            cepage API base URL
//                              (default: $NEXT_PUBLIC_API_URL or http://localhost:31947)
//   --name <str>               session name (default: "<skill title> — <iso>")
//   --workspace-parent <dir>   absolute path of the workspace parent
//                              (server-side path; in docker mode this is the
//                              path INSIDE the api container, e.g. /workspaces)
//   --workspace-name <slug>    leaf directory name under the parent
//   --mode <kind>              "copilot" | "workflow-transfer" | "empty"
//                              (default: "copilot" if --copilot-* set,
//                              "workflow-transfer" if --workflow-transfer-file,
//                              else "empty")
//   --copilot-message <str>    architect prompt (default: skill-driven)
//   --copilot-title <str>      copilot thread title
//   --copilot-no-auto-apply    disable auto-apply of generated graphs
//   --copilot-auto-run         ask copilot to start the flow after apply
//   --workflow-transfer-file <path>  path to a workflow JSON to import as-is
//   --agent-type <type>        e.g. cursor_agent | opencode
//   --agent-provider <id>      e.g. cursor | zai-coding-plan
//   --agent-model <id>         e.g. composer-2-fast | glm-5-turbo
//   --seed-file <ws-rel>=<host-path>   write contents of host file to ws-rel
//                                       (repeat as many times as needed)
//   --seed-dir  <ws-rel>=<host-dir>    copy host directory to ws-rel
//                                       (repeat as many times as needed)
//   --auto-run                 start the first managed_flow after scaffold
//   --output-json <path>       write the result JSON to this path
//   --dry-run                  print the request body and exit (no API call)
//   --verbose                  extra logging
//
// Examples:
//   # 1) Generic skill -> copilot architect, then auto-run.
//   node scripts/scaffold-from-skill.mjs \
//     --skill-id three-js-vanilla-clean-return \
//     --auto-run
//
//   # 2) Skill + caller-built workflow_transfer JSON, pinned agent.
//   node scripts/scaffold-from-skill.mjs \
//     --skill-id private-daily-drop \
//     --workflow-transfer-file /tmp/daily-drop.json \
//     --agent-type opencode --agent-provider zai-coding-plan --agent-model glm-5-turbo \
//     --workspace-parent /workspaces --workspace-name daily-drop-$(date +%s) \
//     --auto-run
//

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = {
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:31947',
    skillId: null,
    name: null,
    workspaceParent: null,
    workspaceName: null,
    mode: null,
    copilot: { message: null, title: null, autoApply: true, autoRun: false },
    workflowTransferFile: null,
    agent: { agentType: null, providerID: null, modelID: null },
    seedFiles: [],
    seedDirs: [],
    autoRun: false,
    outputJson: null,
    dryRun: false,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--api-url':                  args.apiUrl = next(); break;
      case '--skill-id':                 args.skillId = next(); break;
      case '--name':                     args.name = next(); break;
      case '--workspace-parent':         args.workspaceParent = next(); break;
      case '--workspace-name':           args.workspaceName = next(); break;
      case '--mode':                     args.mode = next(); break;
      case '--copilot-message':          args.copilot.message = next(); break;
      case '--copilot-title':            args.copilot.title = next(); break;
      case '--copilot-no-auto-apply':    args.copilot.autoApply = false; break;
      case '--copilot-auto-run':         args.copilot.autoRun = true; break;
      case '--workflow-transfer-file':   args.workflowTransferFile = path.resolve(next()); break;
      case '--agent-type':               args.agent.agentType = next(); break;
      case '--agent-provider':           args.agent.providerID = next(); break;
      case '--agent-model':              args.agent.modelID = next(); break;
      case '--seed-file': {
        const raw = next();
        const eq = raw.indexOf('=');
        if (eq < 0) throw new Error(`--seed-file expects ws-rel=host-path, got "${raw}"`);
        args.seedFiles.push({ wsRel: raw.slice(0, eq).trim(), hostPath: path.resolve(raw.slice(eq + 1).trim()) });
        break;
      }
      case '--seed-dir': {
        const raw = next();
        const eq = raw.indexOf('=');
        if (eq < 0) throw new Error(`--seed-dir expects ws-rel=host-dir, got "${raw}"`);
        args.seedDirs.push({ wsRel: raw.slice(0, eq).trim(), hostPath: path.resolve(raw.slice(eq + 1).trim()) });
        break;
      }
      case '--auto-run':                 args.autoRun = true; break;
      case '--output-json':              args.outputJson = path.resolve(next()); break;
      case '--dry-run':                  args.dryRun = true; break;
      case '--verbose':                  args.verbose = true; break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!args.skillId) {
    throw new Error('Missing required --skill-id');
  }
  if (!args.mode) {
    if (args.workflowTransferFile) args.mode = 'workflow-transfer';
    else if (args.copilot.message || args.copilot.title) args.mode = 'copilot';
    else args.mode = 'copilot';
  }
  if (!['copilot', 'workflow-transfer', 'empty'].includes(args.mode)) {
    throw new Error(`--mode must be one of: copilot | workflow-transfer | empty`);
  }
  if (args.mode === 'workflow-transfer' && !args.workflowTransferFile) {
    throw new Error('--mode=workflow-transfer requires --workflow-transfer-file');
  }
  if (args.agent.agentType || args.agent.providerID || args.agent.modelID) {
    if (!(args.agent.agentType && args.agent.providerID && args.agent.modelID)) {
      throw new Error('--agent-type, --agent-provider and --agent-model must be set together');
    }
  } else {
    args.agent = null;
  }
  return args;
}

function printHelp() {
  console.log([
    'Usage: node scripts/scaffold-from-skill.mjs --skill-id <id> [options]',
    '',
    'See file header for full option reference.',
  ].join('\n'));
}

function info(...parts) { console.log('[from-skill]', ...parts); }
function debug(args, ...parts) { if (args.verbose) console.log('[from-skill][dbg]', ...parts); }

async function loadSeedFiles(spec) {
  const out = [];
  for (const entry of spec) {
    if (!existsSync(entry.hostPath)) {
      throw new Error(`--seed-file source missing: ${entry.hostPath}`);
    }
    const content = await fs.readFile(entry.hostPath, 'utf8');
    out.push({ path: entry.wsRel, content });
  }
  return out;
}

function buildSeedDirectories(spec) {
  return spec.map((entry) => {
    if (!existsSync(entry.hostPath)) {
      throw new Error(`--seed-dir source missing: ${entry.hostPath}`);
    }
    return { source: entry.hostPath, destination: entry.wsRel };
  });
}

async function buildBody(args) {
  const body = {};
  if (args.name) body.name = args.name;
  if (args.workspaceParent || args.workspaceName) {
    body.workspace = {};
    if (args.workspaceParent) body.workspace.parentDirectory = args.workspaceParent;
    if (args.workspaceName) body.workspace.directoryName = args.workspaceName;
  }
  const files = await loadSeedFiles(args.seedFiles);
  const directories = buildSeedDirectories(args.seedDirs);
  if (files.length > 0 || directories.length > 0) {
    body.seed = {};
    if (files.length > 0) body.seed.files = files;
    if (directories.length > 0) body.seed.directories = directories;
  }
  if (args.agent) body.agent = args.agent;
  if (args.mode === 'workflow-transfer') {
    const raw = await fs.readFile(args.workflowTransferFile, 'utf8');
    body.workflowTransfer = JSON.parse(raw);
  } else if (args.mode === 'copilot') {
    body.copilot = {
      autoApply: args.copilot.autoApply,
      autoRun: args.copilot.autoRun,
    };
    if (args.copilot.title) body.copilot.title = args.copilot.title;
    if (args.copilot.message) body.copilot.message = args.copilot.message;
  }
  body.autoRun = args.autoRun;
  return body;
}

async function callApi(args, body) {
  const url = `${args.apiUrl}/api/v1/sessions/from-skill/${encodeURIComponent(args.skillId)}`;
  debug(args, 'POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!res.ok) {
    const detail = parsed?.error?.message ?? text ?? res.statusText;
    throw new Error(`API ${res.status}: ${detail}`);
  }
  if (!parsed || parsed.success !== true) {
    throw new Error(`Invalid API response: ${text.slice(0, 500)}`);
  }
  return parsed.data;
}

async function main() {
  const args = parseArgs(process.argv);
  info(`skill=${args.skillId} mode=${args.mode} api=${args.apiUrl}`);
  const body = await buildBody(args);
  if (args.verbose) debug(args, 'request body:', JSON.stringify(body, null, 2));

  if (args.dryRun) {
    info('--dry-run: not calling the API. Body that would be sent:');
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const data = await callApi(args, body);
  info(`session=${data.sessionId} mode=${data.mode}${data.workspaceDir ? ` workspace=${data.workspaceDir}` : ''}`);
  if (data.threadId) info(`copilot thread=${data.threadId}`);
  if (data.flowNodeId) info(`flowNodeId=${data.flowNodeId}`);
  if (data.flowId) info(`flow started id=${data.flowId} status=${data.flowStatus ?? '-'}`);

  console.log(JSON.stringify(data, null, 2));

  if (args.outputJson) {
    await fs.mkdir(path.dirname(args.outputJson), { recursive: true });
    await fs.writeFile(args.outputJson, JSON.stringify(data, null, 2), 'utf8');
    info(`summary written to ${args.outputJson}`);
  }
}

main().catch((err) => {
  console.error('[from-skill] error:', err.message ?? err);
  process.exitCode = 1;
});
