/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Production builds emit a minimal self-contained server for container deploys (Fly.io).
  // NEXT_OUTPUT=export switches to a fully static export for static hosts (Vercel static, Netlify drop).
  output: process.env.NEXT_OUTPUT === 'export' ? 'export' : 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), bluetooth=(self)' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
