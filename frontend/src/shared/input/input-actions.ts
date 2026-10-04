/**
 * Input actions (B1/B2): the single mapping from a physical key to a game action.
 *
 * The keyboard is not the only source any more: touch buttons produce the same actions, so the
 * action vocabulary lives here and both input paths feed it. DAS/ARR timing lives in
 * repeat-controller.ts; this file only answers "which action is this key?" and "which command is
 * this action?".
 */
import { AnyCommand, CommandType } from '../cqrs/commands';

export type InputAction =
  | 'left'
  | 'right'
  | 'softDrop'
  | 'hardDrop'
  | 'rotateCW'
  | 'rotateCCW'
  | 'rotate180'
  | 'hold'
  | 'pause';

/**
 * Actions that keep firing while the key or button is held (DAS then ARR). Everything else is
 * edge-triggered: one physical press = one command, no matter how long it is held.
 */
export const HELD_ACTIONS: readonly InputAction[] = ['left', 'right', 'softDrop'];

export function isHeldAction(action: InputAction): boolean {
  return HELD_ACTIONS.includes(action);
}

/**
 * Keyboard map (B1). Letters are matched case-insensitively, so CapsLock or Shift+A still moves
 * left (the old map silently dropped every capital letter). Named keys keep their
 * KeyboardEvent.key spelling in lower case: 'ArrowLeft' → 'arrowleft', 'Shift' → 'shift'.
 */
const KEY_MAP: Record<string, InputAction> = {
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
  arrowdown: 'softDrop',
  s: 'softDrop',
  ' ': 'hardDrop',
  arrowup: 'rotateCW',
  x: 'rotateCW',
  w: 'rotateCW',
  z: 'rotateCCW',
  q: 'rotateCCW',
  r: 'rotate180',
  c: 'hold',
  shift: 'hold',
  p: 'pause',
};

export function actionForKey(key: string): InputAction | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  return KEY_MAP[key.toLowerCase()] ?? null;
}

/**
 * A modifier combination (Ctrl+C, Alt+D, Cmd+S) is never a game action: the browser owns those
 * shortcuts, and the game must not swallow them.
 */
export function isModifiedCombo(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

export function actionToCommand(action: InputAction): AnyCommand {
  switch (action) {
    case 'left':
      return { type: CommandType.MovePiece, payload: { direction: 'left' } };
    case 'right':
      return { type: CommandType.MovePiece, payload: { direction: 'right' } };
    case 'softDrop':
      return { type: CommandType.SoftDrop };
    case 'hardDrop':
      return { type: CommandType.HardDrop };
    case 'rotateCW':
      return { type: CommandType.RotatePiece, payload: { direction: 'cw' } };
    case 'rotateCCW':
      return { type: CommandType.RotatePiece, payload: { direction: 'ccw' } };
    case 'rotate180':
      return { type: CommandType.RotatePiece, payload: { direction: '180' } };
    case 'hold':
      return { type: CommandType.HoldPiece };
    case 'pause':
      return { type: CommandType.PauseGame };
    default:
      return { type: CommandType.Tick, payload: { dt: 0 } };
  }
}
