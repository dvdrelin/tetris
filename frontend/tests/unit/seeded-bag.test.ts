// MP block A — seeded piece sequences (GDD §2.1/2.2): the same seed must produce the same
// 7-bag sequence on every machine (client and server replay), while single-player stays random.
import {
  PieceFactoryProvider, mulberry32, PieceType, GameEngine, CommandType, GameMode,
} from '@neon-tetris/shared';

const ALL_TYPES: PieceType[] = [
  PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L,
];

function drawN(provider: PieceFactoryProvider, n: number): PieceType[] {
  const out: PieceType[] = [];
  for (let i = 0; i < n; i++) out.push(provider.nextPieceType());
  return out;
}

describe('seeded piece factory (MP block A)', () => {
  test('same seed produces the identical sequence', () => {
    const a = drawN(new PieceFactoryProvider({ seed: 123456789 }), 42);
    const b = drawN(new PieceFactoryProvider({ seed: 123456789 }), 42);
    expect(a).toEqual(b);
  });

  test('different seeds diverge', () => {
    const a = drawN(new PieceFactoryProvider({ seed: 1 }), 42);
    const b = drawN(new PieceFactoryProvider({ seed: 2 }), 42);
    expect(a).not.toEqual(b);
  });

  test('every full bag is a permutation of the 7 pieces (7-bag guarantee holds under seed)', () => {
    const draws = drawN(new PieceFactoryProvider({ seed: 987654321 }), 70);
    for (let chunk = 0; chunk < 10; chunk++) {
      const bag = draws.slice(chunk * 7, chunk * 7 + 7);
      expect([...bag].sort()).toEqual([...ALL_TYPES].sort());
    }
  });

  test('mulberry32 is deterministic and stays in [0, 1)', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r1();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(r2());
    }
  });

  test('explicit rng injection wins over the default (server can drive any stream)', () => {
    const seq = [0.9, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const factory = new PieceFactoryProvider({ rng: () => seq[i++ % seq.length] });
    expect(drawN(factory, 7).length).toBe(7);
  });
});

describe('engine-level determinism under a seed', () => {
  function playScriptedGame(seed: number) {
    const locks: unknown[] = [];
    const engine = new GameEngine({ onPieceLocked: (l) => locks.push({ ...l }) }, { seed });
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
    for (let i = 0; i < 8; i++) {
      engine.handleCommand({ type: CommandType.Tick, payload: { dt: 100 } });
      engine.handleCommand({ type: CommandType.HardDrop });
    }
    return { engine, locks };
  }

  test('two engines on one seed and one command stream end in identical state', () => {
    const a = playScriptedGame(13579);
    const b = playScriptedGame(13579);
    expect(a.engine.getBoardSnapshot()).toEqual(b.engine.getBoardSnapshot());
    expect(a.engine.getScore()).toBe(b.engine.getScore());
    expect(a.engine.getNextQueue()).toEqual(b.engine.getNextQueue());
    expect(a.engine.getGlobalStep()).toBe(b.engine.getGlobalStep());
    expect(a.locks).toEqual(b.locks);
    expect(a.locks.length).toBe(8);
  });

  test('the hand order equals the bag order of a same-seed factory (the MP mirror contract)', () => {
    // The server's replay (backend MatchState) mirrors the bag with plain `nextPieceType()` pulls.
    // If the engine ever re-deals its queue at StartGame, its first hand becomes pull #4 and every
    // real match dies on the first lock with `invalid_move` — this test is the tripwire.
    const seed = 1;
    const factory = new PieceFactoryProvider({ seed });
    const expected = drawN(factory, 8);
    const engine = new GameEngine({}, { seed });
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
    const hands: string[] = [];
    for (let i = 0; i < 8; i++) {
      hands.push(engine.getGameState().currentPiece?.type ?? 'none');
      engine.handleCommand({ type: CommandType.HardDrop });
    }
    expect(hands).toEqual(expected);
  });

  test('a different seed diverges the board', () => {
    const a = playScriptedGame(11111);
    const b = playScriptedGame(22222);
    expect(a.engine.getBoardSnapshot()).not.toEqual(b.engine.getBoardSnapshot());
  });
});
