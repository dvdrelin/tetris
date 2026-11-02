/**
 * Block 8 (post-phase-5 tail): every Hardcore death must carry a *cause* the player can read.
 *
 * Hardcore kills for things Arcade never does (a move into a wall, a refused rotation). Before this
 * the overlay said only "GAME OVER" — on a nearly empty board that reads as a bug. The engine now
 * records why it died, and these tests pin the exact cause for each death path, including the rule
 * that Arcade must not die and must not report a cause at all.
 */
import { GameEngine } from '@neon-tetris/shared/engine/game-engine';
import { BoardManager } from '@neon-tetris/shared/domain/board';
import { PIECE_SHAPES, buildPiece } from '@neon-tetris/shared/domain/pieces';
import { GameMode, GameOverReason, PieceType } from '@neon-tetris/shared/domain/types';
import { CommandType } from '@neon-tetris/shared/cqrs/commands';

const W = 10;
const H = 20;

function createEngine(mode: GameMode = GameMode.Arcade) {
  // Scripted (T first) exactly like mechanics.test.ts: the refused-rotation fixtures there are
  // proven, and a random first spawn piece makes "the next piece" untestable.
  let index = 0;
  const script = [PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L, PieceType.I, PieceType.O];
  const engine = new GameEngine({
    onStateChange: () => {},
    onLineClear: () => {},
    onGameOver: () => {},
  });
  (engine as any).boardManager = new BoardManager(W, H);
  (engine as any).width = W;
  (engine as any).height = H;
  (engine as any).pieceFactory = {
    nextPieceType: () => script[index++ % script.length],
    createPiece: (type: PieceType) => buildPiece(type, PIECE_SHAPES[type][0]),
  };
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode } });
  return engine;
}

function forceState(engine: GameEngine, type: PieceType, rotation: number, x: number, y: number) {
  const shape = PIECE_SHAPES[type][rotation];
  (engine as any).currentPiece = buildPiece(type, shape);
  (engine as any).currentRotation = { index: rotation };
  (engine as any).currentPos = { x, y };
  (engine as any)._isRunning = true;
  (engine as any)._isGameOver = false;
  (engine as any)._isPaused = false;
}

const move = (engine: GameEngine, direction: 'left' | 'right' | 'down') =>
  engine.handleCommand({ type: CommandType.MovePiece, payload: { direction } });

const rotate = (engine: GameEngine, direction: 'cw' | 'ccw' | '180') =>
  engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction } });

// Locking through BoardManager, never by writing the cell array: the engine's collision rule
// reads `locked`, so a bare `value =` write is invisible to it (this cost a debugging loop).
const lock = (engine: GameEngine, x: number, y: number) => {
  ((engine as any).boardManager as BoardManager).setCell(x, y, 5, true);
};

const reason = (engine: GameEngine) => engine.getGameState().overReason;

describe('Hardcore death causes', () => {
  // Arcade is the contrast in every case below: a refused sideways move is a no-op, in any quantity,
  // and no cause is ever reported.
  test('Arcade: a move into the wall does not end the game and reports no cause', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 1, 5);
    for (let i = 0; i < 3; i++) move(engine, 'left');
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getOverReason()).toBeNull();
    expect(reason(engine)).toBeNull();
    expect(engine.getCurrentPos()).toEqual({ x: 0, y: 5 });
  });

  test('Hardcore: the side wall never ends the game — a held key is a no-op', () => {
    // The A13 refinement, and the exact prod symptom: holding `←`/`→` against the wall (DAS/ARR, B2)
    // used to be an unavoidable death on an almost empty board. Grinding on the wall is now harmless
    // in both modes; only the stack kills.
    const engine = createEngine(GameMode.Hardcore);
    forceState(engine, PieceType.O, 0, 1, 5);
    for (let i = 0; i < 8; i++) move(engine, 'left');
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getOverReason()).toBeNull();
    expect(engine.getCurrentPos()).toEqual({ x: 0, y: 5 });
  });

  test('Hardcore: crashing into a single placed block is death with the crash cause', () => {
    const engine = createEngine(GameMode.Hardcore);
    // Horizontal I lies on row 10, columns 5..8 at x=5 (rotation 0 puts its cells on bounding-box
    // row 1). The obstacle sits low on purpose: the opening T spawn lands on rows 0..1 and must stay
    // untouched.
    lock(engine, 9, 10);
    forceState(engine, PieceType.I, 0, 4, 9);
    move(engine, 'right'); // x=5: cells 5..8, free
    expect(engine.isGameOver()).toBe(false);
    move(engine, 'right'); // x=6: a cell would enter the locked (9,10) → the stack stopped it
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
  });

  test('Hardcore: a wall of locked cells is lethal on every attempt, press or repeat alike', () => {
    const engine = createEngine(GameMode.Hardcore);
    for (let y = 10; y < 14; y++) lock(engine, 9, y);
    forceState(engine, PieceType.I, 0, 5, 9); // flush: x=6 would put a cell into the locked column
    move(engine, 'right');
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
    for (let i = 0; i < 4; i++) move(engine, 'right');
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
    expect(engine.getCurrentPos()).toEqual({ x: 5, y: 9 });

    // One step further out the piece can travel first, and the attempt that follows still kills.
    const bump = createEngine(GameMode.Hardcore);
    for (let y = 10; y < 14; y++) lock(bump, 9, y);
    forceState(bump, PieceType.I, 0, 4, 9);
    move(bump, 'right'); // x=5: a free step existed
    expect(bump.isGameOver()).toBe(false);
    move(bump, 'right'); // x=6: into the locked column
    expect(bump.isGameOver()).toBe(true);
  });

  test('Hardcore: a piece pressed against both the wall and a block dies (the stack stopped it)', () => {
    const engine = createEngine(GameMode.Hardcore);
    lock(engine, 9, 6); // the block sits at the very edge: wall and stack at once
    forceState(engine, PieceType.O, 0, 7, 5); // cells (7,5)(8,5)(7,6)(8,6)
    move(engine, 'right'); // (9,5) is the wall, (9,6) is a locked cell → lethal
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
  });

  test('Hardcore: an internal block is lethal, the floor and the side walls are not', () => {
    const engine = createEngine(GameMode.Hardcore);
    lock(engine, 8, 6); // a single locked cell in the O's path
    forceState(engine, PieceType.O, 0, 5, 5); // cells (5,5)(6,5)(5,6)(6,6)
    move(engine, 'right'); // x=6: (7,6) is free, so the move happens
    expect(engine.isGameOver()).toBe(false);
    move(engine, 'right'); // (8,6) blocks the next step → death
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);

    const floor = createEngine(GameMode.Hardcore);
    forceState(floor, PieceType.O, 0, 4, 18); // on the floor: sideways is wall-free
    move(floor, 'down'); // soft drop: locks instead of killing
    expect(floor.isGameOver()).toBe(false);

    const wall = createEngine(GameMode.Hardcore);
    forceState(wall, PieceType.O, 0, 8, 5);
    for (let i = 0; i < 4; i++) move(wall, 'right'); // into the right wall, repeatedly
    expect(wall.isGameOver()).toBe(false);
    expect(wall.getCurrentPos()).toEqual({ x: 8, y: 5 });
  });

  test('Arcade: a refused rotation is not a death and leaves the piece unchanged', () => {
    const engine = createEngine(GameMode.Arcade);
    // Box the T in on every 180° kick offset — the same fixture mechanics.test.ts proves refused.
    for (const [x, y] of [[0, 6], [2, 5], [2, 7], [0, 5], [0, 7]]) lock(engine, x, y);
    forceState(engine, PieceType.T, 1, 0, 5);
    rotate(engine, '180');
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getOverReason()).toBeNull();
    expect(engine.getGameState().currentRotation.index).toBe(1);
    expect(engine.getCurrentPos()).toEqual({ x: 0, y: 5 });
  });

  test('Hardcore: a refused 180° ends the game with the rotation-stuck cause', () => {
    const engine = createEngine(GameMode.Hardcore);
    for (const [x, y] of [[0, 6], [2, 5], [2, 7], [0, 5], [0, 7]]) lock(engine, x, y);
    forceState(engine, PieceType.T, 1, 0, 5);
    rotate(engine, '180');
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreRotationStuck);
    expect(reason(engine)).toBe(GameOverReason.HardcoreRotationStuck);
  });

  test('Hardcore: a refused cw rotation reports the same rotation-stuck cause', () => {
    // Derived from KICKS_JLSTZ['0>1'] = (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2) in engine coords
    // (+y is DOWN here). The T sits flush against the left wall, so every negative-x kick is out
    // of bounds; the two +2 kicks are blocked by locked cells, which leaves nothing → refusal.
    const fixture = (mode: GameMode) => {
      const engine = createEngine(mode);
      lock(engine, 0, 7); // blocks kick (0,+2)
      lock(engine, 1, 7); // blocks kick (-1,+2)
      forceState(engine, PieceType.T, 0, -1, 5);
      return engine;
    };

    const arcade = fixture(GameMode.Arcade);
    rotate(arcade, 'cw');
    expect(arcade.isGameOver()).toBe(false);
    expect(arcade.getGameState().currentRotation.index).toBe(0);
    expect(arcade.getOverReason()).toBeNull();

    const hardcore = fixture(GameMode.Hardcore);
    rotate(hardcore, 'cw');
    expect(hardcore.isGameOver()).toBe(true);
    expect(hardcore.getOverReason()).toBe(GameOverReason.HardcoreRotationStuck);
  });

  test('block-out in either mode reports the shared cause and is the only Arcade death', () => {
    for (const mode of [GameMode.Arcade, GameMode.Hardcore]) {
      const engine = createEngine(mode);
      // Row 1 fully locked, row 0 locked except column 5 — the gap keeps `clearLines()` from
      // wiping the fixture before the next spawn, which would hide the block-out.
      for (let x = 0; x < W; x++) { lock(engine, x, 1); if (x !== 5) lock(engine, x, 0); }
      forceState(engine, PieceType.I, 0, 5, 14); // horizontal I, its cells on bounding-box row 1
      engine.handleCommand({ type: CommandType.HardDrop }); // locks it on the floor, spawns the next piece
      expect(engine.isGameOver()).toBe(true);
      expect(engine.getOverReason()).toBe(GameOverReason.BlockOut);
      expect(reason(engine)).toBe(GameOverReason.BlockOut);
    }
  });

  test('a restart clears the cause: a fresh game reports no reason', () => {
    const engine = createEngine(GameMode.Hardcore);
    lock(engine, 9, 10);
    forceState(engine, PieceType.I, 0, 4, 9);
    move(engine, 'right'); // x=5: free
    move(engine, 'right'); // x=6: into the locked column → death
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Hardcore } });
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getOverReason()).toBeNull();
    expect(reason(engine)).toBeNull();
  });

  test('a snapshot taken before death has no cause (the field is not a leftover default)', () => {
    const engine = createEngine(GameMode.Hardcore);
    expect(engine.getGameState().overReason).toBeNull();
  });

  test('a snapshot after death carries the cause — the renderer reads it from there', () => {
    const engine = createEngine(GameMode.Hardcore);
    lock(engine, 9, 10);
    forceState(engine, PieceType.I, 0, 4, 9);
    move(engine, 'right');
    move(engine, 'right');
    expect(engine.getGameState().isGameOver).toBe(true);
    expect(engine.getGameState().overReason).toBe(GameOverReason.HardcoreWallCrash);
  });

  test('stop() (leaving the play) never invents a cause', () => {
    const engine = createEngine(GameMode.Hardcore);
    engine.stop();
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getOverReason()).toBeNull();
  });
});
