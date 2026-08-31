import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    // /uploads is served by express, not Vite — without it every embedded
    // image 404s in dev while working fine in a production build.
    //
    // Pointed at the PUBLIC port, not the trusted one. Both serve the same app,
    // but the trusted port treats a request with no cookie as the owner — so
    // developing against it would mean the login page could never be seen and
    // an accidental dependence on being signed in would never show up. Dev
    // costs one sign-in, and the cookie lasts ten years. See server/ports.js.
    proxy: {
      '/api': 'http://localhost:8789',
      '/uploads': 'http://localhost:8789',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
