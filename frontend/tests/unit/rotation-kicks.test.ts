import { GameEngine } from '../../src/shared/engine/game-engine';
import { BoardManager } from '../../src/shared/domain/board';
import { PIECE_SHAPES, PieceFactoryProvider, buildPiece } from '../../src/shared/domain/pieces';
import { GameMode, PieceType } from '../../src/shared/domain/types';
import { CommandType } from '../../src/shared/cqrs/commands';

// Published SRS wall-kick tables, written in the classic form where +y is UP.
// The engine uses +y DOWN, so the reference y is negated when comparing.
// These tables are deliberately duplicated here: they pin the expected behaviour so a
// future "optimisation" of rotatePiece cannot silently change rotation semantics.
const REF_JLSTZ: Record<string, [number, number][]> = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '0>3': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
};
const REF_I: Record<string, [number, number][]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '3>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '3>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '0>3': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
};

const TYPES = [PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L];
const W = 10;
const H = 20;

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

const cellsOf = (engine: GameEngine) => {
  const piece = (engine as any).currentPiece;
  const pos = engine.getCurrentPos();
  const out: string[] = [];
  piece.shape.forEach((row: number[], r: number) => row.forEach((v: number, c: number) => {
    if (v === 1) out.push(`${pos.y + r},${pos.x + c}`);
  }));
  return out.sort();
};

/** Reference SRS outcome for one rotation, using the engine's own collision rules. */
function reference(engine: GameEngine, type: PieceType, from: number, dir: 1 | -1, x: number, y: number) {
  const to = ((from + dir) % 4 + 4) % 4;
  const table = type === PieceType.I ? REF_I : REF_JLSTZ;
  for (const [kx, ky] of table[`${from}>${to}`]) {
    const pos = { x: x + kx, y: y - ky };
    if (engine.isValidPosition(buildPiece(type, PIECE_SHAPES[type][to]), pos)) return { rot: to, pos };
  }
  return null;
}

describe('SRS wall kicks (engine vs published tables)', () => {
  test('every rotation on an empty 10x20 board matches published SRS (CW and CCW)', () => {
    let checked = 0;
    const mismatches: string[] = [];
    for (const type of TYPES) {
      for (let from = 0; from < 4; from++) {
        for (const dir of [1, -1] as const) {
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const engine = createEngine(GameMode.Arcade);
              const shape = PIECE_SHAPES[type][from];
              if (!engine.isValidPosition(buildPiece(type, shape), { x, y })) continue;
              forceState(engine, type, from, x, y);
              const expected = reference(engine, type, from, dir, x, y);
              engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: dir === 1 ? 'cw' : 'ccw' } });
              const got = { rot: engine.getCurrentRotation().index, pos: engine.getCurrentPos() };
              const moved = got.rot !== from || got.pos.x !== x || got.pos.y !== y;
              checked++;
              const ok = expected
                ? got.rot === expected.rot && got.pos.x === expected.pos.x && got.pos.y === expected.pos.y
                : !moved;
              if (!ok && mismatches.length < 10) {
                mismatches.push(`${PieceType[type]} ${from}->${(from + dir + 4) % 4} at (${x},${y}): ` +
                  `engine ${got.rot}@${got.pos.x},${got.pos.y}${moved ? '' : '/refused'}, ` +
                  `SRS ${expected ? `${expected.rot}@${expected.pos.x},${expected.pos.y}` : 'refused'}`);
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(8000);
    expect(mismatches).toEqual([]);
  });

  test('CW then CCW restores rotation and position', () => {
    for (const type of TYPES) {
      for (let r = 0; r < 4; r++) {
        const engine = createEngine();
        forceState(engine, type, r, 4, 5);
        engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
        engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } });
        expect(engine.getCurrentRotation().index).toBe(r);
        expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
        expect(cellsOf(engine)).toEqual(cellsOf((() => {
          const fresh = createEngine();
          forceState(fresh, type, r, 4, 5);
          return fresh;
        })()));
      }
    }
  });

  test('I against the right wall uses the SRS -1 kick (1 -> 2)', () => {
    const engine = createEngine();
    forceState(engine, PieceType.I, 1, 7, 3); // vertical I occupying column 9
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    expect(engine.getCurrentRotation().index).toBe(2);
    expect(engine.getCurrentPos()).toEqual({ x: 6, y: 3 });
    expect(cellsOf(engine)).toEqual(['5,6', '5,7', '5,8', '5,9']);
  });

  test('I against the right wall uses the SRS -1 kick (1 -> 0)', () => {
    const engine = createEngine();
    forceState(engine, PieceType.I, 1, 7, 3);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } });
    expect(engine.getCurrentRotation().index).toBe(0);
    expect(engine.getCurrentPos()).toEqual({ x: 6, y: 3 });
    expect(cellsOf(engine)).toEqual(['4,6', '4,7', '4,8', '4,9']);
  });

  test('T on the floor uses the SRS (-1,+1) kick (0 -> 1)', () => {
    const engine = createEngine();
    forceState(engine, PieceType.T, 0, 5, 18); // bar on the last row
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    expect(engine.getCurrentRotation().index).toBe(1);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 17 });
    expect(cellsOf(engine)).toEqual(['17,5', '18,5', '18,6', '19,5']);
  });

  test('rotation is refused (not teleported) when no kick fits', () => {
    const engine = createEngine();
    (engine as any).boardManager.setCell(0, 17, 1, true); // blocks the only kick that would fit
    forceState(engine, PieceType.T, 0, 0, 18); // left wall + floor
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    expect(engine.getCurrentRotation().index).toBe(0);
    expect(engine.getCurrentPos()).toEqual({ x: 0, y: 18 });
    expect(engine.isGameOver()).toBe(false); // Arcade: refusal is not fatal
  });

  test('every rotation keeps exactly 4 cells of the current piece', () => {
    for (const type of TYPES) {
      for (let r = 0; r < 4; r++) {
        const engine = createEngine();
        forceState(engine, type, r, 3, 5);
        for (let i = 0; i < 4; i++) {
          expect((engine as any).currentPiece.shape.flat().filter((v: number) => v === 1)).toHaveLength(4);
          engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
        }
      }
    }
  });
});

describe('soft drop and locking', () => {
  test('soft drop onto an occupied row does not score and does not overwrite locked cells', () => {
    const engine = createEngine();
    forceState(engine, PieceType.O, 0, 4, 2);
    const board = (engine as any).boardManager as BoardManager;
    board.setCell(4, 4, 5, true);
    board.setCell(5, 4, 5, true);
    const before = engine.getScore();
    engine.handleCommand({ type: CommandType.SoftDrop }); // blocked: piece already rests on the blocks
    expect(engine.getScore()).toBe(before);
    const cells = board.getCells();
    expect(cells[4][4].value).toBe(5);
    expect(cells[4][5].value).toBe(5);
  });

  test('soft drop to the floor locks the whole piece, not a truncated one', () => {
    const engine = createEngine();
    forceState(engine, PieceType.I, 1, 3, 0); // vertical I
    for (let i = 0; i < 30; i++) engine.handleCommand({ type: CommandType.SoftDrop });
    const cells = (engine as any).boardManager.getCells() as any[][];
    const locked = cells.flatMap((row, y) => row.map((c, x) => (c.locked ? `${y},${x}` : null)).filter(Boolean));
    expect(locked).toEqual(['16,5', '17,5', '18,5', '19,5']);
  });

  test('setCells never overwrites a locked cell', () => {
    const board = new BoardManager(10, 20);
    board.setCell(4, 4, 5, true);
    const piece = buildPiece(PieceType.O, [[1, 1], [1, 1]]);
    board.setCells(piece, { x: 4, y: 3 }); // covers (3,4) (3,5) (4,4) (4,5)
    const cells = board.getCells();
    expect(cells[4][4].value).toBe(5); // locked cell survived the placement
    expect(cells[4][4].locked).toBe(true);
    expect(cells[3][4].value).not.toBe(0); // free cells were still written
  });
});

describe('game over handling', () => {
  test('StartGame honours payload.mode (Hardcore actually activates)', () => {
    const engine = createEngine();
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Hardcore } });
    expect(engine.getGameState().mode).toBe(GameMode.Hardcore);
  });

  test('Hardcore: a refused rotation ends the game and stops the engine', () => {
    const engine = createEngine(GameMode.Hardcore);
    (engine as any).boardManager.setCell(0, 17, 1, true);
    forceState(engine, PieceType.T, 0, 0, 18);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    expect(engine.isGameOver()).toBe(true);
    expect(engine.isRunning()).toBe(false);
  });

  test('no scoring or movement after game over', () => {
    const engine = createEngine(GameMode.Hardcore);
    (engine as any).boardManager.setCell(0, 17, 1, true);
    forceState(engine, PieceType.T, 0, 0, 18);
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    const score = engine.getScore();
    engine.handleCommand({ type: CommandType.SoftDrop });
    engine.handleCommand({ type: CommandType.HardDrop });
    engine.handleCommand({ type: CommandType.Tick });
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'right' } });
    expect(engine.getScore()).toBe(score);
    expect(engine.getCurrentPos()).toEqual({ x: 0, y: 18 });
    expect(engine.getCurrentRotation().index).toBe(0);
  });

  test('a malformed RotatePiece direction is ignored; a valid one rotates', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.T, 0, 4, 5);

    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'nonsense' } } as any);
    expect(engine.getCurrentRotation().index).toBe(0);

    engine.handleCommand({ type: CommandType.RotatePiece, payload: {} } as any);
    expect(engine.getCurrentRotation().index).toBe(0);

    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } });
    expect(engine.getCurrentRotation().index).toBe(3);

    // An unknown MovePiece direction must not move the piece either.
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'sideways' } } as any);
    expect(engine.getCurrentPos()).toEqual({ x: 4, y: 5 });
  });
});
