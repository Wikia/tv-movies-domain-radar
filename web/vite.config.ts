import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev the React app runs on Vite's port, so /api must be forwarded to the
    // radar server. In production both are served by that same server, so the
    // app's fetches are already same-origin and this proxy is unused.
    proxy: {
      '/api': {
        target: process.env.RADAR_SERVER ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
