#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('Usage: node scripts/run-node-tests.mjs <dir> [...]');
  process.exit(2);
}

const testFiles = [];

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      testFiles.push(entryPath);
    }
  }
}

for (const root of roots) {
  await collect(resolve(root));
}

testFiles.sort();
if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

const child = spawn(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`node --test terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
