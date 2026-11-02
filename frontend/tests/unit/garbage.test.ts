// MP block A — incoming garbage rows (GDD §1.1): the engine applies validated InsertGarbage
// commands, the stack (and the active piece) ride up, malformed payloads are refused, and
// being pushed off the top is a block-out.
import {
  GameEngine, BoardManager, CommandType, GameMode, GAME_CONFIG,
} from '@neon-tetris/shared';

const WIDTH = GAME_CONFIG.boardWidth;
const HEIGHT = GAME_CONFIG.boardHeight;

// A garbage row: `color` blocks everywhere except a hole at column `holeCol`.
function garbageRow(holeCol: number, color = 4): number[] {
  return Array.from({ length: WIDTH }, (_, c) => (c === holeCol ? 0 : color));
}

function startEngine(seed?: number) {
  const events: { garbage: unknown[]; lock: unknown[] } = { garbage: [], lock: [] };
  const engine = new GameEngine(
    {
      onGarbageInserted: (g) => events.garbage.push({ ...g }),
      onPieceLocked: (l) => events.lock.push({ ...l }),
    },
    seed !== undefined ? { seed } : undefined,
  );
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
  return { engine, events };
}

describe('BoardManager.insertGarbageRows', () => {
  test('bottom line becomes the garbage row, hole stays unlocked and empty', () => {
    const b = new BoardManager(WIDTH, HEIGHT);
    const row = garbageRow(3, 7);
    b.insertGarbageRows([row]);
    const bottom = b.getSnapshot()[HEIGHT - 1];
    expect(bottom).toEqual(row);
    const bottomCells = b.getCells()[HEIGHT - 1];
    expect(bottomCells[3].locked).toBe(false);
    expect(bottomCells[3].value).toBe(0);
    expect(bottomCells[0].locked).toBe(true);
  });

  test('the stack shifts up by the inserted count', () => {
    const b = new BoardManager(WIDTH, HEIGHT);
    b.setCell(2, HEIGHT - 1, 5, true); // a locked block in the old bottom row
    b.insertGarbageRows([garbageRow(0)]);
    expect(b.getSnapshot()[HEIGHT - 1]).toEqual(garbageRow(0));
    expect(b.getCells()[HEIGHT - 2][2].locked).toBe(true);
    expect(b.getCells()[HEIGHT - 2][2].value).toBe(5);
  });

  test('rows pushed off the top are counted only when they held locked cells', () => {
    const empty = new BoardManager(WIDTH, HEIGHT);
    expect(empty.insertGarbageRows([garbageRow(4)])).toBe(0);

    const tall = new BoardManager(WIDTH, HEIGHT);
    tall.setCell(1, 0, 6, true); // a locked cell in the top row
    expect(tall.insertGarbageRows([garbageRow(4)])).toBe(1);
  });

  test('bottom-to-top payload order: rows[0] lands as the new bottom line', () => {
    const b = new BoardManager(WIDTH, HEIGHT);
    b.insertGarbageRows([garbageRow(0, 1), garbageRow(9, 2)]);
    expect(b.getSnapshot()[HEIGHT - 1]).toEqual(garbageRow(0, 1));
    expect(b.getSnapshot()[HEIGHT - 2]).toEqual(garbageRow(9, 2));
  });
});

describe('engine InsertGarbage command', () => {
  test('garbage rides the active piece up and fires onGarbageInserted', () => {
    const { engine, events } = startEngine(4242);
    // Let the active piece fall a couple of rows first: a piece still sitting in the spawn row
    // is legitimately killed by a garbage push (it would cross the top edge), so the ride-up
    // test needs the piece below the spawn area.
    for (let i = 0; i < 8; i++) {
      engine.handleCommand({ type: CommandType.Tick, payload: { dt: 250 } });
    }
    const pieceYBefore = engine.getCurrentPos().y;
    expect(pieceYBefore).toBeGreaterThanOrEqual(2);
    engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows: [garbageRow(5)] } });
    expect(engine.getCurrentPos().y).toBe(pieceYBefore - 1);
    expect(events.garbage).toEqual([{ rows: 1, pushedOut: 0 }]);
    expect(engine.getBoardSnapshot()[HEIGHT - 1]).toEqual(garbageRow(5));
    expect(engine.isGameOver()).toBe(false); // one row under a falling piece is harmless
  });

  test('garbage applies while paused — the server decides, local pause cannot dodge attacks', () => {
    const { engine } = startEngine(1);
    engine.handleCommand({ type: CommandType.PauseGame });
    engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows: [garbageRow(5)] } });
    expect(engine.getBoardSnapshot()[HEIGHT - 1]).toEqual(garbageRow(5));
  });

  test('malformed payloads are refused without touching the board', () => {
    const { engine, events } = startEngine(7);
    const before = engine.getBoardSnapshot();

    engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows: [] } });
    engine.handleCommand({
      type: CommandType.InsertGarbage,
      payload: { rows: [Array.from({ length: WIDTH }, () => 3)] }, // no hole = free line credit
    });
    engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows: [[1, 2, 3]] } }); // wrong width
    engine.handleCommand({
      type: CommandType.InsertGarbage,
      payload: { rows: [garbageRow(0).map(() => 8)] }, // color 8 does not exist
    });
    engine.handleCommand({
      type: CommandType.InsertGarbage,
      payload: { rows: Array.from({ length: HEIGHT + 1 }, () => garbageRow(0)) }, // taller than the board
    });

    expect(engine.getBoardSnapshot()).toEqual(before);
    expect(events.garbage).toEqual([]);
    expect(engine.isGameOver()).toBe(false);
  });

  test('being pushed past the spawn row is a block-out with the onGameOver callback', () => {
    const gameOvers: number[] = [];
    const engine = new GameEngine({ onGameOver: (s) => gameOvers.push(s) });
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
    engine.handleCommand({
      type: CommandType.InsertGarbage,
      payload: { rows: Array.from({ length: HEIGHT }, () => garbageRow(5)) },
    });
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getOverReason()).toBe('block-out');
    expect(gameOvers.length).toBe(1);
  });

  test('garbage does not score and does not touch the piece sequence', () => {
    const { engine } = startEngine(2468);
    const queueBefore = engine.getNextQueue();
    engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows: [garbageRow(2), garbageRow(7)] } });
    expect(engine.getScore()).toBe(0);
    expect(engine.getLinesCleared()).toBe(0);
    expect(engine.getNextQueue()).toEqual(queueBefore);
  });

  test('garbage rows participate in the normal board snapshot (renderer path)', () => {
    const { engine } = startEngine(31337);
    engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows: [garbageRow(0)] } });
    // getSnapshot is what GameBoard.vue draws — the garbage line must be visible there as a
    // regular row of colored cells with one empty hole.
    const bottom = engine.getBoardSnapshot()[HEIGHT - 1];
    expect(bottom[0]).toBe(0);
    expect(bottom.filter(v => v !== 0).length).toBe(WIDTH - 1);
  });
});
