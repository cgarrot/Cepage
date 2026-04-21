import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DirectoryPickerResult = {
  path: string | null;
  cancelled: boolean;
  supported: boolean;
};

type OpenDirectoryCommand = {
  cmd: string;
  args: string[];
};

export function buildChooseFolderScript(defaultPath?: string): string {
  const prompt = 'Choose the parent directory for this session';
  if (!defaultPath) {
    return `POSIX path of (choose folder with prompt "${prompt}")`;
  }

  const normalized = escapeAppleScriptString(path.resolve(defaultPath));
  return `POSIX path of (choose folder with prompt "${prompt}" default location POSIX file "${normalized}")`;
}

export function normalizeChosenDirectory(value: string): string {
  return path.resolve(value.trim());
}

export function buildOpenDirectoryCommand(
  value: string,
  platform: NodeJS.Platform = process.platform,
): OpenDirectoryCommand | null {
  const dir = platform === 'win32' ? path.win32.resolve(value.trim()) : path.resolve(value.trim());

  if (platform === 'darwin') {
    return { cmd: 'open', args: [dir] };
  }
  if (platform === 'win32') {
    return { cmd: 'explorer.exe', args: [dir.replace(/\//g, '\\')] };
  }
  if (platform === 'linux') {
    return { cmd: 'xdg-open', args: [dir] };
  }
  return null;
}

export function isDirectoryPickerCancelled(errorValue: unknown): boolean {
  if (!(errorValue instanceof Error)) {
    return false;
  }

  return /user canceled/i.test(errorValue.message);
}

export async function chooseParentDirectory(defaultPath?: string): Promise<DirectoryPickerResult> {
  if (process.platform !== 'darwin') {
    return { path: null, cancelled: false, supported: false };
  }

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', buildChooseFolderScript(defaultPath)]);
    return {
      path: normalizeChosenDirectory(stdout),
      cancelled: false,
      supported: true,
    };
  } catch (errorValue) {
    if (isDirectoryPickerCancelled(errorValue)) {
      return { path: null, cancelled: true, supported: true };
    }
    throw errorValue;
  }
}

export async function openDirectory(value: string): Promise<boolean> {
  const cmd = buildOpenDirectoryCommand(value);
  if (!cmd) {
    return false;
  }
  await execFileAsync(cmd.cmd, cmd.args);
  return true;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
