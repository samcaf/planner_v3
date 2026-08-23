import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    // /uploads is served by express, not Vite — without it every embedded
    // image 404s in dev while working fine in a production build.
    proxy: {
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
