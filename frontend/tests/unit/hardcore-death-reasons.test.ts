/**
 * Block 8 (post-phase-5 tail): every Hardcore death must carry a *cause* the player can read.
 *
 * Hardcore kills for things Arcade never does (a move into a wall, a refused rotation). Before this
 * the overlay said only "GAME OVER" — on a nearly empty board that reads as a bug. The engine now
 * records why it died, and these tests pin the exact cause for each death path, including the rule
 * that Arcade must not die and must not report a cause at all.
 */
import { GameEngine } from '../../src/shared/engine/game-engine';
import { BoardManager } from '../../src/shared/domain/board';
import { PIECE_SHAPES, buildPiece } from '../../src/shared/domain/pieces';
import { GameMode, GameOverReason, PieceType } from '../../src/shared/domain/types';
import { CommandType } from '../../src/shared/cqrs/commands';

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
  test('Arcade: a move into the wall does not end the game and reports no cause', () => {
    const engine = createEngine(GameMode.Arcade);
    forceState(engine, PieceType.O, 0, 0, 5);
    move(engine, 'left');
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getOverReason()).toBeNull();
    expect(reason(engine)).toBeNull();
  });

  test('Hardcore: a move into the wall ends the game with the wall-crash cause', () => {
    const engine = createEngine(GameMode.Hardcore);
    forceState(engine, PieceType.O, 0, 0, 5);
    move(engine, 'left');
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
    expect(reason(engine)).toBe(GameOverReason.HardcoreWallCrash);
  });

  test('Hardcore: a move into locked cells is the same cause, not a silent no-op', () => {
    const engine = createEngine(GameMode.Hardcore);
    // Horizontal I occupies row 10, columns 5..8 (rotation 0 puts its cells on bounding-box row 1).
    // A wall of locked cells starts at column 9: exactly one free step right, then death. The wall
    // sits low on purpose — the opening T spawn lands on rows 0..1 and must stay untouched.
    for (let y = 10; y < 14; y++) lock(engine, 9, y);
    forceState(engine, PieceType.I, 0, 4, 9);
    move(engine, 'right'); // x → 6, still valid
    expect(engine.isGameOver()).toBe(false);
    move(engine, 'right'); // x → 7 would put a cell into the locked column 9
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe(GameOverReason.HardcoreWallCrash);
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
    forceState(engine, PieceType.O, 0, 0, 5);
    move(engine, 'left');
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
    forceState(engine, PieceType.O, 0, 0, 5);
    move(engine, 'left');
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
