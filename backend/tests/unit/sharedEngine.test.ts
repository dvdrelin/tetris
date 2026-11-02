// MP block A — the shared engine must run headless under Node (the future server replay is
// built on this). If any DOM/browser dependency crept into the engine or domain layer, this
// suite (testEnvironment: node) fails immediately.
import {
  GameEngine, CommandType, GameMode, PieceLockInfo, mulberry32, GAME_CONFIG,
} from '@neon-tetris/shared';

function playScriptedSession(seed: number) {
  const locks: PieceLockInfo[] = [];
  const engine = new GameEngine(
    {
      onPieceLocked: (l) => locks.push({ ...l }),
    },
    { seed },
  );
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
  for (let i = 0; i < 10; i++) {
    engine.handleCommand({ type: CommandType.Tick, payload: { dt: 150 } });
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: i % 2 ? 'right' : 'left' } });
    engine.handleCommand({ type: CommandType.HardDrop });
  }
  return { engine, locks };
}

describe('shared engine under Node (server replay feasibility)', () => {
  test('barrel import works in a Node environment without DOM globals', () => {
    expect(typeof GameEngine).toBe('function');
    expect(typeof mulberry32).toBe('function');
    // The engine never touches document/window: prove it the blunt way.
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  test('the same seed and the same command stream produce identical locks and board', () => {
    const a = playScriptedSession(20261102);
    const b = playScriptedSession(20261102);
    expect(a.locks).toEqual(b.locks);
    expect(a.engine.getBoardSnapshot()).toEqual(b.engine.getBoardSnapshot());
    expect(a.engine.getScore()).toBe(b.engine.getScore());
    expect(a.engine.getGlobalStep()).toBe(b.engine.getGlobalStep());
    // Sanity: the scripted session actually did something.
    expect(a.locks.length).toBeGreaterThan(0);
    expect(a.engine.getScore()).toBeGreaterThan(0);
  });

  test('InsertGarbage replays identically on two Node-side engines', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      Array.from({ length: GAME_CONFIG.boardWidth }, (_, c) => (c === i ? 0 : 2)),
    );
    const build = () => {
      const seen: unknown[] = [];
      const engine = new GameEngine({ onGarbageInserted: (g) => seen.push({ ...g }) }, { seed: 7 });
      engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
      engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows } });
      return { engine, seen };
    };
    const a = build();
    const b = build();
    expect(a.seen).toEqual(b.seen);
    expect(a.engine.getBoardSnapshot()).toEqual(b.engine.getBoardSnapshot());
    expect(a.seen).toEqual([{ rows: 3, pushedOut: 0 }]);
  });

  test('лок несёт след фигуры: спавн, успешные сдвиги и повороты с индексами киков', () => {
    const locks: PieceLockInfo[] = [];
    const engine = new GameEngine({ onPieceLocked: (l) => locks.push({ ...l }) }, { seed: 4242 });
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
    for (let i = 0; i < 8; i++) engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    engine.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'cw' } });
    engine.handleCommand({ type: CommandType.HardDrop });
    engine.handleCommand({ type: CommandType.HardDrop }); // следующая фигура падает без нашего участия

    expect(locks).toHaveLength(2);
    const first = locks[0].trace;
    const second = locks[1].trace;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Спавн — верхний ряд, по горизонтали в пределах поля (ширина фигуры у всех разная).
    expect(first!.spawn.y).toBe(0);
    expect(first!.spawn.x).toBeGreaterThanOrEqual(0);
    expect(first!.spawn.x).toBeLessThanOrEqual(GAME_CONFIG.boardWidth - 2);
    // Считаются только успешные сдвиги: упор в стену — не движение.
    expect(first!.moves).toBeGreaterThan(0);
    expect(first!.moves).toBeLessThanOrEqual(8);
    expect(locks[0].x).toBeLessThan(first!.spawn.x);
    // Поворот записан из какого спавна (0) и куда; индекс кика 0 = поворот без смещения.
    expect(first!.rotations.length).toBeGreaterThan(0);
    expect(first!.rotations[0].from).toBe(0);
    expect(first!.rotations[0].kick).toBeGreaterThanOrEqual(0);
    // След принадлежит фигуре, а не «всему матчу»: у второй фигуры он обнулён.
    expect(second!.moves).toBe(0);
    expect(second!.rotations).toEqual([]);
    expect(second!.spawn.y).toBe(0);
  });
});
