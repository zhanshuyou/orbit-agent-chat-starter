import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import type { NextConfig } from 'next'

// One .env at the repository root feeds both the Python backend and this app.
// (forceReload: Next has already loaded this folder's own .env files and cached the result.)
const rootDir = path.resolve(process.cwd(), '..')
loadEnvConfig(rootDir, process.env.NODE_ENV !== 'production', undefined, true)

const orbitBaseUrl = (process.env.ORBIT_BASE_URL ?? '').replace(/\/+$/, '')
const backendUrl = (process.env.BACKEND_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
// true: the browser reaches Orbit through this app (app/orbit/[...path]/route.ts), so no CORS origin is needed in
// Orbit. Handy for local development; in production allow your origin in Orbit instead.
const orbitProxy = process.env.ORBIT_BROWSER_PROXY === 'true'

if (!orbitBaseUrl) throw new Error('ORBIT_BASE_URL is not set; copy .env.example to .env at the repo root')

const nextConfig: NextConfig = {
  // Dev server: also accept the page (and its HMR websocket) when opened via 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Only the base URL is exposed to the browser. ORBIT_API_TOKEN stays on the Python backend.
  env: {
    NEXT_PUBLIC_ORBIT_BASE_URL: orbitBaseUrl,
    NEXT_PUBLIC_ORBIT_BROWSER_PROXY: orbitProxy ? 'true' : 'false',
  },
  async rewrites() {
    return [
      { source: '/api/backend/:path*', destination: `${backendUrl}/api/:path*` },
    ]
  },
}

export default nextConfig
