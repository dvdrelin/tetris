/**
 * Input tests (B2): the key map, the DAS/ARR controller and the keyboard glue.
 *
 * Timing is driven by Jest fake timers: `jest.advanceTimersByTime(ms)` also moves `Date.now()`
 * under the modern fake-timer implementation, and the controller takes its clock as an injected
 * function, so no test waits for real time.
 */
import { RepeatController } from '../../src/shared/input/repeat-controller';
import { InputController } from '../../src/shared/input/input-controller';
import { HELD_ACTIONS, actionForKey, actionToCommand, isHeldAction } from '../../src/shared/input/input-actions';
import { DAS_CONFIG } from '../../src/shared/config/game-config';
import { CommandType } from '../../src/shared/cqrs/commands';
import { InputAction } from '../../src/shared/input/input-actions';

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

const clock = () => Date.now();

function makeController() {
  const fired: InputAction[] = [];
  const controller = new RepeatController((action) => fired.push(action), DAS_CONFIG, clock);
  return { fired, controller };
}

function makeInput() {
  const fired: InputAction[] = [];
  const input = new InputController({ fire: (action) => fired.push(action), now: clock });
  return { fired, input };
}

describe('DAS/ARR configuration (B2)', () => {
  test('guideline values are 167 ms DAS and 33 ms ARR', () => {
    expect(DAS_CONFIG.dasMs).toBe(167);
    expect(DAS_CONFIG.arrMs).toBe(33);
  });

  test('the config object is frozen', () => {
    expect(Object.isFrozen(DAS_CONFIG)).toBe(true);
  });
});

describe('Key map (B1)', () => {
  test('movement keys, lower case and capital letters', () => {
    expect(actionForKey('ArrowLeft')).toBe('left');
    expect(actionForKey('a')).toBe('left');
    expect(actionForKey('A')).toBe('left');
    expect(actionForKey('ArrowRight')).toBe('right');
    expect(actionForKey('d')).toBe('right');
    expect(actionForKey('D')).toBe('right');
    expect(actionForKey('ArrowDown')).toBe('softDrop');
    expect(actionForKey('s')).toBe('softDrop');
    expect(actionForKey('S')).toBe('softDrop');
  });

  test('rotation, hold, hard drop and pause keys', () => {
    expect(actionForKey('ArrowUp')).toBe('rotateCW');
    expect(actionForKey('x')).toBe('rotateCW');
    expect(actionForKey('w')).toBe('rotateCW');
    expect(actionForKey('z')).toBe('rotateCCW');
    expect(actionForKey('q')).toBe('rotateCCW');
    expect(actionForKey('r')).toBe('rotate180');
    expect(actionForKey('R')).toBe('rotate180');
    expect(actionForKey('c')).toBe('hold');
    expect(actionForKey('C')).toBe('hold');
    expect(actionForKey('Shift')).toBe('hold');
    expect(actionForKey(' ')).toBe('hardDrop');
    expect(actionForKey('p')).toBe('pause');
    expect(actionForKey('P')).toBe('pause');
  });

  test('keys owned by the view or by the browser are not game actions', () => {
    expect(actionForKey('Escape')).toBeNull();
    expect(actionForKey('Enter')).toBeNull();
    expect(actionForKey('Tab')).toBeNull();
    expect(actionForKey('j')).toBeNull();
    expect(actionForKey('')).toBeNull();
  });

  test('only left, right and soft drop auto-repeat', () => {
    expect(HELD_ACTIONS).toEqual(['left', 'right', 'softDrop']);
    expect(isHeldAction('left')).toBe(true);
    expect(isHeldAction('softDrop')).toBe(true);
    expect(isHeldAction('hardDrop')).toBe(false);
    expect(isHeldAction('rotate180')).toBe(false);
    expect(isHeldAction('hold')).toBe(false);
    expect(isHeldAction('pause')).toBe(false);
  });

  test('every action maps to the CQRS command the engine expects', () => {
    expect(actionToCommand('left')).toEqual({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    expect(actionToCommand('right')).toEqual({ type: CommandType.MovePiece, payload: { direction: 'right' } });
    expect(actionToCommand('softDrop')).toEqual({ type: CommandType.SoftDrop });
    expect(actionToCommand('hardDrop')).toEqual({ type: CommandType.HardDrop });
    expect(actionToCommand('rotateCW')).toEqual({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    expect(actionToCommand('rotateCCW')).toEqual({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } });
    expect(actionToCommand('rotate180')).toEqual({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(actionToCommand('hold')).toEqual({ type: CommandType.HoldPiece });
    expect(actionToCommand('pause')).toEqual({ type: CommandType.PauseGame });
  });
});

describe('RepeatController: DAS then ARR', () => {
  test('the first move happens on the press itself', () => {
    const { fired, controller } = makeController();
    controller.press('left');
    expect(fired).toEqual(['left']);
  });

  test('nothing repeats before DAS elapses', () => {
    const { fired, controller } = makeController();
    controller.press('left');
    for (let elapsed = 0; elapsed < 160; elapsed += 10) {
      jest.advanceTimersByTime(10);
      controller.update();
    }
    expect(fired).toEqual(['left']);
  });

  test('the first repeat happens at DAS, then every ARR', () => {
    const { fired, controller } = makeController();
    controller.press('left');

    jest.advanceTimersByTime(167);
    expect(controller.update()).toBe('left');
    expect(fired.length).toBe(2);

    jest.advanceTimersByTime(33);
    expect(controller.update()).toBe('left');
    expect(fired.length).toBe(3);

    // 32 ms is one millisecond short of ARR: still nothing.
    jest.advanceTimersByTime(32);
    expect(controller.update()).toBeNull();
    expect(fired.length).toBe(3);

    jest.advanceTimersByTime(1);
    expect(controller.update()).toBe('left');
    expect(fired.length).toBe(4);
  });

  test('one update fires at most one move, so a stalled frame cannot teleport the piece', () => {
    const { fired, controller } = makeController();
    controller.press('left');
    jest.advanceTimersByTime(1000);
    expect(controller.update()).toBe('left');
    expect(fired.length).toBe(2);
  });

  test('keyup stops the repeats', () => {
    const { fired, controller } = makeController();
    controller.press('right');
    jest.advanceTimersByTime(167);
    controller.update();
    controller.update();
    const afterRepeats = fired.length;
    expect(afterRepeats).toBeGreaterThan(1);

    controller.release('right');
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(50);
      expect(controller.update()).toBeNull();
    }
    expect(fired.length).toBe(afterRepeats);
    expect(controller.heldActions()).toEqual([]);
  });

  test('a duplicate press does not restart DAS', () => {
    const { fired, controller } = makeController();
    controller.press('left');
    jest.advanceTimersByTime(100);
    // keydown without its keyup: the action fires again, but the DAS clock still runs from 0.
    controller.press('left');
    expect(fired.length).toBe(2);

    jest.advanceTimersByTime(67); // t = 167
    expect(controller.update()).toBe('left');
    expect(fired.length).toBe(3);
  });

  test('the most recently pressed key wins, and releasing it hands control back', () => {
    const { fired, controller } = makeController();
    controller.press('left');
    jest.advanceTimersByTime(200);
    controller.update(); // left repeat #1
    controller.press('right'); // right fires immediately and becomes active

    const lastBeforeSwitch = fired[fired.length - 1];
    expect(lastBeforeSwitch).toBe('right');
    expect(controller.activeAction()).toBe('right');

    // Right is still inside its own DAS window.
    expect(controller.update()).toBeNull();

    jest.advanceTimersByTime(167);
    expect(controller.update()).toBe('right');

    controller.release('right');
    expect(controller.activeAction()).toBe('left');
    // Left has been held since t = 0, so its repeat is due immediately.
    expect(controller.update()).toBe('left');
    expect(fired[fired.length - 1]).toBe('left');
  });

  test('releaseAll forgets every held key', () => {
    const { fired, controller } = makeController();
    controller.press('left');
    controller.press('softDrop');
    expect(controller.heldActions()).toEqual(['left', 'softDrop']);

    controller.releaseAll();
    expect(controller.heldActions()).toEqual([]);
    expect(controller.activeAction()).toBeNull();

    const before = fired.length;
    jest.advanceTimersByTime(1000);
    expect(controller.update()).toBeNull();
    expect(fired.length).toBe(before);
  });

  test('soft drop repeats like movement', () => {
    const { fired, controller } = makeController();
    controller.press('softDrop');
    jest.advanceTimersByTime(167);
    controller.update();
    jest.advanceTimersByTime(33);
    controller.update();
    expect(fired).toEqual(['softDrop', 'softDrop', 'softDrop']);
  });

  test('one-shot actions are never registered for repeat', () => {
    const { fired, controller } = makeController();
    expect(controller.press('hardDrop')).toBe(false);
    expect(controller.press('rotateCW')).toBe(false);
    expect(controller.heldActions()).toEqual([]);
    expect(fired).toEqual([]);
  });
});

describe('InputController: keyboard glue', () => {
  test('the operating-system auto-repeat is ignored', () => {
    const { fired, input } = makeInput();
    input.keyDown('ArrowLeft', false);
    expect(fired).toEqual(['left']);

    // e.repeat === true: the OS repeating the key must not drive the game.
    for (let i = 0; i < 10; i++) {
      expect(input.keyDown('ArrowLeft', true)).toBeNull();
    }
    expect(fired).toEqual(['left']);

    jest.advanceTimersByTime(167);
    input.update();
    expect(fired.length).toBe(2); // the repeat came from DAS/ARR, not from the OS
  });

  test('Ctrl / Alt / Cmd combinations are left to the browser', () => {
    const { fired, input } = makeInput();
    expect(input.keyDown('s', false, true)).toBeNull();
    expect(input.keyDown('d', false, true)).toBeNull();
    expect(input.keyDown('r', false, true)).toBeNull();
    expect(fired).toEqual([]);
    expect(input.heldActions()).toEqual([]);
  });

  test('keyup ends the held action', () => {
    const { fired, input } = makeInput();
    input.handleKeyDown({ key: 'ArrowLeft', repeat: false } as KeyboardEvent);
    jest.advanceTimersByTime(167);
    input.update();
    const before = fired.length;

    input.handleKeyUp({ key: 'ArrowLeft', repeat: false } as KeyboardEvent);
    jest.advanceTimersByTime(500);
    input.update();
    expect(fired.length).toBe(before);
  });

  test('keyup of a one-shot key does nothing', () => {
    const { fired, input } = makeInput();
    input.handleKeyDown({ key: ' ', repeat: false } as KeyboardEvent);
    expect(fired).toEqual(['hardDrop']);
    expect(input.handleKeyUp({ key: ' ', repeat: false } as KeyboardEvent)).toBeNull();
    expect(fired).toEqual(['hardDrop']);
  });

  test('one-shot keys fire once no matter how long they are held', () => {
    const { fired, input } = makeInput();
    input.keyDown('r', false);
    input.keyDown('c', false);
    input.keyDown('p', false);
    jest.advanceTimersByTime(2000);
    for (let i = 0; i < 40; i++) input.update();
    expect(fired).toEqual(['rotate180', 'hold', 'pause']);
  });

  test('unknown keys produce nothing', () => {
    const { fired, input } = makeInput();
    expect(input.keyDown('Escape', false)).toBeNull();
    expect(input.keyDown('Enter', false)).toBeNull();
    expect(input.keyDown('F5', false)).toBeNull();
    expect(fired).toEqual([]);
  });

  test('touch buttons use the same actions and the same DAS/ARR', () => {
    const { fired, input } = makeInput();
    input.pressAction('right');
    expect(fired).toEqual(['right']);

    jest.advanceTimersByTime(167);
    input.update();
    jest.advanceTimersByTime(33);
    input.update();
    expect(fired.length).toBe(3);

    input.releaseAction('right');
    jest.advanceTimersByTime(500);
    input.update();
    expect(fired.length).toBe(3);

    input.pressAction('hardDrop');
    expect(fired[fired.length - 1]).toBe('hardDrop');
    expect(input.heldActions()).toEqual([]);
  });

  test('releaseAll clears held keys without firing anything', () => {
    const { fired, input } = makeInput();
    input.pressAction('left');
    input.pressAction('softDrop');
    const before = fired.length;
    input.releaseAll();
    jest.advanceTimersByTime(1000);
    input.update();
    expect(fired.length).toBe(before);
    expect(input.heldActions()).toEqual([]);
  });
});
