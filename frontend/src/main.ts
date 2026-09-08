import { createApp } from 'vue'
import { createPinia, Pinia } from 'pinia'
import App from './App.vue'

// Capture ALL errors for E2E testing
const _errors: string[] = []
const _warnings: string[] = []

// Intercept window.onerror (catches RangeError, TypeError, etc.)
window.onerror = function(message, source, lineno, colno, error) {
  _errors.push(`ERROR: ${message} at ${source}:${lineno}:${colno}`)
  return false
}

// Intercept unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  _errors.push(`REJECTION: ${e.reason}`)
})

// Intercept console.error
const originalError = console.error
console.error = function(...args: any[]) {
  _errors.push(args.map(a => typeof a === 'string' ? a : String(a)).join(' '))
  originalError.apply(console, args)
}

// Intercept console.warn
const originalWarn = console.warn
console.warn = function(...args: any[]) {
  _warnings.push(args.map(a => typeof a === 'string' ? a : String(a)).join(' '))
  originalWarn.apply(console, args)
}

;(window as any).__consoleErrors = _errors
;(window as any).__consoleWarnings = _warnings

const pinia: Pinia = createPinia()
const app: ReturnType<typeof createApp> = createApp(App)
app.use(pinia)
app.mount('#app')
