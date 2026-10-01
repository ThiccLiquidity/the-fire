/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Card Studio is a standalone, browser-only app: no server, no env vars. Everything lives in IndexedDB.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
