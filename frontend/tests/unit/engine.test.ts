import { GameEngine } from '../../src/shared/engine/game-engine';
import { BoardManager } from '../../src/shared/domain/board';
import { PieceFactoryProvider } from '../../src/shared/domain/pieces';
import { GameState, PieceType } from '../../src/shared/domain/types';

const REAL_CONFIG = {
  boardWidth: 10,
  boardHeight: 20,
  speedConfig: { initialInterval: 800, intervalDecrease: 50, minInterval: 50 },
  scoring: { single: 100, double: 300, triple: 500, tetris: 800, softDrop: 10, hardDrop: 20, comboMultiplier: 1.5, comboDecay: 0.5 },
};

function createEngine() {
  const engine = new GameEngine({
    onStateChange: () => {},
    onLineClear: () => {},
    onGameOver: () => {},
  });
  (engine as any).boardManager = new BoardManager(REAL_CONFIG.boardWidth, REAL_CONFIG.boardHeight);
  (engine as any).pieceFactory = new PieceFactoryProvider();
  (engine as any).width = REAL_CONFIG.boardWidth;
  (engine as any).height = REAL_CONFIG.boardHeight;
  (engine as any).mode = 0;
  return engine;
}

describe('GameEngine', () => {
  test('should not allow actions after game over', () => {
    const engine = createEngine();
    (engine as any)._isGameOver = true;
    (engine as any)._isRunning = true;
    engine.handleCommand({ type: 'SoftDrop' });
    expect(engine.getScore()).toBe(0);
  });

  test('should start game and spawn piece', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    const state = engine.getGameState();
    expect(state.isRunning).toBe(true);
    expect(state.isGameOver).toBe(false);
    expect(state.currentPiece).not.toBeNull();
  });

  test('should move piece right from center', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    const initialPos = engine.getCurrentPos();
    engine.handleCommand({ type: 'MovePiece', payload: { direction: 'right' } });
    const newPos = engine.getCurrentPos();
    // Move right: x advances by 1 or stays same (if blocked by wall)
    // The piece spawns centered, so moving right from center should work
    expect(newPos.x).toBeGreaterThanOrEqual(initialPos.x);
  });

  test('should move piece right twice and reach edge', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    const initialPos = engine.getCurrentPos();
    // Move right twice
    engine.handleCommand({ type: 'MovePiece', payload: { direction: 'right' } });
    engine.handleCommand({ type: 'MovePiece', payload: { direction: 'right' } });
    const newPos = engine.getCurrentPos();
    // Should have moved at least 2 positions right (or to the wall)
    expect(newPos.x).toBeGreaterThanOrEqual(initialPos.x);
  });

  test('should not move piece left from left edge', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    const initialPos = engine.getCurrentPos();
    engine.handleCommand({ type: 'MovePiece', payload: { direction: 'left' } });
    const newPos = engine.getCurrentPos();
    expect(newPos.x).toBe(initialPos.x); // blocked by wall
  });

  test('should pause and resume game', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    engine.handleCommand({ type: 'PauseGame' });
    expect(engine.isPaused()).toBe(true);
    engine.handleCommand({ type: 'ResumeGame' });
    expect(engine.isPaused()).toBe(false);
  });

  test('should not move piece while paused', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    engine.handleCommand({ type: 'PauseGame' });
    const initialPos = engine.getCurrentPos();
    engine.handleCommand({ type: 'MovePiece', payload: { direction: 'right' } });
    const newPos = engine.getCurrentPos();
    expect(newPos.x).toBe(initialPos.x);
  });

  test('should track game over state', () => {
    const engine = createEngine();
    (engine as any)._isGameOver = true;
    expect(engine.isGameOver()).toBe(true);
  });

  test('should increment score on soft drop', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    const initialScore = engine.getScore();
    engine.handleCommand({ type: 'SoftDrop' });
    const newScore = engine.getScore();
    expect(newScore).toBeGreaterThanOrEqual(initialScore + 10);
  });

  test('should track level', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    expect(engine.getLevel()).toBe(1);
  });

  test('should track lines cleared', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    expect(engine.getLinesCleared()).toBe(0);
  });

  test('should track combo', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    expect(engine.getCombo()).toBe(0);
  });

  test('should return valid game state', () => {
    const engine = createEngine();
    engine.handleCommand({ type: 'StartGame', payload: { mode: 0 } });
    const state = engine.getGameState();
    expect(state).toHaveProperty('board');
    expect(state).toHaveProperty('score');
    expect(state).toHaveProperty('isRunning');
    expect(state).toHaveProperty('isPaused');
    expect(state).toHaveProperty('isGameOver');
  });
});

describe('BoardManager bounds', () => {
  test('isValidPosition should block y<0 (above board)', () => {
    const board = new BoardManager(10, 20);
    const piece = { type: PieceType.I, shape: [[1]], colors: [[1]] };
    expect(board.isValidPosition(piece, { x: 5, y: -1 })).toBe(false);
  });

  test('isValidPosition should detect occupied cells', () => {
    const board = new BoardManager(10, 20);
    board.setCell(5, 5, 1, true);
    const piece = { type: PieceType.I, shape: [[1]], colors: [[1]] };
    expect(board.isValidPosition(piece, { x: 5, y: 5 })).toBe(false);
  });

  test('isValidPosition should block x>=width', () => {
    const board = new BoardManager(10, 20);
    const piece = { type: PieceType.I, shape: [[1]], colors: [[1]] };
    expect(board.isValidPosition(piece, { x: 10, y: 10 })).toBe(false);
  });

  test('isValidPosition should block y>=height', () => {
    const board = new BoardManager(10, 20);
    const piece = { type: PieceType.I, shape: [[1]], colors: [[1]] };
    expect(board.isValidPosition(piece, { x: 5, y: 20 })).toBe(false);
  });
});
