import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { appVersion } = require('../scripts/app-version.cjs')

// .mts extension on purpose: Vite loads this file as ES modules, so `import.meta.url`
// is available and the config stays compatible with Vite's native config loader.
export default defineConfig({
  plugins: [vue()],
  define: {
    // Same version the container ENV/backend health carry (APP_VERSION wins, then git).
    __APP_VERSION__: JSON.stringify(appVersion({ cwd: fileURLToPath(new URL('.', import.meta.url)) })),
  },
  resolve: {
    alias: {
      // Before '@': the workspace package resolves to shared sources, so frontend dev
      // sees live edits in ../shared without a build step. ('@' is an exact-or-'/'-boundary
      // match, but ordering keeps this explicit.)
      '@neon-tetris/shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
