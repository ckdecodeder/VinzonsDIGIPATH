import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export function createDashboardConfig(mode, envDirectory = fileURLToPath(new URL('.', import.meta.url))) {
  const env = loadEnv(mode, envDirectory, '')
  const backendTarget = process.env.VITE_BACKEND_PROXY_TARGET || env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:5000'
  const sharedServer = {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.devtunnels.ms'],
    proxy: {
      '/api': { target: backendTarget, changeOrigin: true },
      '/ws': { target: backendTarget, changeOrigin: true, ws: true },
      '/uploads': { target: backendTarget, changeOrigin: true },
      // Development-only synthetic acceptance harness; omitted from the production build.
      '/test/config': { target: backendTarget, changeOrigin: true },
      '/test/metrics': { target: backendTarget, changeOrigin: true },
    },
  }
  return { plugins: [react()], server: sharedServer, preview: sharedServer }
}

export default defineConfig(({ mode }) => createDashboardConfig(mode))
