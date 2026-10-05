import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'ws', 'express']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // maplibre-gl v6 is ESM-only and ships its own worker; the Vite dev
    // optimizer cannot prebundle it (maplibre-gl-worker.mjs missing error,
    // blank map) so exclude it from optimizeDeps.
    optimizeDeps: {
      exclude: ['maplibre-gl']
    },
    plugins: [tailwindcss(), react()]
  }
})
