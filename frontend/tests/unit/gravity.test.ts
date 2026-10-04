import { GameEngine } from '../../src/shared/engine/game-engine';
import { BoardManager } from '../../src/shared/domain/board';
import { PIECE_SHAPES, PieceFactoryProvider, buildPiece } from '../../src/shared/domain/pieces';
import { GameMode, PieceType } from '../../src/shared/domain/types';
import { CommandType } from '../../src/shared/cqrs/commands';
import { HARDCORE_SPEED_MULTIPLIER, SPEED_CONFIG, dropInterval } from '../../src/shared/config/game-config';

const W = 10;
const H = 20;
// Mirrors MAX_TICK_DELTA_MS in game-engine.ts: a Tick delta above this is clamped.
const MAX_DT = 250;

function createEngine(mode: GameMode = GameMode.Arcade) {
  const engine = new GameEngine({
    onStateChange: () => {},
    onLineClear: () => {},
    onGameOver: () => {},
  });
  (engine as any).boardManager = new BoardManager(W, H);
  (engine as any).pieceFactory = new PieceFactoryProvider();
  (engine as any).width = W;
  (engine as any).height = H;
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode } });
  return engine;
}

/** Put the engine into an exact, hand-picked state (piece, rotation, position). */
function forceState(engine: GameEngine, type: PieceType, rotation: number, x: number, y: number) {
  const shape = PIECE_SHAPES[type][rotation];
  (engine as any).currentPiece = buildPiece(type, shape);
  (engine as any).currentRotation = { index: rotation };
  (engine as any).currentPos = { x, y };
  (engine as any)._isRunning = true;
  (engine as any)._isGameOver = false;
  (engine as any)._isPaused = false;
}

const tick = (engine: GameEngine, dt: number) =>
  engine.handleCommand({ type: CommandType.Tick, payload: { dt } });

const lockedCells = (engine: GameEngine) => {
  let count = 0;
  engine.getBoardSnapshot().forEach((row) => row.forEach((v) => { if (v !== 0) count++; }));
  return count;
};

describe('dropInterval (single source of gravity)', () => {
  test('Arcade keeps the frozen table: 800ms at level 1, 50ms from level 16 on', () => {
    expect(dropInterval(1, GameMode.Arcade)).toBe(800);
    expect(dropInterval(2, GameMode.Arcade)).toBe(750);
    expect(dropInterval(15, GameMode.Arcade)).toBe(100);
    expect(dropInterval(16, GameMode.Arcade)).toBe(50);
    expect(dropInterval(40, GameMode.Arcade)).toBe(SPEED_CONFIG.minInterval);
  });

  test('Hardcore gravity is the same table halved, never below minInterval', () => {
    expect(dropInterval(1, GameMode.Hardcore)).toBe(800 * HARDCORE_SPEED_MULTIPLIER);
    expect(dropInterval(15, GameMode.Hardcore)).toBe(50);
    expect(dropInterval(16, GameMode.Hardcore)).toBe(SPEED_CONFIG.minInterval);
  });

  test('a broken level value falls back to level 1 instead of NaN or a negative interval', () => {
    expect(dropInterval(0, GameMode.Arcade)).toBe(800);
    expect(dropInterval(-5, GameMode.Arcade)).toBe(800);
    expect(dropInterval(NaN, GameMode.Arcade)).toBe(800);
  });
});

describe('Engine-owned gravity timing (Tick carries dt, not a ready-made step)', () => {
  test('a Tick shorter than the interval does not move the piece', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 4, 5);
    tick(engine, MAX_DT); // 250ms < 800ms
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
    expect(engine.getGravityAccumulator()).toBe(250);
  });

  test('the unpaid part of the interval is carried into the next Tick', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 4, 5);
    tick(engine, 200);
    tick(engine, 200);
    tick(engine, 200);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
    expect(engine.getGravityAccumulator()).toBe(600);
    tick(engine, 200); // 600 + 200 = 800
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 6 });
    expect(engine.getGravityAccumulator()).toBe(0);
  });

  test('one frame can pay for several rows instead of losing the extra time', () => {
    const engine = createEngine(GameMode.Arcade);
    (engine as any).level = 15; // interval 100ms
    forceState(engine, PieceType.O, 0, 4, 5);
    tick(engine, 250);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 7 });
    expect(engine.getGravityAccumulator()).toBe(50);
  });

  test('gravity follows the level, and the engine reads the same table the config defines', () => {
    const engine = createEngine(GameMode.Arcade);
    (engine as any).level = 15; // interval 100ms
    forceState(engine, PieceType.O, 0, 4, 5);
    expect(engine.getDropInterval()).toBe(100);
    tick(engine, 100);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 6 });
  });

  test('Hardcore has gravity too: it falls on the halved interval', () => {
    const engine = createEngine(GameMode.Hardcore);
    forceState(engine, PieceType.O, 0, 4, 5);
    expect(engine.getDropInterval()).toBe(400);
    tick(engine, 200);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
    tick(engine, 200);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 6 });
  });

  test('a background-tab gap is capped: one Tick cannot teleport the piece to the floor', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 4, 5);
    tick(engine, 60_000);
    // Clamped to 250ms, which is below the 800ms interval of level 1.
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
    expect(engine.getElapsedMs()).toBe(MAX_DT);
  });

  test('a negative or NaN dt cannot push the piece up or corrupt the accumulator', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 4, 5);
    tick(engine, -5000);
    tick(engine, NaN);
    tick(engine, Infinity);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
    expect(engine.getGravityAccumulator()).toBe(0);
    expect(engine.getElapsedMs()).toBe(0);
  });

  test('gravity does not run while paused or after game over', () => {
    const engine = createEngine(GameMode.Arcade);
    (engine as any).level = 16; // interval 50ms, so 250ms would move the piece
    forceState(engine, PieceType.O, 0, 4, 5);
    engine.handleCommand({ type: CommandType.PauseGame });
    tick(engine, MAX_DT);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
    engine.handleCommand({ type: CommandType.ResumeGame });
    (engine as any)._isGameOver = true;
    tick(engine, MAX_DT);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
  });

  test('a gravity landing locks the piece and leftover time is not spent on the new piece', () => {
    const engine = createEngine(GameMode.Arcade);
    (engine as any).level = 16; // interval 50ms: 250ms would be 5 rows
    forceState(engine, PieceType.O, 0, 4, 17); // rows 17-18, one row of travel left
    tick(engine, MAX_DT);
    expect(lockedCells(engine)).toBe(4); // the O piece is locked
    expect(engine.getCurrentPos().y).toBe(0); // the spawned piece starts at the top, unpaid
    expect(engine.getGravityAccumulator()).toBe(0);
    expect(engine.isGameOver()).toBe(false);
  });
});

describe('Down is a soft drop, not a death', () => {
  test('MovePiece{down} moves one row and scores soft drop', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 4, 5);
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'down' } });
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 6 });
    expect(engine.getScore()).toBe(10);
  });

  test('MovePiece{down} onto the floor locks the piece instead of ending a Hardcore game', () => {
    const engine = createEngine(GameMode.Hardcore);
    forceState(engine, PieceType.O, 0, 4, 18);
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'down' } });
    expect(engine.isGameOver()).toBe(false);
    expect(lockedCells(engine)).toBe(4);
  });

  test('Hardcore still kills on a blocked sideways move', () => {
    const engine = createEngine(GameMode.Hardcore);
    forceState(engine, PieceType.O, 0, 0, 5);
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    expect(engine.isGameOver()).toBe(true);
  });

  test('a gravity landing in Hardcore locks normally and does not kill', () => {
    const engine = createEngine(GameMode.Hardcore);
    forceState(engine, PieceType.O, 0, 4, 18);
    tick(engine, 200);
    tick(engine, 200); // 400ms = the Hardcore interval of level 1
    expect(engine.isGameOver()).toBe(false);
    expect(lockedCells(engine)).toBe(4);
  });
});
