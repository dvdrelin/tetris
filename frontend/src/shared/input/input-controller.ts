/**
 * Input controller (B2): the only place that turns raw keyboard / touch events into game actions.
 *
 * Responsibilities:
 *  - keydown: ignore the operating-system auto-repeat (`e.repeat`) and ignore modified combos
 *    (Ctrl/Alt/Cmd), then either start a held action (press + DAS/ARR) or fire a one-shot action;
 *  - keyup: stop the repeat for that action;
 *  - update(): called once per animation frame, fires the DAS/ARR repeats that are due;
 *  - releaseAll(): forget every held key (pause, game over, blur, unmount).
 *
 * It never touches the engine directly: it hands finished actions to the `fire` callback supplied
 * by GameView, which routes them to the store. That keeps the controller testable with a fake
 * clock and a fake dispatcher.
 */
import { DAS_CONFIG } from '../config/game-config';
import { InputAction, actionForKey, isHeldAction, isModifiedCombo } from './input-actions';
import { RepeatConfig, RepeatController } from './repeat-controller';

export interface InputControllerOptions {
  /** Called exactly when an action must happen (once per press and once per due repeat). */
  fire: (action: InputAction) => void;
  /** Injectable clock in milliseconds. Defaults to performance.now() in a browser. */
  now?: () => number;
  /** DAS/ARR values; default is the frozen DAS_CONFIG from game-config.ts. */
  repeat?: RepeatConfig;
}

export class InputController {
  private readonly fire: (action: InputAction) => void;
  private readonly now: () => number;
  private readonly repeat: RepeatController;

  constructor(options: InputControllerOptions) {
    this.fire = options.fire;
    this.now = options.now ?? defaultNow;
    this.repeat = new RepeatController(this.fire, options.repeat ?? DAS_CONFIG, this.now);
  }

  /**
   * Handle a physical keydown. Returns the action it produced, or null when the event is not a
   * game input. `repeat` is KeyboardEvent.repeat: the OS auto-repeat is dropped because DAS/ARR
   * owns the timing.
   */
  keyDown(key: string, isOsRepeat: boolean, modified = false): InputAction | null {
    if (isOsRepeat) return null;
    if (modified) return null;
    const action = actionForKey(key);
    if (!action) return null;
    if (isHeldAction(action)) {
      this.repeat.press(action);
      return action;
    }
    this.fire(action);
    return action;
  }

  /** Handle a keydown event object directly (keyboard path used by GameView). */
  handleKeyDown(e: KeyboardEvent): InputAction | null {
    return this.keyDown(e.key, e.repeat, isModifiedCombo(e));
  }

  /** Handle a keyup event: only held actions have repeat state to clear. */
  handleKeyUp(e: KeyboardEvent): InputAction | null {
    const action = actionForKey(e.key);
    if (!action || !isHeldAction(action)) return null;
    this.repeat.release(action);
    return action;
  }

  /** Touch buttons use the same vocabulary: press starts DAS/ARR, release stops it. */
  pressAction(action: InputAction): void {
    if (isHeldAction(action)) {
      this.repeat.press(action);
      return;
    }
    this.fire(action);
  }

  releaseAction(action: InputAction): void {
    if (isHeldAction(action)) this.repeat.release(action);
  }

  /** Fire every repeat that is due. Call once per animation frame. */
  update(): InputAction | null {
    return this.repeat.update();
  }

  releaseAll(): void {
    this.repeat.releaseAll();
  }

  activeAction(): InputAction | null {
    return this.repeat.activeAction();
  }

  heldActions(): InputAction[] {
    return this.repeat.heldActions();
  }
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
