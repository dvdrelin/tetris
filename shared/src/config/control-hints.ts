/**
 * C3: one source for the on-screen control hints. The menu and the HUD used to carry two separate
 * hand-written lists; the menu version ("↑ / ↓ — Вращение / Сброс") no longer matched the code and
 * drifted further with every input change. The hint list is now derived from the same table that
 * produces the labels, and both views render the same rows.
 *
 * The order below is the display order, not the input order. Key spellings are display forms of
 * KeyboardEvent.key values from KEY_MAP in input-actions.ts — if a key is added there, it has to
 * appear here too, otherwise the hint lies.
 */
export interface ControlHint {
  key: string;
  label: string;
}

/**
 * Keys that are not game actions but view navigation, handled by GameView rather than by KEY_MAP:
 * Escape (unpause, else exit to menu) and Enter (restart after game over). They are listed here so
 * the hint cross-check can tell "mapped in the input layer" from "owned by the view" — a key in
 * neither place is a hint that lies.
 */
export const VIEW_HINT_KEYS: readonly string[] = Object.freeze(['ESC', 'ENTER']);

export const CONTROL_HINTS: readonly ControlHint[] = Object.freeze([
  { key: '← →', label: 'Движение' },
  { key: 'A / D', label: 'Движение' },
  { key: '↑ / X', label: 'Поворот' },
  { key: 'Z / Q', label: 'Поворот против' },
  { key: 'R', label: 'Поворот 180°' },
  { key: '↓ / S', label: 'Мягкое падение' },
  { key: 'SPACE', label: 'Жёсткое падение' },
  { key: 'C / Shift', label: 'Удержание' },
  { key: 'P', label: 'Пауза' },
  { key: 'ESC', label: 'Выход в меню' },
  { key: 'ENTER', label: 'Заново после конца' },
]);
