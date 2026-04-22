import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface PkgJson {
  version?: string;
}

function readPkgJson(): PkgJson {
  const here = dirname(fileURLToPath(import.meta.url));
  // When built, version.js lives at dist/src/version.js — walk up two levels
  // to find the package root. During `tsx`/dev runs it's at src/version.ts,
  // so one level is enough. We try both paths and fall back gracefully.
  const candidates = [
    join(here, '..', '..', 'package.json'),
    join(here, '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')) as PkgJson;
    } catch {
      // try the next candidate
    }
  }
  return {};
}

export const VERSION = readPkgJson().version ?? '0.0.0';
