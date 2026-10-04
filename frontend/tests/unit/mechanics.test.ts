/**
 * Block 3 mechanics: the 3-piece queue (A6), hold (A4), 180° rotation (A5).
 * Piece order is scripted (a stub factory) so the queue assertions are deterministic.
 */
import { GameEngine } from '../../src/shared/engine/game-engine';
import { BoardManager } from '../../src/shared/domain/board';
import { PIECE_SHAPES, PieceFactoryProvider, buildPiece } from '../../src/shared/domain/pieces';
import { GameMode, PieceType } from '../../src/shared/domain/types';
import { CommandType } from '../../src/shared/cqrs/commands';
import { QUEUE_SIZE } from '../../src/shared/config/game-config';

const W = 10;
const H = 20;

/** Deterministic stand-in for PieceFactoryProvider: a fixed, repeating piece order. */
function scriptedFactory(types: PieceType[]) {
  let index = 0;
  return {
    nextPieceType: () => types[index++ % types.length],
    createPiece: (type: PieceType) => buildPiece(type, PIECE_SHAPES[type][0]),
  };
}

function createEngine(
  mode: GameMode = GameMode.Arcade,
  script: PieceType[] = [PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L, PieceType.I, PieceType.O],
) {
  const engine = new GameEngine({
    onStateChange: () => {},
    onLineClear: () => {},
    onGameOver: () => {},
  });
  (engine as any).boardManager = new BoardManager(W, H);
  (engine as any).width = W;
  (engine as any).height = H;
  (engine as any).pieceFactory = script ? scriptedFactory(script) : new PieceFactoryProvider();
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode } });
  return engine;
}

/** Put the engine into an exact, hand-picked state (piece, rotation, position). */
function forceState(engine: GameEngine, type: PieceType, rotation: number, x: number, y: number) {
  (engine as any).currentPiece = buildPiece(type, PIECE_SHAPES[type][rotation]);
  (engine as any).currentRotation = { index: rotation };
  (engine as any).currentPos = { x, y };
  (engine as any)._isRunning = true;
  (engine as any)._isGameOver = false;
  (engine as any)._isPaused = false;
  (engine as any).gravityAccumulator = 0;
  (engine as any).lockAccumulator = 0;
  (engine as any).lockResets = 0;
}

const rotationOf = (engine: GameEngine) => engine.getCurrentRotation().index;

const boardOf = (engine: GameEngine) => (engine as any).boardManager as BoardManager;

describe('Next queue (A6)', () => {
  test('the game state exposes exactly QUEUE_SIZE upcoming pieces', () => {
    const engine = createEngine();
    const state = engine.getGameState();
    expect(state.nextQueue).toHaveLength(QUEUE_SIZE);
    expect(state.nextQueue).toEqual(['S', 'Z', 'J']); // T was taken as the active piece
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.T);
  });

  test('getNextPieceType is the front of the queue', () => {
    const engine = createEngine();
    expect(engine.getNextPieceType()).toBe(engine.getNextQueue()[0]);
  });

  test('locking a piece shifts the queue and keeps it at QUEUE_SIZE', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.HardDrop });
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.S);
    expect(engine.getNextQueue()).toEqual(['Z', 'J', 'L']);
    expect(engine.getGameState().nextQueue).toHaveLength(QUEUE_SIZE);
  });

  test('the queue is refilled after a hold as well', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getNextQueue()).toHaveLength(QUEUE_SIZE);
    expect(engine.getNextQueue()).toEqual(['Z', 'J', 'L']);
  });

  test('the queue snapshot is a copy: mutating it cannot corrupt the engine', () => {
    const engine = createEngine();
    const snapshot = engine.getGameState().nextQueue;
    snapshot[0] = PieceType.I;
    expect(engine.getNextQueue()).toEqual(['S', 'Z', 'J']);
  });
});

describe('Hold (A4)', () => {
  test('an empty hold slot takes the active piece and spawns the front of the queue', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.S);
    expect(engine.getHoldType()).toBe(PieceType.T);
    expect(engine.canHoldPiece()).toBe(false);
  });

  test('hold can be used once per piece: the second hold in the same piece is ignored', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.HoldPiece });
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.S);
    expect(engine.getHoldType()).toBe(PieceType.T);
  });

  test('the hold is available again on the next piece, and the held piece comes back', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.HoldPiece }); // T -> hold, S active
    engine.handleCommand({ type: CommandType.HardDrop });   // S locks, Z spawns
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.Z);
    expect(engine.canHoldPiece()).toBe(true);
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.T);
    expect(engine.getHoldType()).toBe(PieceType.Z);
  });

  test('hold does not score, does not lock, and does not end the game', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getScore()).toBe(0);
    expect(engine.isGameOver()).toBe(false);
    // The swapped piece (S, 3 cells wide) spawns centered at the top.
    expect(engine.getCurrentPos()).toEqual({ x: 3, y: 0 });
  });

  test('hold is ignored while paused', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.PauseGame });
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getCurrentPiece()?.type).toBe(PieceType.T);
    expect(engine.getHoldType()).toBeNull();
  });

  test('hold resets the lock delay of the replaced piece', () => {
    const engine = createEngine();
    forceState(engine, PieceType.O, 0, 4, 18); // grounded, lock timer running
    engine.handleCommand({ type: CommandType.Tick, payload: { dt: 250 } });
    engine.handleCommand({ type: CommandType.Tick, payload: { dt: 150 } });
    expect(engine.getLockAccumulator()).toBe(400);
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getLockAccumulator()).toBe(0);
    expect(engine.getLockResets()).toBe(0);
    expect(engine.getCurrentPos()).toEqual({ x: 3, y: 0 });
  });

  test('holdType and canHold are exposed to the view', () => {
    const engine = createEngine();
    expect(engine.getGameState().holdType).toBeNull();
    expect(engine.getGameState().canHold).toBe(true);
    engine.handleCommand({ type: CommandType.HoldPiece });
    expect(engine.getGameState().holdType).toBe('T');
    expect(engine.getGameState().canHold).toBe(false);
  });
});

describe('180° rotation (A5)', () => {
  test('one command turns the piece by 180° in both directions', () => {
    const engine = createEngine();

    forceState(engine, PieceType.T, 0, 3, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(engine)).toBe(2);
    expect(engine.getCurrentPiece()?.shape).toEqual(PIECE_SHAPES[PieceType.T][2]);

    forceState(engine, PieceType.T, 1, 3, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(engine)).toBe(3);

    forceState(engine, PieceType.T, 3, 3, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(engine)).toBe(1);

    forceState(engine, PieceType.T, 2, 3, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(engine)).toBe(0);
  });

  test('180° lands on the same state as two quarter turns', () => {
    const engine = createEngine();

    forceState(engine, PieceType.L, 0, 3, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    const byHalfTurn = rotationOf(engine);

    forceState(engine, PieceType.L, 0, 3, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    expect(byHalfTurn).toBe(rotationOf(engine));
  });

  test('180° uses its own kicks: a blocked half turn slides into the free side', () => {
    const engine = createEngine();
    boardOf(engine).setCell(0, 6, 5, true); // blocks the naive (0,0) half turn
    forceState(engine, PieceType.T, 1, 0, 5);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(engine)).toBe(3);
    expect(engine.getCurrentPos()).toEqual({ x: 1, y: 5 }); // kick (+1, 0)
    expect(engine.isGameOver()).toBe(false);
  });

  test('a 180° with no room is refused in Arcade and kills in Hardcore', () => {
    const arcade = createEngine();
    for (const [x, y] of [[0, 6], [2, 5], [2, 7], [0, 5], [0, 7]]) {
      boardOf(arcade).setCell(x, y, 5, true);
    }
    forceState(arcade, PieceType.T, 1, 0, 5);
    arcade.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(arcade)).toBe(1);
    expect(arcade.getCurrentPos()).toEqual({ x: 0, y: 5 });
    expect(arcade.isGameOver()).toBe(false);

    const hardcore = createEngine(GameMode.Hardcore, [PieceType.T]);
    for (const [x, y] of [[0, 6], [2, 5], [2, 7], [0, 5], [0, 7]]) {
      boardOf(hardcore).setCell(x, y, 5, true);
    }
    forceState(hardcore, PieceType.T, 1, 0, 5);
    hardcore.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(hardcore.isGameOver()).toBe(true);
  });

  test('a 180° while grounded spends a lock-delay reset', () => {
    const engine = createEngine();
    forceState(engine, PieceType.T, 0, 3, 18); // resting on the floor
    expect(engine.isGrounded()).toBe(true);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: '180' } });
    expect(rotationOf(engine)).toBe(2);
    expect(engine.getLockResets()).toBe(1);
    expect(engine.getLockAccumulator()).toBe(0);
  });
});
