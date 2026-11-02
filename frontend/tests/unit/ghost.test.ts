/**
 * Block 5 (A7): the ghost row is computed by the engine — `GameEngine.getGhostY()` is the single
 * source of truth. The old store copy rescanned the board with `value !== 0` and could disagree
 * with the one collision rule (`isValidPosition` / locked cells). These tests pin the engine's
 * ghost to the exact hard-drop landing in every case.
 */
import { GameEngine } from '@neon-tetris/shared/engine/game-engine';
import { BoardManager } from '@neon-tetris/shared/domain/board';
import { PIECE_SHAPES, PieceFactoryProvider, buildPiece } from '@neon-tetris/shared/domain/pieces';
import { GameMode, PieceType } from '@neon-tetris/shared/domain/types';
import { CommandType } from '@neon-tetris/shared/cqrs/commands';
import { QueryType } from '@neon-tetris/shared/cqrs/queries';
import { SCORING_CONFIG } from '@neon-tetris/shared/config/game-config';

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

const boardOf = (engine: GameEngine) => (engine as any).boardManager as BoardManager;

const lockedCells = (engine: GameEngine): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (boardOf(engine).getCell(x, y).locked) out.push([x, y]);
    }
  }
  return out;
};

describe('Ghost row in the engine (A7)', () => {
  test('empty board: the ghost sits exactly on the floor', () => {
    const engine = createEngine();
    // Spawn T in a 3x3 box: the bottom shape row is r = 1.
    forceState(engine, PieceType.T, 0, 3, 0);
    // Bottom cell occupies H-1 → ghost anchor y = H-2.
    expect(engine.getGhostY()).toBe(H - 2);
  });

  test('hard drop locks the piece exactly on the reported ghost row', () => {
    const engine = createEngine();
    forceState(engine, PieceType.T, 0, 3, 0);
    const ghostY = engine.getGhostY();
    engine.handleCommand({ type: CommandType.HardDrop });
    // T spawn orientation occupies rows r0 (row 1 of the shape) and r1 (row 2 of the shape).
    expect(lockedCells(engine)).toEqual([[4, ghostY], [3, ghostY + 1], [4, ghostY + 1], [5, ghostY + 1]]);
    expect(engine.getScore()).toBe(SCORING_CONFIG.hardDrop * (ghostY - 0));
  });

  test('the ghost stops on the first locked cell, not on the floor', () => {
    const engine = createEngine();
    forceState(engine, PieceType.T, 0, 3, 0);
    boardOf(engine).setCell(4, 10, 5, true); // under the T's bottom-middle cell (anchor + 1)
    // Anchor 8 keeps the bottom row at 9, one above the blocked cell.
    expect(engine.getGhostY()).toBe(8);
  });

  test('a stack of two rows narrows the ghost further', () => {
    const engine = createEngine();
    forceState(engine, PieceType.O, 0, 4, 0); // O occupies shape rows 0 and 1 at columns 4-5
    boardOf(engine).setCell(4, 14, 1, true);
    boardOf(engine).setCell(5, 13, 1, true);
    // The O bottom is anchor+1: (5,13) rules out anchor 12, (4,14) is never reached from 11.
    expect(engine.getGhostY()).toBe(11);
  });

  test('the ghost follows the current rotation, not the spawn shape', () => {
    const engine = createEngine();
    forceState(engine, PieceType.I, 0, 3, 0);
    expect(engine.getGhostY()).toBe(H - 2); // horizontal I occupies shape row 1
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    // Vertical I fills shape rows 0..3: the bottom is at anchor+3.
    expect(engine.getCurrentRotation().index).toBe(1);
    expect(engine.getGhostY()).toBe(H - 4);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } });
    expect(engine.getGhostY()).toBe(H - 2);
  });

  test('the ghost follows horizontal moves and sees per-column obstacles', () => {
    const engine = createEngine();
    forceState(engine, PieceType.O, 0, 4, 0);
    boardOf(engine).setCell(4, 14, 1, true); // blocks column 4 only
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    // The O moved to columns 3-4: column 4 still blocks, but at one row lower relative to the box.
    expect(engine.getCurrentPos().x).toBe(3);
    expect(engine.getGhostY()).toBe(12);
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    // Columns 2-3 are clear: the ghost drops to the floor.
    expect(engine.getGhostY()).toBe(H - 2);
  });

  test('a grounded piece reports its own row as the ghost', () => {
    const engine = createEngine();
    forceState(engine, PieceType.T, 0, 3, H - 2);
    expect(engine.isGrounded()).toBe(true);
    expect(engine.getGhostY()).toBe(H - 2);
  });

  test('no active piece → no ghost', () => {
    const engine = createEngine();
    (engine as any).currentPiece = null;
    expect(engine.getGhostY()).toBe(-1);
    engine.reset();
    expect(engine.getGhostY()).toBe(-1);
  });

  test('the ghost is readable as a CQRS query too', () => {
    const engine = createEngine();
    forceState(engine, PieceType.T, 0, 3, 0);
    expect(engine.handleQuery({ type: QueryType.GetGhost })).toBe(engine.getGhostY());
    expect(engine.handleQuery({ type: QueryType.GetGhost })).toBe(H - 2);
  });

  test('soft drop lands the piece on the ghost row too', () => {
    const engine = createEngine();
    forceState(engine, PieceType.O, 0, 4, 0);
    const ghostY = engine.getGhostY();
    for (let i = 0; i < H; i++) {
      engine.handleCommand({ type: CommandType.SoftDrop });
      if (!engine.getCurrentPiece() || lockedCells(engine).length > 0) break;
    }
    const cells = lockedCells(engine);
    expect(cells.length).toBe(4);
    expect(Math.max(...cells.map(([, y]) => y))).toBe(ghostY + 1); // O bottom row = anchor+1
  });
});
