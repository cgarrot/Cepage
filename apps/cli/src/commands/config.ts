import type { GlobalFlags } from '../main.js';
import { configPath, redactToken, resolveConfig } from '../config.js';
import { emitJson, emitLine, makeColors } from '../output.js';

export async function configCommand(_argv: string[], flags: GlobalFlags): Promise<number> {
  const resolved = await resolveConfig({
    cliApiUrl: flags.apiUrl,
    cliToken: flags.token,
  });

  if (flags.json) {
    emitJson({
      apiUrl: resolved.apiUrl,
      token: resolved.token ? redactToken(resolved.token) : null,
      source: resolved.source,
      configPath: configPath(),
    });
    return 0;
  }

  const colors = makeColors(flags.color);
  emitLine(colors.bold('cepage config'));
  emitLine(`${colors.dim('path')}: ${configPath()}`);
  emitLine(`${colors.dim('apiUrl')}: ${resolved.apiUrl}  ${colors.dim(`(${resolved.source})`)}`);
  emitLine(`${colors.dim('token')}: ${redactToken(resolved.token)}`);
  return 0;
}
