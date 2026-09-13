/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['gray-matter'],
  },
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
