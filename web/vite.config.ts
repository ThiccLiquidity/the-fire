import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // viem is most of the bundle; one ~600 kB chunk (~190 kB gzipped) is expected
  build: { chunkSizeWarningLimit: 800 },
})
