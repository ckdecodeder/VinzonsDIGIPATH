import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:5000'

const sharedServer = {
  host: true,
  port: 5173,
  strictPort: true,
  proxy: {
    '/api': {
      target: backendTarget,
      changeOrigin: true,
    },
    '/uploads': {
      target: backendTarget,
      changeOrigin: true,
    },
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: sharedServer,
  preview: sharedServer,
})
