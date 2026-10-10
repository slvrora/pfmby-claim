/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep EXIF's Node fs/zlib imports intact instead of bundling its UMD loader.
  serverExternalPackages: ['exifr'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
