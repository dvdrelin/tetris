/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  declare const component: DefineComponent<{}, {}, any>
}
