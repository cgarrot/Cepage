import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WebPreviewInfo, WebPreviewStrategy } from '@cepage/shared-core';

const PREVIEW_CANDIDATE_DIRS = ['apps/web', 'web', 'frontend', 'app', '.'] as const;

type PackageManager = 'pnpm' | 'npm' | 'bun' | 'yarn';

export type PreviewLaunchSpec = {
  cwd: string;
  packageManager?: PackageManager;
  scriptName?: string;
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  preview: WebPreviewInfo;
};

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(absolutePath: string): Promise<PackageJson | null> {
  try {
    const raw = await fs.readFile(absolutePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as PackageJson;
  } catch {
    return null;
  }
}

function readFramework(pkg: PackageJson): string | undefined {
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  if (deps.next) return 'next';
  if (deps.vite) return 'vite';
  if (deps['react-scripts']) return 'react-scripts';
  return undefined;
}

function readScriptName(pkg: PackageJson): string | undefined {
  if (pkg.scripts?.dev) return 'dev';
  if (pkg.scripts?.start) return 'start';
  return undefined;
}

async function detectPackageManager(root: string, cwd: string): Promise<PackageManager> {
  const visited = new Set<string>();
  let current = cwd;
  for (;;) {
    if (visited.has(current)) break;
    visited.add(current);
    if (await pathExists(path.join(current, 'pnpm-lock.yaml'))) return 'pnpm';
    if (await pathExists(path.join(current, 'package-lock.json'))) return 'npm';
    if (await pathExists(path.join(current, 'bun.lockb'))) return 'bun';
    if (await pathExists(path.join(current, 'bun.lock'))) return 'bun';
    if (await pathExists(path.join(current, 'yarn.lock'))) return 'yarn';
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return 'pnpm';
}

function buildCommandLabel(manager: PackageManager, scriptName: string, framework: string | undefined, port: number): string {
  if (framework === 'next') {
    return `${manager} run ${scriptName} -- --hostname 127.0.0.1 --port ${port}`;
  }
  if (framework === 'vite') {
    return `${manager} run ${scriptName} -- --host 127.0.0.1 --port ${port}`;
  }
  return `${manager} run ${scriptName}`;
}

function buildCommandArgs(manager: PackageManager, scriptName: string, framework: string | undefined, port: number): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BROWSER: 'none',
    CI: '1',
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
  };
  if (manager === 'bun') {
    const args = ['run', scriptName];
    if (framework === 'next') {
      args.push('--hostname', '127.0.0.1', '--port', String(port));
    } else if (framework === 'vite') {
      args.push('--host', '127.0.0.1', '--port', String(port));
    }
    return {
      command: 'bun',
      args,
      env,
    };
  }
  const args = ['run', scriptName];
  if (framework === 'next') {
    args.push('--', '--hostname', '127.0.0.1', '--port', String(port));
  } else if (framework === 'vite') {
    args.push('--', '--host', '127.0.0.1', '--port', String(port));
  }
  return {
    command: manager,
    args,
    env,
  };
}

function makePreviewInfo(input: {
  status: WebPreviewInfo['status'];
  strategy?: WebPreviewStrategy;
  framework?: string;
  root?: string;
  command?: string;
  port?: number;
  url?: string;
  embedPath?: string;
  error?: string;
}): WebPreviewInfo {
  return {
    status: input.status,
    strategy: input.strategy,
    framework: input.framework,
    root: input.root,
    command: input.command,
    port: input.port,
    url: input.url,
    embedPath: input.embedPath,
    error: input.error,
  };
}

export async function detectPreviewLaunchSpec(root: string): Promise<PreviewLaunchSpec> {
  for (const relativeRoot of PREVIEW_CANDIDATE_DIRS) {
    const candidateRoot = relativeRoot === '.' ? root : path.join(root, relativeRoot);
    if (!(await pathExists(candidateRoot))) {
      continue;
    }

    const packageJsonPath = path.join(candidateRoot, 'package.json');
    if (await pathExists(packageJsonPath)) {
      const pkg = await readPackageJson(packageJsonPath);
      if (pkg) {
        const scriptName = readScriptName(pkg);
        const framework = readFramework(pkg) ?? (scriptName ? 'web' : undefined);
        if (scriptName) {
          const packageManager = await detectPackageManager(root, candidateRoot);
          return {
            cwd: candidateRoot,
            packageManager,
            scriptName,
            preview: makePreviewInfo({
              status: 'available',
              strategy: 'script',
              framework,
              root: relativeRoot === '.' ? '.' : relativeRoot,
            }),
          };
        }
      }
    }

    if (await pathExists(path.join(candidateRoot, 'index.html'))) {
      return {
        cwd: candidateRoot,
        preview: makePreviewInfo({
          status: 'available',
          strategy: 'static',
          framework: 'html',
          root: relativeRoot === '.' ? '.' : relativeRoot,
        }),
      };
    }
  }

  return {
    cwd: root,
    preview: makePreviewInfo({
      status: 'unavailable',
      error: 'No web preview target found in the workspace.',
    }),
  };
}

export async function buildPreviewLaunchSpec(root: string, port: number): Promise<PreviewLaunchSpec> {
  const detected = await detectPreviewLaunchSpec(root);
  if (detected.preview.strategy !== 'script' || !detected.packageManager || !detected.scriptName) {
    return detected;
  }
  const command = buildCommandLabel(
    detected.packageManager,
    detected.scriptName,
    detected.preview.framework,
    port,
  );
  const launch = buildCommandArgs(
    detected.packageManager,
    detected.scriptName,
    detected.preview.framework,
    port,
  );
  return {
    ...detected,
    command: launch.command,
    args: launch.args,
    env: launch.env,
    preview: makePreviewInfo({
      ...detected.preview,
      command,
      port,
      url: `http://127.0.0.1:${port}`,
    }),
  };
}
