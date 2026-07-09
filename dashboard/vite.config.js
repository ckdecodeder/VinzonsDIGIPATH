import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const remoteRoot = env.VITE_API_BASE_URL?.trim().replace(/\/api\/?$/, '')
  const backendTarget = env.VITE_BACKEND_PROXY_TARGET || remoteRoot || 'http://127.0.0.1:5000'

  const sharedServer = {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy API to backend — browser stays same-origin (no CORS issues in dev).
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  }

  return {
    plugins: [react()],
    server: sharedServer,
    preview: sharedServer,
  }
})
