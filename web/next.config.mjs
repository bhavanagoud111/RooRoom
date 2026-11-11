/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['pg', 'minio', 'bcryptjs'],
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};
export default nextConfig;
