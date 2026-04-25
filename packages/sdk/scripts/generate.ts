#!/usr/bin/env node
/**
 * Generates `src/generated/openapi.ts` from the Cepage OpenAPI 3.1 spec.
 *
 * Usage:
 *   pnpm generate
 *
 * Environment variables:
 *   CEPAGE_OPENAPI_URL  – URL to fetch the spec from (default: http://localhost:31947/api/v1/openapi.json)
 *   CEPAGE_OPENAPI_PATH – Local file path to read the spec from (overrides URL)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outputDir = join(root, 'src', 'generated');
const outputPath = join(outputDir, 'openapi.ts');

async function main() {
  const localPath = process.env.CEPAGE_OPENAPI_PATH;
  const url = process.env.CEPAGE_OPENAPI_URL || 'http://localhost:31947/api/v1/openapi.json';
  const defaultCachePath = join(root, '.openapi-cache.json');

  let inputPath: string;

  if (localPath) {
    if (!existsSync(localPath)) {
      console.error(`CEPAGE_OPENAPI_PATH does not exist: ${localPath}`);
      process.exit(1);
    }
    inputPath = localPath;
    console.log(`Using local OpenAPI spec: ${inputPath}`);
  } else if (existsSync(defaultCachePath)) {
    inputPath = defaultCachePath;
    console.log(`Using local OpenAPI spec: ${inputPath}`);
  } else {
    console.log(`Fetching OpenAPI spec from ${url}...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        `Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}\n` +
          `Make sure the Cepage API is running, or set CEPAGE_OPENAPI_PATH to a local file.`,
      );
      process.exit(1);
    }
    const spec = await res.json();
    inputPath = join(root, '.openapi-cache.json');
    writeFileSync(inputPath, JSON.stringify(spec, null, 2));
    console.log(`Cached spec to ${inputPath}`);
  }

  mkdirSync(outputDir, { recursive: true });

  const binPath = join(root, 'node_modules', '.bin', 'openapi-typescript');
  if (!existsSync(binPath)) {
    console.error(
      `openapi-typescript binary not found at ${binPath}.\n` +
        `Run "pnpm install" first.`,
    );
    process.exit(1);
  }

  const cmd = `${binPath} "${inputPath}" -o "${outputPath}"`;
  console.log(`Running: ${cmd}`);

  try {
    execSync(cmd, { stdio: 'inherit', cwd: root });
    console.log(`\n✅ Generated ${outputPath}`);
  } catch {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
