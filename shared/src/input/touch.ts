/**
 * Touch detection (B3).
 *
 * `(pointer: coarse)` is the primary signal: it says the device's main pointer is a finger, which
 * is exactly when on-screen buttons are useful. A laptop with a touchscreen still has a fine
 * primary pointer, so it keeps the keyboard layout.
 *
 * `window.__FORCE_TOUCH_CONTROLS` is a dev/E2E switch: it lets the touch layer be tested in a
 * desktop browser without pretending to be a phone. It is read at mount time only.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as Window & { __FORCE_TOUCH_CONTROLS?: boolean }).__FORCE_TOUCH_CONTROLS === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
