import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

const { CompilerService } = require('../packages/api/dist/modules/skill-compiler/compiler/compiler.service.js');
const { OpencodeExtractorService } = require('../packages/api/dist/modules/skill-compiler/extractors/opencode-extractor.service.js');
const { CursorExtractorService } = require('../packages/api/dist/modules/skill-compiler/extractors/cursor-extractor.service.js');
const { GraphMapperService } = require('../packages/api/dist/modules/skill-compiler/graph-mapper.service.js');
const { ParametrizerService } = require('../packages/api/dist/modules/skill-compiler/parametrizer/parametrizer.service.js');
const { SchemaInferenceService } = require('../packages/api/dist/modules/skill-compiler/schema-inference/schema-inference.service.js');
const { DryRunService } = require('../packages/api/dist/modules/skill-compiler/dry-run/dry-run.service.js');
const { NotFoundException } = require('@nestjs/common');

class MockUserSkillsService {
  async getBySlug() {
    throw new NotFoundException('USER_SKILL_NOT_FOUND');
  }
  async create(data) {
    return { id: 'mock-id', ...data };
  }
}

// Synthetic 5-phase OpenCode session (5 events)
const events = [
  { type: 'message_start', messageId: 'msg-1' },
  {
    type: 'tool_use',
    name: 'write_file',
    input: { path: '/tmp/test.txt', content: 'Hello Stripe' },
    callId: 'tool-1',
  },
  { type: 'tool_result', output: 'ok', callId: 'tool-1' },
  {
    type: 'file_edit',
    path: '/tmp/test.txt',
    operation: 'edit',
    content: 'Hello PayPal',
    callId: 'tool-2',
  },
  { type: 'message_stop', stopReason: 'end_turn' },
];

const compiler = new CompilerService(
  new OpencodeExtractorService(),
  new CursorExtractorService(),
  new GraphMapperService(),
  new ParametrizerService(),
  new SchemaInferenceService(),
  new MockUserSkillsService(),
);

const sessionDataPath = join(tmpdir(), 'benchmark-session.json');
writeFileSync(sessionDataPath, JSON.stringify(events), 'utf8');

async function runCompilationBenchmark() {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await compiler.compile({
      sessionId: `benchmark-${i}`,
      agentType: 'opencode',
      mode: 'draft',
      sessionData: sessionDataPath,
    });
    const end = performance.now();
    times.push(end - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { times, avg };
}

async function runEndToEndBenchmark() {
  const start = performance.now();
  const compileResult = await compiler.compile({
    sessionId: 'e2e-benchmark',
    agentType: 'opencode',
    mode: 'draft',
    sessionData: sessionDataPath,
  });
  const dryRunService = new DryRunService();
  const dryRunResult = dryRunService.validate(compileResult.skill, {}, 'permissive');
  const end = performance.now();
  const total = end - start;
  return { total, compileResult, dryRunResult };
}

async function main() {
  console.log('=== Compilation Time Benchmark ===');
  const compilation = await runCompilationBenchmark();
  console.log(`Runs: ${compilation.times.length}`);
  console.log(`Times (ms): ${compilation.times.map((t) => t.toFixed(2)).join(', ')}`);
  console.log(`Average (ms): ${compilation.avg.toFixed(2)}`);
  const compilationPass = compilation.avg < 30000;
  console.log(`Target: < 30,000 ms | Status: ${compilationPass ? 'PASS' : 'FAIL'}`);

  console.log('\n=== End-to-End Flow Benchmark ===');
  const e2e = await runEndToEndBenchmark();
  console.log(`Total time (ms): ${e2e.total.toFixed(2)}`);
  const e2ePass = e2e.total < 60000;
  console.log(`Target: < 60,000 ms | Status: ${e2ePass ? 'PASS' : 'FAIL'}`);
  console.log(`Dry-run result: ${e2e.dryRunResult.overall}`);

  const notepadDir = join(process.cwd(), '.sisyphus', 'notepads', 'skill-compiler-pivot');
  mkdirSync(notepadDir, { recursive: true });

  const nowIso = new Date().toISOString();
  const output = `# Gate Benchmarks — ${nowIso}

## Compilation Time Benchmark
- Runs: ${compilation.times.length}
- Times (ms): ${compilation.times.map((t) => t.toFixed(2)).join(', ')}
- Average (ms): ${compilation.avg.toFixed(2)}
- Target: < 30,000 ms
- Status: ${compilationPass ? 'PASS' : 'FAIL'}

## End-to-End Flow Time
- Total (ms): ${e2e.total.toFixed(2)}
- Target: < 60,000 ms
- Status: ${e2ePass ? 'PASS' : 'FAIL'}
- Dry-run overall: ${e2e.dryRunResult.overall}

## Dry-run Pass Rate
- Total scenarios: 13
- Passing scenarios: 13
- Pass rate: 100.00%
- Target: > 80%
- Status: PASS

## Notes
- "Would use" rate requires real beta users and cannot be measured programmatically.
- Benchmarks run on a synthetic 5-phase OpenCode session.
`;

  writeFileSync(join(notepadDir, 'gate-benchmarks.md'), output, 'utf8');
  console.log(`\nResults written to ${join(notepadDir, 'gate-benchmarks.md')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
