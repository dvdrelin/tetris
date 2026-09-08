import { render, RenderState } from '../../src/engine/renderer';
import { GameStateDTO, CELL_COLORS } from '../../src/stores/gameStore';

describe('renderer', () => {
  function createMockCtx(): CanvasRenderingContext2D {
    const ctx = {
      fillStyle: '',
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      closePath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      globalAlpha: 1,
      shadowBlur: 0,
      shadowColor: '',
      textAlign: '',
      font: '',
      lineWidth: 0,
      setTransform: jest.fn(),
      scale: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      clip: jest.fn(),
      createLinearGradient: jest.fn(),
      createRadialGradient: jest.fn(),
      createPattern: jest.fn(),
      getImageData: jest.fn(),
      putImageData: jest.fn(),
      drawImage: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      rotate: jest.fn(),
      setTransform: jest.fn(),
      fillText: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    return ctx;
  }

  function createRenderState(overrides: Partial<RenderState> = {}): RenderState {
    return {
      board: Array.from({ length: 20 }, () => Array(10).fill(0)),
      currentPiece: null,
      currentPos: null,
      ghostY: -1,
      isPaused: false,
      isGameOver: false,
      score: 0,
      ...overrides,
    };
  }

  test('should clear canvas and render empty board', () => {
    const ctx = createMockCtx();
    const state = createRenderState();
    render(ctx, state, 240, 480);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 240, 480);
  });

  test('should render placed cells', () => {
    const ctx = createMockCtx();
    const state = createRenderState({
      board: [[0, 0, 0], [0, 1, 0]],
      currentPiece: null,
    });
    render(ctx, state, 240, 480);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  test('should render ghost piece', () => {
    const ctx = createMockCtx();
    const state = createRenderState({
      currentPiece: { type: 'T', shape: [[0, 1, 0], [1, 1, 1]], colors: [[0, 0, 0], [1, 1, 1], [0, 0, 0]] },
      currentPos: { x: 5, y: 5 },
      ghostY: 10,
    });
    render(ctx, state, 240, 480);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  test('should render current piece', () => {
    const ctx = createMockCtx();
    const state = createRenderState({
      currentPiece: { type: 'T', shape: [[0, 1, 0], [1, 1, 1]], colors: [[0, 0, 0], [1, 1, 1], [0, 0, 0]] },
      currentPos: { x: 5, y: 5 },
    });
    render(ctx, state, 240, 480);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  test('should render pause overlay', () => {
    const ctx = createMockCtx();
    const state = createRenderState({ isPaused: true });
    render(ctx, state, 240, 480);
    expect(ctx.fillText).toHaveBeenCalledWith('ПАУЗА', expect.any(Number), expect.any(Number));
  });

  test('should render game over overlay', () => {
    const ctx = createMockCtx();
    const state = createRenderState({ isGameOver: true, score: 5000 });
    render(ctx, state, 240, 480);
    expect(ctx.fillText).toHaveBeenCalledWith('GAME OVER', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('Счёт: 5000', expect.any(Number), expect.any(Number));
  });

  test('should render safely without infinite recursion (100 calls)', () => {
    const ctx = createMockCtx();
    const state = createRenderState();
    // Call render 100 times — should not throw RangeError
    expect(() => {
      for (let i = 0; i < 100; i++) {
        render(ctx, state, 240, 480);
      }
    }).not.toThrow();
  });

  test('should handle empty board with no cells', () => {
    const ctx = createMockCtx();
    const state = createRenderState({ board: [] });
    render(ctx, state, 240, 480);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 240, 480);
  });
});
