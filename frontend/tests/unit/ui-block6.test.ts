/**
 * Block 6 (UI): C5 engine.stop(), C4 player name + localStorage, C3 shared CONTROL_HINTS,
 * and the A7 contract that the store DTO carries the engine's ghost row.
 */
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { GameEngine } from '../../src/shared/engine/game-engine';
import { GameMode, PieceType } from '../../src/shared/domain/types';
import { PIECE_SHAPES, PieceFactoryProvider, buildPiece } from '../../src/shared/domain/pieces';
import { BoardManager } from '../../src/shared/domain/board';
import { CommandType } from '../../src/shared/cqrs/commands';
import {
  DEFAULT_PLAYER_NAME, PLAYER_NAME_KEY, PLAYER_NAME_MAX,
  loadPlayerName, normalizePlayerName, savePlayerName,
} from '../../src/shared/domain/player-name';
import { CONTROL_HINTS, VIEW_HINT_KEYS } from '../../src/shared/config/control-hints';
import { KEY_MAP_KEYS, actionForKey } from '../../src/shared/input/input-actions';

function createEngine(script?: PieceType[]) {
  const engine = new GameEngine({
    onStateChange: () => {},
    onLineClear: () => {},
    onGameOver: () => {},
  });
  (engine as any).boardManager = new BoardManager(10, 20);
  (engine as any).width = 10;
  (engine as any).height = 20;
  if (script) {
    let i = 0;
    (engine as any).pieceFactory = {
      nextPieceType: () => script[i++ % script.length],
      createPiece: (type: PieceType) => buildPiece(type, PIECE_SHAPES[type][0]),
    };
  } else {
    (engine as any).pieceFactory = new PieceFactoryProvider();
  }
  engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
  return engine;
}

describe('engine.stop() (C5)', () => {
  test('stopping a running game ends it without a game-over report', () => {
    let overFired = 0;
    let changes = 0;
    const engine = new GameEngine({
      onStateChange: () => { changes++; },
      onGameOver: () => { overFired++; },
    });
    (engine as any).boardManager = new BoardManager(10, 20);
    (engine as any).pieceFactory = new PieceFactoryProvider();
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
    expect(engine.isRunning()).toBe(true);

    const changesBeforeStop = changes;
    engine.stop();

    expect(engine.isRunning()).toBe(false);
    expect(engine.isPaused()).toBe(false);
    expect(overFired).toBe(0);          // no score POST for an abandoned game
    expect(changes).toBeGreaterThan(changesBeforeStop); // the store still gets the new state
  });

  test('after stop every gameplay command is ignored, but a new game starts normally', () => {
    const engine = createEngine([PieceType.T, PieceType.O, PieceType.I]);
    engine.stop();
    const boardAfterStop = JSON.stringify(engine.getBoardSnapshot());

    engine.handleCommand({ type: CommandType.HardDrop });
    engine.handleCommand({ type: CommandType.Tick, payload: { dt: 1000 } });
    engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
    expect(JSON.stringify(engine.getBoardSnapshot())).toBe(boardAfterStop);
    expect(engine.getScore()).toBe(0);

    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Hardcore } });
    expect(engine.isRunning()).toBe(true);
    expect(engine.getMode()).toBe(GameMode.Hardcore);
    // The scripted factory keeps counting across restarts, so only "a real piece is active" holds.
    expect([PieceType.T, PieceType.O, PieceType.I]).toContain(engine.getCurrentPiece()?.type);
    expect(engine.getGameState().nextQueue).toHaveLength(3);
  });

  test('stop is idempotent and silent on a game that is not running', () => {
    const engine = createEngine();
    engine.stop();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });
});

describe('Player name (C4)', () => {
  beforeEach(() => localStorage.clear());

  test('normalize trims, clamps to the backend limit and falls back on empty', () => {
    expect(normalizePlayerName('  dvdre  ')).toBe('dvdre');
    expect(normalizePlayerName('')).toBe(DEFAULT_PLAYER_NAME);
    expect(normalizePlayerName('   ')).toBe(DEFAULT_PLAYER_NAME);
    expect(normalizePlayerName(undefined)).toBe(DEFAULT_PLAYER_NAME);
    expect(normalizePlayerName(42)).toBe(DEFAULT_PLAYER_NAME);
    expect(normalizePlayerName('a'.repeat(50))).toHaveLength(PLAYER_NAME_MAX);
  });

  test('save/load roundtrip through localStorage', () => {
    savePlayerName('  Маша  ');
    expect(localStorage.getItem(PLAYER_NAME_KEY)).toBe('Маша');
    expect(loadPlayerName()).toBe('Маша');
  });

  test('a corrupt stored value normalizes instead of leaking to the API', () => {
    localStorage.setItem(PLAYER_NAME_KEY, String('x'.repeat(99)));
    expect(loadPlayerName()).toHaveLength(PLAYER_NAME_MAX);
    localStorage.setItem(PLAYER_NAME_KEY, '   ');
    expect(loadPlayerName()).toBe(DEFAULT_PLAYER_NAME);
  });

  test('the store reads the stored name and persists every change', async () => {
    setActivePinia(createPinia());
    savePlayerName('Kot');
    const { useGameStore } = await import('../../src/stores/gameStore');
    const store = useGameStore();
    expect(store.playerName).toBe('Kot');

    store.playerName = '  Лёня  ';
    await nextTick();
    expect(store.playerName).toBe('Лёня');
    expect(localStorage.getItem(PLAYER_NAME_KEY)).toBe('Лёня');

    store.playerName = '';
    await nextTick();
    expect(store.playerName).toBe(DEFAULT_PLAYER_NAME);
  });
});

describe('Shared CONTROL_HINTS (C3)', () => {
  test('menu and HUD read the same frozen list', () => {
    expect(CONTROL_HINTS.length).toBeGreaterThan(5);
    expect(Object.isFrozen(CONTROL_HINTS)).toBe(true);
    CONTROL_HINTS.forEach((h) => {
      expect(typeof h.key).toBe('string');
      expect(h.key.length).toBeGreaterThan(0);
      expect(h.label.length).toBeGreaterThan(0);
    });
  });

  test('every single-key hint really resolves to an action in KEY_MAP', () => {
    for (const hint of CONTROL_HINTS) {
      for (const token of hint.key.split('/')) {
        const key = token.trim();
        // Display arrows are not KeyboardEvent.key spellings; 'A / D' style pairs are checked
        // as single letters below.
        if (['←', '→', '↑', '↓'].includes(key)) continue;
        if (VIEW_HINT_KEYS.includes(key)) continue; // handled by GameView, not by KEY_MAP
        if (key.length !== 1 && !['SPACE', 'SHIFT', 'ENTER'].includes(key)) continue;
        const lookup = key === 'SPACE' ? ' ' : key.toLowerCase();
        if (actionForKey(lookup) === null) throw new Error(`hint "${hint.key}" has no mapping for "${lookup}"`);
        expect(actionForKey(lookup)).not.toBeNull();
      }
    }
  });

  test('the hints cover the actions that exist in the input layer', () => {
    const covered = new Set<string>();
    for (const hint of CONTROL_HINTS) covered.add(hint.label);
    for (const label of ['Движение', 'Поворот', 'Мягкое падение', 'Жёсткое падение', 'Удержание', 'Пауза']) {
      expect(covered.has(label)).toBe(true);
    }
  });

  test('KEY_MAP_KEYS is exported for exactly this cross-check', () => {
    expect(KEY_MAP_KEYS).toContain('arrowleft');
    expect(KEY_MAP_KEYS).toContain('shift');
  });
});

describe('Store DTO carries the engine ghost row (A7 contract)', () => {
  test('updateState copies getGhostY from the engine into the DTO', async () => {
    setActivePinia(createPinia());
    const { useGameStore } = await import('../../src/stores/gameStore');
    const store = useGameStore();
    store.init();
    const engine = store.getEngine()!;
    expect(engine).not.toBeNull();

    store.startGame(GameMode.Arcade);
    const state = engine.getGameState();
    expect(state.isRunning).toBe(true);
    expect(store.gameState.ghostY).toBe(engine.getGhostY());
    expect(store.gameState.board.length).toBe(state.boardHeight);
    expect(store.gameState.nextQueue).toHaveLength(3);

    store.handleCommand({ type: CommandType.HardDrop });
    // After a hard drop a new piece spawns at the top: the DTO ghost must follow the engine again.
    expect(store.gameState.ghostY).toBe(engine.getGhostY());
    expect(store.gameState.ghostY).toBeGreaterThan(0);
  });

  test('stopGame through the store clears isRunning in the DTO', async () => {
    setActivePinia(createPinia());
    const { useGameStore } = await import('../../src/stores/gameStore');
    const store = useGameStore();
    store.init();
    store.startGame(GameMode.Arcade);
    expect(store.gameState.isRunning).toBe(true);
    store.stopGame();
    expect(store.gameState.isRunning).toBe(false);
    expect(store.getEngine()!.isRunning()).toBe(false);
  });
});
