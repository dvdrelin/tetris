// MP block A — engine events for the protocol: every successful placement emits a
// `piece_locked` payload (the thing a client will report and the server replay will compare),
// and global_step numbers placements for the session.
import {
  GameEngine, CommandType, GameMode, PieceLockInfo, PieceType,
} from '@neon-tetris/shared';

function trackedEngine(seed = 97531) {
  const locks: PieceLockInfo[] = [];
  const engine = new GameEngine({ onPieceLocked: (l) => locks.push({ ...l }) }, { seed });
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
  return { engine, locks };
}

describe('piece_locked events (MP block A)', () => {
  test('a hard drop emits one lock with the pre-spawn placement coordinates', () => {
    const { engine, locks } = trackedEngine();
    const pieceType = engine.getCurrentPiece()?.type;
    const pos = { ...engine.getCurrentPos() };
    engine.handleCommand({ type: CommandType.HardDrop });

    expect(locks).toHaveLength(1);
    const lock = locks[0];
    expect(lock.globalStep).toBe(1);
    expect(lock.pieceType).toBe(pieceType);
    // Hard drop moves the piece down but never sideways: x is untouched, y ends at the floor.
    expect(lock.x).toBe(pos.x);
    expect(lock.y).toBeGreaterThanOrEqual(pos.y);
    expect(lock.rotation).toBe(0);
    expect(lock.linesCleared).toBe(0);
    expect(lock.combo).toBe(0);
  });

  test('global_step increments once per placement and matches getGlobalStep()', () => {
    const { engine, locks } = trackedEngine();
    engine.handleCommand({ type: CommandType.HardDrop });
    engine.handleCommand({ type: CommandType.HardDrop });
    engine.handleCommand({ type: CommandType.HardDrop });
    expect(locks.map(l => l.globalStep)).toEqual([1, 2, 3]);
    expect(engine.getGlobalStep()).toBe(3);
  });

  test('lock carries the post-lock counters a client will report (score/level/totalLines)', () => {
    const { engine, locks } = trackedEngine();
    engine.handleCommand({ type: CommandType.HardDrop });
    const afterDrop = {
      score: engine.getScore(),
      level: engine.getLevel(),
      totalLines: engine.getLinesCleared(),
    };
    expect(locks[0].score).toBe(afterDrop.score);
    expect(locks[0].level).toBe(afterDrop.level);
    expect(locks[0].totalLines).toBe(afterDrop.totalLines);
    expect(afterDrop.score).toBeGreaterThan(0); // hard drop points are part of the score
  });

  test('StartGame resets global_step — a new game/round restarts the sequence', () => {
    const { engine, locks } = trackedEngine();
    engine.handleCommand({ type: CommandType.HardDrop });
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
    engine.handleCommand({ type: CommandType.HardDrop });
    expect(locks.map(l => l.globalStep)).toEqual([1, 1]);
  });

  test('hold and movement emit no locks; only placements do', () => {
    const { engine, locks } = trackedEngine();
    engine.handleCommand({ type: CommandType.HoldPiece });
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    engine.handleCommand({ type: CommandType.Tick, payload: { dt: 100 } });
    expect(locks).toHaveLength(0);
    engine.handleCommand({ type: CommandType.HardDrop });
    expect(locks).toHaveLength(1);
  });

  test('the locked piece type equals the queue front the server draws from the same seed', () => {
    // Determinism contract for the replay: currentPiece.type comes from the seeded bag, so a
    // server-built engine on the same seed sees the identical sequence of lock pieceTypes.
    const a = trackedEngine(555);
    const b = trackedEngine(555);
    for (let i = 0; i < 4; i++) {
      a.engine.handleCommand({ type: CommandType.HardDrop });
      b.engine.handleCommand({ type: CommandType.HardDrop });
    }
    expect(a.locks.map(l => l.pieceType)).toEqual(b.locks.map(l => l.pieceType));
    expect(new Set(a.locks.map(l => l.pieceType)).size).toBeLessThanOrEqual(7);
  });
});
