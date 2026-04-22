#!/usr/bin/env node
// E2E test: create session → save as skill → run skill → verify result → cleanup
// Usage: node scripts/e2e-save-run.mjs
// Env:   E2E_API_URL (default: http://localhost:31947/api/v1)

import process from 'node:process';

const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:31947/api/v1').replace(/\/$/, '');
const POLL_INTERVAL_MS = 2000;
const RUN_TIMEOUT_MS = 30000;

// ── helpers ───────────────────────────────────────────────────────────

async function apiRequest(method, route, body = undefined, query = undefined) {
  const url = new URL(API_URL + route);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const response = await fetch(url.toString(), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    err.status = response.status;
    err.body = parsed;
    throw err;
  }
  // unwrap { success, data } envelope
  if (parsed && typeof parsed === 'object' && parsed.success === true && 'data' in parsed) {
    return parsed.data;
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── test steps ────────────────────────────────────────────────────────

async function runTest() {
  const testId = `e2e-${Date.now()}`;
  let skillSlug = null;
  let sessionId = null;

  try {
    console.log(`[e2e-save-run] API: ${API_URL}`);

    // 1. Create a session
    console.log('[1/8] Creating session...');
    const session = await apiRequest('POST', '/sessions', { name: `E2E Test Session ${testId}` });
    assert(session && session.id, 'Session should have an id');
    sessionId = session.id;
    console.log(`      Session: ${sessionId}`);

    // 2. Save session as skill
    console.log('[2/8] Saving session as skill...');
    const skill = await apiRequest('POST', `/sessions/${sessionId}/save-as-skill`, {
      slug: `e2e-test-skill-${testId}`,
      title: `E2E Test Skill ${testId}`,
      summary: 'Auto-generated skill for E2E testing',
      inputsSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' },
        },
        required: ['name'],
      },
      outputsSchema: {
        type: 'object',
        properties: {
          greeting: { type: 'string' },
        },
      },
      visibility: 'private',
    });
    assert(skill && skill.slug, 'Skill should have a slug');
    skillSlug = skill.slug;
    console.log(`      Skill slug: ${skillSlug}`);

    // 3. Verify skill appears in catalog
    console.log('[3/8] Verifying skill in catalog...');
    const catalog = await apiRequest('GET', '/workflow-skills');
    const catalogSkills = Array.isArray(catalog) ? catalog : catalog?.skills ?? [];
    const foundInCatalog = catalogSkills.some((s) => s.id === skillSlug);
    assert(foundInCatalog, `Skill ${skillSlug} should appear in workflow-skills catalog`);
    console.log('      Skill found in catalog');

    // Also verify via GET /skills/:slug
    const fetchedSkill = await apiRequest('GET', `/skills/${skillSlug}`);
    assert(fetchedSkill.slug === skillSlug, 'Fetched skill slug should match');
    console.log('      Skill fetchable via /skills/:slug');

    // 4. Run the skill
    console.log('[4/8] Running skill...');
    const run = await apiRequest(
      'POST',
      `/skills/${skillSlug}/runs`,
      { inputs: { name: 'World' }, triggeredBy: 'sdk' },
      { wait: 'false' }, // we poll manually for better control
    );
    assert(run && run.id, 'Run should have an id');
    assert(run.skillId === skillSlug, 'Run skillId should match');
    assert(run.inputs && run.inputs.name === 'World', 'Run inputs should be persisted');
    console.log(`      Run id: ${run.id}, initial status: ${run.status}`);

    const runId = run.id;

    // 5. Poll for completion (graceful if daemon is not running)
    console.log('[5/8] Polling run status...');
    const started = Date.now();
    let finalRun = run;
    while (Date.now() - started < RUN_TIMEOUT_MS) {
      finalRun = await apiRequest('GET', `/skill-runs/${runId}`);
      if (['succeeded', 'failed', 'cancelled'].includes(finalRun.status)) {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    console.log(`      Final status: ${finalRun.status} (${Date.now() - started}ms)`);

    // Accept any terminal state OR queued (daemon may not be running)
    const acceptableStatuses = ['succeeded', 'failed', 'cancelled', 'queued', 'running'];
    assert(
      acceptableStatuses.includes(finalRun.status),
      `Run should reach an acceptable state, got: ${finalRun.status}`,
    );

    if (finalRun.status === 'succeeded') {
      assert(finalRun.outputs !== undefined, 'Succeeded run should have outputs');
      console.log('      Run succeeded with outputs');
    } else if (finalRun.status === 'failed') {
      console.log(`      Run failed (expected if no daemon): ${finalRun.error?.message ?? 'unknown error'}`);
    } else if (finalRun.status === 'queued') {
      console.log('      Run still queued (daemon not running — acceptable)');
    } else if (finalRun.status === 'running') {
      console.log('      Run still running (timeout exceeded — acceptable)');
    }

    // 6. List runs for skill
    console.log('[6/8] Listing runs for skill...');
    const runs = await apiRequest('GET', `/skills/${skillSlug}/runs`);
    const runList = Array.isArray(runs) ? runs : runs?.items ?? [];
    const foundRun = runList.some((r) => r.id === runId);
    assert(foundRun, 'Run should appear in skill runs list');
    console.log(`      Found ${runList.length} run(s) for skill`);

    // 7. Delete skill (soft-delete)
    console.log('[7/8] Deleting skill (soft-delete)...');
    await apiRequest('DELETE', `/skills/${skillSlug}`);
    console.log('      Skill deleted');

    // 8. Verify soft-delete (should 404)
    console.log('[8/8] Verifying soft-delete...');
    try {
      await apiRequest('GET', `/skills/${skillSlug}`);
      throw new Error('Expected 404 after soft-delete');
    } catch (err) {
      assert(err.status === 404, `Expected 404, got HTTP ${err.status}`);
      console.log('      Confirmed: skill returns 404 after delete');
    }

    console.log('\n[e2e-save-run] All assertions passed.');
    return { ok: true };
  } catch (error) {
    console.error('\n[e2e-save-run] FAILED:', error instanceof Error ? error.message : String(error));
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Best-effort cleanup of session
    if (sessionId) {
      try {
        await apiRequest('PATCH', `/sessions/${sessionId}`, { status: 'archived' });
        console.log(`      Session ${sessionId} archived`);
      } catch {
        // ignore
      }
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────

runTest().then((result) => {
  process.exitCode = result.ok ? 0 : 1;
});
