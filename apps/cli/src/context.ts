import { CepageClient } from '@cepage/sdk';

import type { GlobalFlags } from './main.js';
import { resolveConfig, type ResolvedConfig } from './config.js';

export interface CliContext {
  client: CepageClient;
  config: ResolvedConfig;
  flags: GlobalFlags;
}

export async function createContext(flags: GlobalFlags): Promise<CliContext> {
  const config = await resolveConfig({
    cliApiUrl: flags.apiUrl,
    cliToken: flags.token,
  });
  const client = new CepageClient({
    apiUrl: config.apiUrl,
    token: config.token,
    userAgent: `cepage-cli/${(await import('./version.js')).VERSION}`,
  });
  return { client, config, flags };
}
