import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

function pkgSrc(name) {
  return path.join(rootDir, 'packages', name, 'src', 'index.ts');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: rootDir,
  experimental: {
    externalDir: true,
  },
  // Next type-checks via tsc, which ignores webpack aliases declared here.
  // Type-check still runs separately via `pnpm typecheck` in CI.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@cepage/app-ui': pkgSrc('app-ui'),
      '@cepage/client-api': pkgSrc('client-api'),
      '@cepage/i18n': pkgSrc('i18n'),
      '@cepage/shared-core': pkgSrc('shared-core'),
      '@cepage/state': pkgSrc('state'),
      '@cepage/ui-kit': pkgSrc('ui-kit'),
    };
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    config.resolve.extensions = [
      '.ts',
      '.tsx',
      ...((config.resolve.extensions ?? []).filter((ext) => ext !== '.ts' && ext !== '.tsx')),
    ];
    return config;
  },
};

export default nextConfig;
