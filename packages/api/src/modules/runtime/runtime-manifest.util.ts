import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  normalizeRuntimeManifestEnvelope,
  parseRuntimeManifestText,
  type RuntimeLaunchMode,
  type RuntimeManifestEnvelope,
  type RuntimeManifestSource,
  type RuntimePreviewSpec,
  type RunnableArtifactManifest,
} from '@cepage/shared-core';
import { detectPreviewLaunchSpec, type PreviewLaunchSpec } from '../agents/preview-detect.util';

export const RUNTIME_MANIFEST_FILES = ['cepage-run.json', '.cepage/runtime.json', '.cepage/cepage-run.json'] as const;

type RuntimeManifestCandidate = {
  envelope: RuntimeManifestEnvelope;
  source: RuntimeManifestSource;
  filePath?: string;
};

type PackageManager = 'pnpm' | 'npm' | 'bun' | 'yarn';

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function pathLabel(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  return relative && relative !== '.' ? relative.split(path.sep).join('/') : path.basename(absolutePath);
}

function serviceNameFromCwd(root: string, cwd: string): string {
  const label = pathLabel(root, cwd);
  const parts = label.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path.basename(root) ?? 'workspace';
}

function previewFromDetected(detected: PreviewLaunchSpec): RuntimePreviewSpec | undefined {
  if (detected.preview.status === 'unavailable') return undefined;
  if (detected.preview.strategy === 'static') {
    return {
      mode: 'static',
      entry: 'index.html',
    };
  }
  return {
    mode: 'server',
    port: 0,
  };
}

function managerCommand(manager: PackageManager): string {
  return manager === 'bun' ? 'bun' : manager;
}

function managerArgs(manager: PackageManager, scriptName: string, framework?: string): string[] {
  const args = ['run', scriptName];
  if (framework === 'next') {
    return manager === 'bun'
      ? [...args, '--hostname', '{{HOST}}', '--port', '{{PORT}}']
      : [...args, '--', '--hostname', '{{HOST}}', '--port', '{{PORT}}'];
  }
  if (framework === 'vite') {
    return manager === 'bun'
      ? [...args, '--host', '{{HOST}}', '--port', '{{PORT}}']
      : [...args, '--', '--host', '{{HOST}}', '--port', '{{PORT}}'];
  }
  return args;
}

function envForDetectedPreview(): Record<string, string> {
  return {
    BROWSER: 'none',
    CI: '1',
    HOST: '{{HOST}}',
    HOSTNAME: '{{HOST}}',
    PORT: '{{PORT}}',
  };
}

export function applyRuntimeTemplate(value: string, tokens: Record<string, string>): string {
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => tokens[key] ?? '');
}

export function buildDetectedRuntimeEnvelope(
  root: string,
  detected: PreviewLaunchSpec,
): RuntimeManifestEnvelope | null {
  if (detected.preview.status === 'unavailable') return null;
  const serviceName = serviceNameFromCwd(root, detected.cwd);
  const preview = previewFromDetected(detected);
  const target: RunnableArtifactManifest = {
    kind: 'web',
    launchMode: 'local_process',
    serviceName,
    cwd: detected.cwd,
    command:
      detected.preview.strategy === 'script' && detected.packageManager && detected.scriptName
        ? managerCommand(detected.packageManager)
        : undefined,
    args:
      detected.preview.strategy === 'script' && detected.packageManager && detected.scriptName
        ? managerArgs(detected.packageManager, detected.scriptName, detected.preview.framework)
        : undefined,
    env: detected.preview.strategy === 'script' ? envForDetectedPreview() : undefined,
    ports:
      detected.preview.strategy === 'script'
        ? [{ name: 'http', port: 0, protocol: 'http' }]
        : undefined,
    preview,
    monorepoRole: 'app',
    autoRun: true,
  };
  return {
    schema: 'cepage.runtime/v1',
    schemaVersion: 1,
    targets: [target],
  };
}

export async function readRuntimeManifestFromFile(root: string): Promise<RuntimeManifestCandidate | null> {
  for (const relativePath of RUNTIME_MANIFEST_FILES) {
    const absolutePath = path.join(root, relativePath);
    try {
      const raw = await fs.readFile(absolutePath, 'utf8');
      const parsed = normalizeRuntimeManifestEnvelope(JSON.parse(raw));
      if (parsed) {
        return {
          envelope: parsed,
          source: 'file',
          filePath: absolutePath,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function resolveRuntimeManifestCandidate(input: {
  root: string;
  textOutput?: string;
  eventManifest?: RuntimeManifestEnvelope | null;
}): Promise<RuntimeManifestCandidate | null> {
  const fileManifest = await readRuntimeManifestFromFile(input.root);
  if (fileManifest) return fileManifest;

  if (input.eventManifest) {
    return {
      envelope: input.eventManifest,
      source: 'event',
    };
  }

  const textManifest = input.textOutput ? parseRuntimeManifestText(input.textOutput) : null;
  if (textManifest) {
    return {
      envelope: textManifest,
      source: 'text',
    };
  }

  const detected = buildDetectedRuntimeEnvelope(input.root, await detectPreviewLaunchSpec(input.root));
  if (detected) {
    return {
      envelope: detected,
      source: 'detected',
    };
  }

  return null;
}

export function normalizeLaunchMode(value: string | undefined): RuntimeLaunchMode {
  return value === 'docker' ? 'docker' : 'local_process';
}

export function normalizeManifestCwd(root: string, cwd: string): string {
  return path.isAbsolute(cwd) ? cwd : path.resolve(root, cwd);
}

export function normalizeManifestValue(
  root: string,
  manifest: RunnableArtifactManifest,
): RunnableArtifactManifest {
  return {
    ...manifest,
    launchMode: normalizeLaunchMode(readString(manifest.launchMode)),
    cwd: normalizeManifestCwd(root, manifest.cwd),
  };
}
