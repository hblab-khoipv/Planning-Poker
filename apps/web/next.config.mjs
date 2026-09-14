/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting is owned by the root flat ESLint config (`npm run lint`), not by `next build`.
  eslint: { ignoreDuringBuilds: true },
  // The shared workspace package ships ESM TypeScript output consumed directly by Next.
  transpilePackages: ['@planning-poker/shared'],
};

export default nextConfig;
