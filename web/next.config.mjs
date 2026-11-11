/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['pg', 'minio', 'bcryptjs'],
  // Uploads pass through middleware: course PDFs up to 25 MB, chat files up to 10 MB (default cut-off is 10 MB).
  experimental: { serverActions: { bodySizeLimit: '2mb' }, middlewareClientMaxBodySize: '26mb' },
};
export default nextConfig;
