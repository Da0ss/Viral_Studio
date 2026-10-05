import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: false,
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
};

export default nextConfig;
