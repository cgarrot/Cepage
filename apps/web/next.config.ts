import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@cepage/app-ui',
    '@cepage/state',
    '@cepage/ui-kit',
    '@cepage/client-api',
    '@cepage/shared-core',
    '@cepage/i18n',
  ],
};

export default nextConfig;
