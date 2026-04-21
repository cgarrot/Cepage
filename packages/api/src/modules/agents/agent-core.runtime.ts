/**
 * `@cepage/agent-core` is ESM-only. `tsc` with `module: commonjs` rewrites
 * `import('@cepage/agent-core')` to `require()`, which fails at runtime.
 * Use a runtime import that is not statically rewritten.
 */
export async function importAgentCore(): Promise<typeof import('@cepage/agent-core')> {
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<typeof import('@cepage/agent-core')>;
  return runtimeImport('@cepage/agent-core');
}
