/**
 * DAS / ARR (B2).
 *
 * DAS (Delayed Auto Shift) is the pause between the first move — which happens on the press
 * itself — and the start of auto-repeat. ARR (Auto Repeat Rate) is the gap between the repeated
 * moves. The operating system's own key repeat (`e.repeat`) is never used: it is slow, its timing
 * is a user setting, and it cannot be tested, so the harness here owns all repeat timing.
 *
 * The controller is pure bookkeeping over an injected clock: no DOM, no requestAnimationFrame, no
 * Date.now(). A test drives it with `jest.advanceTimersByTime()`, and GameView drives it from its
 * own animation frame.
 */
import { InputAction, isHeldAction } from './input-actions';

export interface RepeatConfig {
  dasMs: number;
  arrMs: number;
}

export class RepeatController {
  // Press order of the held actions. The last entry is the active one: the most recently pressed
  // key wins, and releasing it hands control back to the key that is still held down.
  private held: InputAction[] = [];
  private pressedAt = new Map<InputAction, number>();
  private lastFireAt = new Map<InputAction, number>();

  constructor(
    private readonly fire: (action: InputAction) => void,
    private readonly config: RepeatConfig,
    private readonly now: () => number,
  ) {}

  /**
   * Register a press. The first action fires immediately; DAS only delays the repeats that
   * follow. Pressing the same action twice (a keydown without its keyup) does not restart DAS.
   */
  press(action: InputAction): boolean {
    if (!isHeldAction(action)) return false;
    const t = this.now();
    const alreadyHeld = this.held.includes(action);
    if (!alreadyHeld) {
      this.held.push(action);
      this.pressedAt.set(action, t);
    }
    this.lastFireAt.set(action, t);
    this.fire(action);
    return true;
  }

  /** Release one action: its repeats stop, and any other still-held action becomes active. */
  release(action: InputAction): boolean {
    const index = this.held.indexOf(action);
    if (index === -1) return false;
    this.held.splice(index, 1);
    this.pressedAt.delete(action);
    this.lastFireAt.delete(action);
    return true;
  }

  /** Drop every held action: used on pause, game over, window blur and component unmount. */
  releaseAll(): void {
    this.held = [];
    this.pressedAt.clear();
    this.lastFireAt.clear();
  }

  /**
   * Called once per input frame. Fires at most one repeated move: a stalled frame must not
   * teleport a piece across the board, so a backlog is never paid back in one update.
   */
  update(): InputAction | null {
    const action = this.held[this.held.length - 1];
    if (!action) return null;

    const t = this.now();
    const pressedAt = this.pressedAt.get(action);
    if (pressedAt === undefined) return null;
    if (t - pressedAt < this.config.dasMs) return null;

    const lastFireAt = this.lastFireAt.get(action) ?? pressedAt;
    if (t - lastFireAt < this.config.arrMs) return null;

    this.lastFireAt.set(action, t);
    this.fire(action);
    return action;
  }

  activeAction(): InputAction | null {
    return this.held[this.held.length - 1] ?? null;
  }

  heldActions(): InputAction[] {
    return [...this.held];
  }
}
