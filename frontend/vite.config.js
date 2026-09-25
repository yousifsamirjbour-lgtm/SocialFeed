import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://api:8000',
        changeOrigin: true
      }
    },
    allowedHosts: [
      'socialfeed.duckdns.org'
    ]
  }
})