/// <reference types="vite/client" />

// Build-time app version (2.{YY}.{MM}.{git short hash}) injected by vite.config.mts from
// scripts/app-version.cjs — see the version section in docs/SESSION_CONTEXT.md.
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  declare const component: DefineComponent<{}, {}, any>
}
