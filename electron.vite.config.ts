import { resolve } from 'path'
import { copyFileSync } from 'fs'
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
    plugins: [
      tailwindcss(),
      react(),
      // maplibre-gl v6 resolves its worker filename at RUNTIME
      // (`maplibre-gl-worker.mjs` next to the importing chunk), so the
      // bundler never emits it. Without this copy the packaged app
      // (asar/file://) cannot spawn the worker and the map is blank.
      {
        name: 'copy-maplibre-worker',
        closeBundle() {
          const src = resolve('node_modules/maplibre-gl/dist')
          const dest = resolve('out/renderer/assets')
          for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-worker-dev.mjs']) {
            copyFileSync(resolve(src, f), resolve(dest, f))
          }
        }
      }
    ]
  }
})
