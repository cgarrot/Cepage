import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REAL_WORKFLOW_TEST_SCENARIOS as PUBLIC_REAL_WORKFLOW_TEST_SCENARIOS,
} from './workflow-real-tester-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(repoRoot, 'docs', 'workflow-prompt-library', 'catalog.json');
const terminalStatuses = new Set(['completed', 'failed', 'blocked', 'cancelled']);
let workflowTestScenarios = { ...PUBLIC_REAL_WORKFLOW_TEST_SCENARIOS };

function apiErr(code, message, details = undefined) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
}

async function parseApiResponse(response) {
  const text = await response.text();
  let parsed;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    return parsed;
  }
  if (!response.ok) {
    return apiErr(`HTTP_${response.status}`, text || response.statusText || 'Request failed', {
      status: response.status,
    });
  }
  return apiErr('INVALID_API_RESPONSE', text || response.statusText || 'Invalid API response');
}

async function apiRequest(method, apiUrl, route, body = undefined) {
  try {
    const response = await fetch(`${apiUrl}${route}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parseApiResponse(response);
  } catch (error) {
    return apiErr('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
  }
}

function createSession(apiUrl, name) {
  return apiRequest('POST', apiUrl, '/api/v1/sessions', { name });
}

function patchSessionStatus(apiUrl, sessionId, status) {
  return apiRequest('PATCH', apiUrl, `/api/v1/sessions/${sessionId}`, { status });
}

function updateSessionWorkspace(apiUrl, sessionId, body) {
  return apiRequest('PATCH', apiUrl, `/api/v1/sessions/${sessionId}/workspace`, body);
}

function ensureWorkflowCopilotThread(apiUrl, sessionId, body) {
  return apiRequest('POST', apiUrl, `/api/v1/sessions/${sessionId}/workflow-copilot/thread`, body);
}

function sendWorkflowCopilotMessage(apiUrl, sessionId, threadId, body) {
  return apiRequest(
    'POST',
    apiUrl,
    `/api/v1/sessions/${sessionId}/workflow-copilot/threads/${threadId}/messages`,
    body,
  );
}

function getGraphBundle(apiUrl, sessionId) {
  return apiRequest('GET', apiUrl, `/api/v1/sessions/${sessionId}/graph`);
}

function importWorkflow(apiUrl, sessionId, body) {
  return apiRequest('POST', apiUrl, `/api/v1/sessions/${sessionId}/workflow/import`, body);
}

function getAgentCatalog(apiUrl, sessionId) {
  return apiRequest('GET', apiUrl, `/api/v1/sessions/${sessionId}/agents/catalog`);
}

function runWorkflowFlow(apiUrl, sessionId, nodeId, body) {
  return apiRequest('POST', apiUrl, `/api/v1/sessions/${sessionId}/flows/${nodeId}/run`, body);
}

function getAgentRunArtifacts(apiUrl, sessionId, runId) {
  return apiRequest('GET', apiUrl, `/api/v1/sessions/${sessionId}/agents/${runId}/artifacts`);
}

function parseArgs(argv) {
  const args = {
    apiUrl: process.env.WORKFLOW_TESTER_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:31947',
    reportDir: process.env.WORKFLOW_TESTER_REPORT_DIR ?? path.join(repoRoot, 'status', 'workflow-real-tests'),
    workspaceRoot: process.env.WORKFLOW_TESTER_WORKSPACE_ROOT ?? path.join(repoRoot, 'status', 'workflow-real-tests', 'workspaces'),
    timeoutMs: Number.parseInt(process.env.WORKFLOW_TESTER_TIMEOUT_MS ?? '900000', 10),
    pollMs: Number.parseInt(process.env.WORKFLOW_TESTER_POLL_MS ?? '5000', 10),
    targets: ['cursor', 'opencode'],
    skills: [],
    keepSessions: false,
    dryRun: false,
    list: false,
    probe: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--api-url') args.apiUrl = argv[++i];
    else if (arg === '--report-dir') args.reportDir = path.resolve(argv[++i]);
    else if (arg === '--workspace-root') args.workspaceRoot = path.resolve(argv[++i]);
    else if (arg === '--timeout-ms') args.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (arg === '--poll-ms') args.pollMs = Number.parseInt(argv[++i], 10);
    else if (arg === '--targets') args.targets = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--skills') args.skills = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--keep-sessions') args.keepSessions = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--probe') args.probe = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  process.env.NEXT_PUBLIC_API_URL = args.apiUrl;
  return args;
}

function printHelp() {
  console.log(
    [
      'Usage: pnpm workflow:test:real -- [options]',
      '       node scripts/workflow-real-tester.mjs [options]',
      '',
      'Options:',
      '  --api-url <url>          API base URL (default: http://localhost:31947)',
      '  --targets <ids>          Comma-separated target ids: cursor,opencode',
      '  --skills <ids>           Comma-separated workflow skill ids to run',
      '  --workspace-root <dir>   Root directory for session workspaces',
      '  --report-dir <dir>       Directory for JSON and Markdown reports',
      '  --timeout-ms <n>         Max duration per workflow run',
      '  --poll-ms <n>            Poll interval while waiting for flow completion',
      '  --keep-sessions          Do not archive sessions after the run',
      '  --dry-run                Validate local coverage without calling the API',
      '  --list                   Print workflow scenarios and exit',
      '  --probe                  Hit the live API and resolve the requested models only',
      '',
      'Environment overrides:',
      '  WORKFLOW_TESTER_CURSOR_PROVIDER / WORKFLOW_TESTER_CURSOR_MODEL',
      '  WORKFLOW_TESTER_OPENCODE_PROVIDER / WORKFLOW_TESTER_OPENCODE_MODEL',
    ].join('\n'),
  );
}

function norm(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return norm(value).split(' ').filter(Boolean);
}

function hasAllTokens(value, hint) {
  const hay = norm(value);
  return tokens(hint).every((token) => hay.includes(token));
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function unwrap(response, label) {
  if (!response.success) {
    throw new Error(`${label}: ${response.error.code} ${response.error.message}`);
  }
  return response.data;
}

async function readCatalog() {
  const merged = [];

  const text = await fs.readFile(catalogPath, 'utf8');
  const json = JSON.parse(text);
  merged.push(...json.skills.filter((skill) => skill.kind === 'workflow_template'));

  const privateCatalogPath = path.join(repoRoot, 'docs', 'workflow-prompt-library', 'private', 'catalog.json');
  try {
    const privateText = await fs.readFile(privateCatalogPath, 'utf8');
    const privateJson = JSON.parse(privateText);
    merged.push(...privateJson.skills.filter((skill) => skill.kind === 'workflow_template'));
  } catch {
    // public-only mode is valid
  }

  return merged;
}

function resolveWorkflowLibraryRoot() {
  return path.resolve(
    process.env.WORKFLOW_TESTER_LIBRARY_ROOT ?? path.join(repoRoot, '..', 'workflow-librairy-v1'),
  );
}

async function loadWorkflowArtifact(importPath) {
  if (importPath.endsWith('.mjs') || importPath.endsWith('.js')) {
    const mod = await import(pathToFileURL(importPath).href);
    return mod.default ?? mod.workflow ?? mod;
  }
  return JSON.parse(await fs.readFile(importPath, 'utf8'));
}

function ensureScenarioCoverage(skills) {
  const missing = skills
    .map((skill) => skill.id)
    .filter((id) => !(id in workflowTestScenarios));
  if (missing.length > 0) {
    throw new Error(`Missing real test scenarios for workflow templates: ${missing.join(', ')}`);
  }
}

async function loadWorkflowTestScenarios() {
  const privateScenarioPath = path.join(
    repoRoot,
    'docs',
    'workflow-prompt-library',
    'private',
    'e2e-scenarios.mjs',
  );

  try {
    await fs.access(privateScenarioPath);
  } catch {
    return { ...PUBLIC_REAL_WORKFLOW_TEST_SCENARIOS };
  }

  const mod = await import(pathToFileURL(privateScenarioPath).href);
  return {
    ...PUBLIC_REAL_WORKFLOW_TEST_SCENARIOS,
    ...(mod.PRIVATE_REAL_WORKFLOW_TEST_SCENARIOS ?? {}),
  };
}

function buildTargetDefs() {
  return {
    cursor: {
      id: 'cursor',
      label: 'Cursor Composer 2 Fast',
      agentType: 'cursor_agent',
      providerExact: process.env.WORKFLOW_TESTER_CURSOR_PROVIDER ?? 'cursor',
      modelExact: process.env.WORKFLOW_TESTER_CURSOR_MODEL ?? 'composer-2-fast',
      providerHints: ['cursor'],
      modelHints: ['composer-2-fast', 'composer 2 fast', 'composer2fast'],
    },
    opencode: {
      id: 'opencode',
      label: 'OpenCode z.ai GLM-5 Turbo',
      agentType: 'opencode',
      providerExact: process.env.WORKFLOW_TESTER_OPENCODE_PROVIDER ?? 'zai-coding-plan',
      modelExact: process.env.WORKFLOW_TESTER_OPENCODE_MODEL ?? 'glm-5-turbo',
      providerHints: [
        process.env.WORKFLOW_TESTER_OPENCODE_PROVIDER ?? '',
        'z ai',
        'z-ai',
        'z.ai',
        'zai',
        'zhipu',
      ].filter(Boolean),
      modelHints: [
        process.env.WORKFLOW_TESTER_OPENCODE_MODEL ?? '',
        'glm-5-turbo',
        'glm 5 turbo',
      ].filter(Boolean),
    },
  };
}

function flattenCatalog(catalog, agentType) {
  return catalog.providers
    .filter((provider) => provider.agentType === agentType)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        agentType,
        providerID: model.providerID,
        providerLabel: provider.label,
        modelID: model.modelID,
        modelLabel: model.label,
      })),
    );
}

function resolveTarget(catalog, target) {
  const rows = flattenCatalog(catalog, target.agentType);
  if (rows.length === 0) {
    throw new Error(`No catalog rows found for agent type ${target.agentType}`);
  }

  const exact = rows.find(
    (row) =>
      target.providerExact
      && target.modelExact
      && norm(row.providerID) === norm(target.providerExact)
      && norm(row.modelID) === norm(target.modelExact),
  );
  if (exact) {
    return {
      id: target.id,
      label: target.label,
      agentType: target.agentType,
      providerID: exact.providerID,
      modelID: exact.modelID,
    };
  }

  const scored = rows
    .map((row) => {
      let score = 0;
      if (target.providerExact && norm(row.providerID) === norm(target.providerExact)) score += 40;
      if (target.modelExact && norm(row.modelID) === norm(target.modelExact)) score += 50;
      for (const hint of target.providerHints) {
        if (hasAllTokens(row.providerID, hint) || hasAllTokens(row.providerLabel, hint)) score += 12;
      }
      for (const hint of target.modelHints) {
        if (norm(row.modelID) === norm(hint)) score += 30;
        else if (hasAllTokens(row.modelID, hint) || hasAllTokens(row.modelLabel, hint)) score += 16;
      }
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.row.modelID.localeCompare(b.row.modelID));

  const best = scored[0];
  const second = scored[1];
  if (!best) {
    throw new Error(`Could not resolve target ${target.id} in the live agent catalog.`);
  }
  if (second && second.score === best.score) {
    throw new Error(
      `Target ${target.id} is ambiguous between ${best.row.providerID}/${best.row.modelID} and ${second.row.providerID}/${second.row.modelID}.`,
    );
  }

  return {
    id: target.id,
    label: target.label,
    agentType: target.agentType,
    providerID: best.row.providerID,
    modelID: best.row.modelID,
  };
}

function pinImportedWorkflow(flow, target) {
  const next = structuredClone(flow);
  for (const node of next.graph?.nodes ?? []) {
    if (node.type === 'agent_step' || node.type === 'agent_spawn') {
      node.content = {
        ...(node.content ?? {}),
        agentType: target.agentType,
        model: {
          providerID: target.providerID,
          modelID: target.modelID,
        },
        agentSelection: {
          mode: 'locked',
          selection: {
            type: target.agentType,
            model: {
              providerID: target.providerID,
              modelID: target.modelID,
            },
          },
        },
      };
      continue;
    }
    if (node.type === 'sub_graph') {
      node.content = {
        ...(node.content ?? {}),
        execution: {
          ...((node.content ?? {}).execution ?? {}),
          type: target.agentType,
          model: {
            providerID: target.providerID,
            modelID: target.modelID,
          },
        },
      };
    }
  }
  return next;
}

async function mkdirp(target) {
  await fs.mkdir(target, { recursive: true });
}

async function writeScenarioFiles(workspaceDir, files) {
  for (const file of files) {
    const absolute = path.join(workspaceDir, file.path);
    await mkdirp(path.dirname(absolute));
    if (file.kind === 'base64') {
      await fs.writeFile(absolute, Buffer.from(file.content, 'base64'));
      continue;
    }
    if (file.kind === 'copy_file') {
      await fs.copyFile(file.sourcePath, absolute);
      continue;
    }
    if (file.kind === 'copy_dir') {
      await fs.cp(file.sourcePath, absolute, { recursive: true });
      continue;
    }
    await fs.writeFile(absolute, file.content, 'utf8');
  }
}

function latestManagedFlow(bundle, createdNodeIds) {
  const nodes = bundle.nodes.filter((node) => node.type === 'managed_flow');
  const created = nodes.filter((node) => createdNodeIds.includes(node.id));
  const pool = created.length > 0 ? created : nodes;
  return pool.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function latestRunId(flow) {
  const ids = Object.values(flow?.phaseRecords ?? {})
    .map((record) => record?.runId)
    .filter(Boolean);
  return ids.at(-1) ?? null;
}

function renderSeedFiles(files) {
  return files
    .map((file) => {
      const lines = [`Path: ${file.path}`];
      if (file.summary) lines.push(`Summary: ${file.summary}`);
      if (file.kind === 'text') {
        lines.push('Content:');
        lines.push(file.content.trim());
      } else if (file.kind === 'copy_file' || file.kind === 'copy_dir') {
        lines.push(`Workspace fixture copied from: ${file.sourcePath}`);
        if (file.kind === 'copy_dir') {
          lines.push('Content is a recursively copied directory fixture.');
        }
      } else {
        lines.push(`Binary fixture: ${file.summary ?? 'See workspace file.'}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

async function resolveScenarioFiles(scenario, context) {
  if (typeof scenario.files === 'function') {
    return await scenario.files(context);
  }
  return scenario.files ?? [];
}

function buildSeedPrompt(skill, scenario, files) {
  if (typeof scenario.prompt === 'function') {
    return scenario.prompt({
      skill,
      files: renderSeedFiles(files),
    });
  }
  if (typeof scenario.routePrompt === 'string' && scenario.routePrompt.trim().length > 0) {
    return scenario.routePrompt.trim();
  }
  return [
    `Use the pinned workflow ${skill.id}.`,
    'Use the existing workspace files as the source material.',
    renderSeedFiles(files),
  ].filter(Boolean).join('\n\n');
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function applyPlaceholders(value, context) {
  return String(value)
    .replaceAll('{{workspaceDir}}', context.workspaceDir ?? '')
    .replaceAll('{{workflowLibraryRoot}}', context.workflowLibraryRoot ?? '')
    .replaceAll('{{serviceUrl}}', context.serviceUrl ?? '')
    .replaceAll('{{serviceReady}}', context.serviceReady ?? '');
}

async function startScenarioService(service, context) {
  if (!service) {
    return null;
  }
  if (typeof service.url === 'string' && service.url.trim().length > 0) {
    return {
      child: null,
      readyValue: applyPlaceholders(service.url, context),
      stdout: '',
      stderr: '',
    };
  }
  const command = applyPlaceholders(service.command ?? process.execPath, context);
  const args = (
    service.scriptPath
      ? [path.resolve(context.workflowLibraryRoot, service.scriptPath), ...(service.args ?? [])]
      : (service.args ?? [])
  ).map((value) => applyPlaceholders(value, context));
  const env = Object.fromEntries(
    Object.entries(service.env ?? {}).map(([key, value]) => [key, applyPlaceholders(value, context)]),
  );
  const child = spawn(command, args, {
    cwd: service.cwd ? applyPlaceholders(service.cwd, context) : context.workspaceDir,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const readyPattern = service.readyPattern instanceof RegExp
    ? service.readyPattern
    : new RegExp(service.readyPattern ?? '^READY\\s+(\\S+)$', 'm');
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Service did not become ready. stderr: ${stderr.trim() || '(empty)'}`));
    }, service.timeoutMs ?? 30_000);
    const finalize = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill('SIGTERM');
        reject(error);
        return;
      }
      const match = `${stdout}\n${stderr}`.match(readyPattern);
      resolve({
        child,
        readyValue: match?.[1] ?? '',
        stdout,
        stderr,
      });
    };
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (readyPattern.test(stdout)) {
        finalize(null);
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (readyPattern.test(stderr) || readyPattern.test(`${stdout}\n${stderr}`)) {
        finalize(null);
      }
    });
    child.on('error', (error) => finalize(error));
    child.on('exit', (code) => {
      if (settled) return;
      finalize(new Error(`Service exited before ready with code ${String(code ?? 'unknown')}. ${stderr.trim()}`));
    });
  });
}

async function stopScenarioService(handle) {
  if (!handle?.child || handle.child.killed) {
    return;
  }
  await new Promise((resolve) => {
    handle.child.once('exit', () => resolve());
    handle.child.kill('SIGTERM');
    setTimeout(() => {
      if (!handle.child.killed) {
        handle.child.kill('SIGKILL');
      }
      resolve();
    }, 2_000).unref();
  });
}

async function pollFlow(apiUrl, sessionId, flowId, entryNodeId, timeoutMs, pollMs) {
  const started = Date.now();
  let lastBundle = null;
  let lastFlow = null;
  while (Date.now() - started < timeoutMs) {
    const bundle = unwrap(await getGraphBundle(apiUrl, sessionId), 'getGraphBundle');
    const flow =
      (bundle.workflowFlows ?? []).find((item) => item.id === flowId)
      ?? (bundle.workflowFlows ?? []).find((item) => item.entryNodeId === entryNodeId)
      ?? null;
    lastBundle = bundle;
    lastFlow = flow;
    if (flow && terminalStatuses.has(flow.status)) {
      return { bundle, flow, timedOut: false, elapsedMs: Date.now() - started };
    }
    await sleep(pollMs);
  }
  return {
    bundle: lastBundle,
    flow: lastFlow,
    timedOut: true,
    elapsedMs: Date.now() - started,
  };
}

async function validateOutputs(workspaceDir, expectedOutputs, extraChecks) {
  const checks = [];
  for (const relativePath of expectedOutputs) {
    const absolutePath = path.join(workspaceDir, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      checks.push({
        kind: 'file_exists',
        path: relativePath,
        ok: stat.isFile(),
      });
      if (stat.isFile()) {
        checks.push({
          kind: 'file_nonempty',
          path: relativePath,
          ok: stat.size > 0,
        });
      }
    } catch {
      checks.push({
        kind: 'file_exists',
        path: relativePath,
        ok: false,
      });
      continue;
    }
  }

  for (const check of extraChecks) {
    const absolutePath = path.join(workspaceDir, check.path);
    try {
      const text = await fs.readFile(absolutePath, 'utf8');
      if (check.kind === 'text_includes') {
        checks.push({
          kind: check.kind,
          path: check.path,
          ok: text.toLowerCase().includes(check.needle.toLowerCase()),
          detail: check.needle,
        });
      } else if (check.kind === 'json_parse') {
        JSON.parse(text);
        checks.push({
          kind: check.kind,
          path: check.path,
          ok: true,
        });
      }
    } catch (error) {
      checks.push({
        kind: check.kind,
        path: check.path,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return checks;
}

function validateGraph(bundle, flowNode, flow, expectedOutputs) {
  const declared = new Set(
    bundle.nodes
      .filter((node) => node.type === 'workspace_file')
      .map((node) => node.content?.relativePath)
      .filter(Boolean),
  );
  const checks = [
    {
      kind: 'flow_node_exists',
      ok: Boolean(flowNode),
    },
    {
      kind: 'flow_completed',
      ok: flow?.status === 'completed',
      detail: flow?.status ?? 'missing',
    },
    {
      kind: 'no_pending_approvals',
      ok: (bundle.pendingApprovals ?? []).length === 0,
      detail: String((bundle.pendingApprovals ?? []).length),
    },
  ];
  for (const output of expectedOutputs) {
    checks.push({
      kind: 'output_declared',
      ok: declared.has(output),
      detail: output,
    });
  }
  return checks;
}

function buildSummaryMarkdown(report) {
  const lines = [
    '# Workflow Real Tester',
    '',
    `Generated at: ${report.generatedAt}`,
    `API: ${report.apiUrl}`,
    `Pass: ${report.summary.pass}`,
    `Fail: ${report.summary.fail}`,
    '',
    '| Workflow | Target | Result | Flow status | Workspace |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const result of report.results) {
    lines.push(
      `| ${result.skillId} | ${result.targetId} | ${result.ok ? 'pass' : 'fail'} | ${result.flowStatus ?? 'n/a'} | ${result.workspaceDir} |`,
    );
  }
  return lines.join('\n') + '\n';
}

async function finalizeSession(apiUrl, sessionId, keepSessions) {
  if (keepSessions) return;
  try {
    await patchSessionStatus(apiUrl, sessionId, 'archived');
  } catch {
    // best-effort cleanup; the test result is what matters.
  }
}

async function runScenario(skill, scenario, target, opts) {
  const session = unwrap(
    await createSession(opts.apiUrl, `workflow-real-${skill.id}-${target.id}-${Date.now()}`),
    'createSession',
  );
  let serviceHandle = null;
  try {
    const workspace = unwrap(
      await updateSessionWorkspace(opts.apiUrl, session.id, {
        parentDirectory: opts.workspaceRoot,
        directoryName: `${slug(skill.id)}-${slug(target.id)}-${nowStamp()}`,
      }),
      'updateSessionWorkspace',
    );
    const workspaceDir = workspace.workspace?.workingDirectory;
    if (!workspaceDir) {
      throw new Error('Workspace was not configured for the session.');
    }
    await fs.mkdir(workspaceDir, { recursive: true });

    const workflowLibraryRoot = resolveWorkflowLibraryRoot();
    serviceHandle = await startScenarioService(scenario.service, {
      workspaceDir,
      workflowLibraryRoot,
    });
    const files = await resolveScenarioFiles(scenario, {
      skill,
      workspaceDir,
      workflowLibraryRoot,
      serviceUrl: serviceHandle?.readyValue ?? '',
      serviceReady: serviceHandle?.readyValue ?? '',
    });
    await writeScenarioFiles(workspaceDir, files);

    let flowNode;
    let started;
    let thread = null;
    let send = null;

    if (scenario.importWorkflowPath) {
      const importPath = path.resolve(workflowLibraryRoot, scenario.importWorkflowPath);
      const imported = await loadWorkflowArtifact(importPath);
      const pinned = pinImportedWorkflow(imported, target);
      unwrap(await importWorkflow(opts.apiUrl, session.id, pinned), 'importWorkflow');
      const bundle = unwrap(await getGraphBundle(opts.apiUrl, session.id), 'getGraphBundle');
      flowNode = latestManagedFlow(bundle, []);
      if (!flowNode) {
        throw new Error('No managed_flow node was found after workflow import.');
      }
      started = unwrap(await runWorkflowFlow(opts.apiUrl, session.id, flowNode.id, {}), 'runWorkflowFlow');
    } else {
      thread = unwrap(
        await ensureWorkflowCopilotThread(opts.apiUrl, session.id, {
          surface: 'sidebar',
          scope: { kind: 'session' },
          mode: 'edit',
          autoApply: true,
          autoRun: false,
          agentType: target.agentType,
          model: {
            providerID: target.providerID,
            modelID: target.modelID,
          },
          metadata: {
            role: 'concierge',
            presentation: 'simple',
            lockSkill: true,
            clarificationStatus: 'ready',
            clarificationCount: 0,
            skill: {
              id: skill.id,
              title: skill.title,
              version: skill.version,
            },
          },
        }),
        'ensureWorkflowCopilotThread',
      );

      send = unwrap(
        await sendWorkflowCopilotMessage(opts.apiUrl, session.id, thread.thread.id, {
          content: buildSeedPrompt(skill, scenario, files),
          agentType: target.agentType,
          model: {
            providerID: target.providerID,
            modelID: target.modelID,
          },
          autoApply: true,
          autoRun: false,
        }),
        'sendWorkflowCopilotMessage',
      );

      const bundle = unwrap(await getGraphBundle(opts.apiUrl, session.id), 'getGraphBundle');
      const createdNodeIds = send.assistantMessage?.apply?.createdNodeIds ?? [];
      flowNode = latestManagedFlow(bundle, createdNodeIds);
      if (!flowNode) {
        throw new Error('No managed_flow node was created by the concierge turn.');
      }
      started = unwrap(await runWorkflowFlow(opts.apiUrl, session.id, flowNode.id, {}), 'runWorkflowFlow');
    }
    const polled = await pollFlow(
      opts.apiUrl,
      session.id,
      started.flowId,
      flowNode.id,
      scenario.timeoutMs ?? opts.timeoutMs,
      opts.pollMs,
    );

    const outputChecks = await validateOutputs(workspaceDir, scenario.expectedOutputs, scenario.checks);
    const graphChecks = validateGraph(polled.bundle, flowNode, polled.flow, scenario.expectedOutputs);
    const latestRun = polled.flow ? latestRunId(polled.flow) : null;
    let artifactSummary = null;
    if (latestRun) {
      try {
        artifactSummary = unwrap(
          await getAgentRunArtifacts(opts.apiUrl, session.id, latestRun),
          'getAgentRunArtifacts',
        ).summary;
      } catch {
        // ignore: artifact fetch is best-effort, not part of the assertion.
      }
    }

    const allChecks = [...graphChecks, ...outputChecks];
    const ok = !polled.timedOut && allChecks.every((check) => check.ok);
    return {
      ok,
      sessionId: session.id,
      threadId: thread?.thread?.id ?? null,
      skillId: skill.id,
      targetId: target.id,
      agentType: target.agentType,
      model: `${target.providerID}/${target.modelID}`,
      workspaceDir,
      flowNodeId: flowNode.id,
      flowId: started.flowId,
      flowStatus: polled.flow?.status ?? (polled.timedOut ? 'timeout' : 'missing'),
      flowCurrentPhaseId: polled.flow?.currentPhaseId ?? null,
      flowWaitKind: polled.flow?.wait?.kind ?? null,
      flowWaitReason: polled.flow?.wait?.reason ?? polled.flow?.wait?.nodeId ?? null,
      flowLastDetail: polled.flow?.lastDetail ?? null,
      elapsedMs: polled.elapsedMs,
      assistantStatus: send?.assistantMessage?.status ?? (scenario.importWorkflowPath ? 'imported' : 'missing'),
      assistantWarnings: send?.assistantMessage?.warnings ?? [],
      checks: allChecks,
      artifactSummary,
    };
  } catch (error) {
    return {
      ok: false,
      sessionId: session.id,
      skillId: skill.id,
      targetId: target.id,
      agentType: target.agentType,
      model: `${target.providerID}/${target.modelID}`,
      flowStatus: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await stopScenarioService(serviceHandle);
    await finalizeSession(opts.apiUrl, session.id, opts.keepSessions);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  workflowTestScenarios = await loadWorkflowTestScenarios();
  const skills = await readCatalog();
  ensureScenarioCoverage(skills);
  const selectedSkills = args.skills.length > 0
    ? skills.filter((skill) => args.skills.includes(skill.id))
    : skills;
  if (selectedSkills.length === 0) {
    throw new Error('No workflow templates matched the requested --skills filter.');
  }

  if (args.list) {
    console.log('Workflow templates covered by the real tester:\n');
    for (const skill of selectedSkills) {
      console.log(`- ${skill.id}`);
    }
    if (args.dryRun) {
      return;
    }
  }

  if (args.dryRun) {
    console.log(`Dry run OK. ${selectedSkills.length} workflow templates are covered.`);
    return;
  }

  await mkdirp(args.reportDir);
  await mkdirp(args.workspaceRoot);

  const probe = unwrap(
    await createSession(args.apiUrl, `workflow-real-probe-${Date.now()}`),
    'createSession(probe)',
  );
  let catalog;
  try {
    catalog = unwrap(await getAgentCatalog(args.apiUrl, probe.id), 'getAgentCatalog');
  } finally {
    await finalizeSession(args.apiUrl, probe.id, false);
  }

  const targetDefs = buildTargetDefs();
  const targets = args.targets.map((id) => {
    const target = targetDefs[id];
    if (!target) {
      throw new Error(`Unknown target "${id}". Supported targets: ${Object.keys(targetDefs).join(', ')}`);
    }
    return resolveTarget(catalog, target);
  });

  if (args.probe) {
    console.log('\n[workflow-real-tester] live probe');
    for (const target of targets) {
      console.log(`- ${target.id}: ${target.providerID}/${target.modelID}`);
    }
    return;
  }

  const results = [];
  for (const skill of selectedSkills) {
      const scenario = workflowTestScenarios[skill.id];
    for (const target of targets) {
      console.log(`\n[workflow-real-tester] ${skill.id} -> ${target.id} (${target.providerID}/${target.modelID})`);
      results.push(await runScenario(skill, scenario, target, args));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apiUrl: args.apiUrl,
    summary: {
      total: results.length,
      pass: results.filter((result) => result.ok).length,
      fail: results.filter((result) => !result.ok).length,
    },
    results,
  };

  const stamp = nowStamp();
  const jsonPath = path.join(args.reportDir, `workflow-real-tester-${stamp}.json`);
  const mdPath = path.join(args.reportDir, `workflow-real-tester-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(mdPath, buildSummaryMarkdown(report), 'utf8');

  console.log(`\nReport written to ${jsonPath}`);
  console.log(`Summary written to ${mdPath}`);

  if (report.summary.fail > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[workflow-real-tester] fatal:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
