import { BoardManager } from '../../src/shared/domain/board';
import { Cell, PieceType } from '../../src/shared/domain/types';

describe('BoardManager', () => {
  // Real dimensions from codebase: 10x20
  let manager: BoardManager;

  beforeEach(() => {
    manager = new BoardManager(10, 20);
  });

  test('should create empty board', () => {
    const cells = manager.getCells();
    // Board is 20 rows x 10 cols
    expect(cells.length).toBe(20);
    expect(cells[0].length).toBe(10);
    expect(cells[0][0]).toEqual({ value: 0, locked: false });
  });

  test('should set cells correctly', () => {
    const piece = { type: PieceType.I, shape: [[1, 1], [1, 1]], colors: [[1, 1], [1, 1]] };
    manager.setCells(piece, { x: 5, y: 5 });
    expect(manager.getCell(5, 5).value).toBe(1);
    expect(manager.getCell(5, 5).locked).toBe(true);
    // The piece shape is [[1,1],[1,1]], so at (5,5):
    // shape[0][0]=1 -> (5,5)
    // shape[0][1]=1 -> (6,5)
    // shape[1][0]=1 -> (5,6)
    // shape[1][1]=1 -> (6,6)
    expect(manager.getCell(6, 5).locked).toBe(true);
  });

  test('should get cell at valid position', () => {
    const cell = manager.getCell(0, 0);
    expect(cell).toBeDefined();
    expect(cell.value).toBe(0);
    expect(cell.locked).toBe(false);
  });

  test('should return empty cell for out-of-bounds position', () => {
    const cell = manager.getCell(15, 15);
    expect(cell.value).toBe(0);
    expect(cell.locked).toBe(false);
  });

  test('should set cell correctly', () => {
    manager.setCell(5, 5, 3, true);
    const cell = manager.getCell(5, 5);
    expect(cell.value).toBe(3);
    expect(cell.locked).toBe(true);
  });

  test('should check valid position', () => {
    const piece = { type: PieceType.I, shape: [[1]], colors: [[1]] };
    // x=5, y=5 is valid (within 10x20)
    expect(manager.isValidPosition(piece, { x: 5, y: 5 })).toBe(true);
    // x=10 is invalid (width=10, indices 0-9)
    expect(manager.isValidPosition(piece, { x: 10, y: 5 })).toBe(false);
  });

  test('should check collision with occupied cell', () => {
    manager.setCell(5, 5, 1, true);
    const piece = { type: PieceType.I, shape: [[1]], colors: [[1]] };
    expect(manager.hasCollision(piece, { x: 5, y: 5 })).toBe(true);
    expect(manager.hasCollision(piece, { x: 6, y: 6 })).toBe(false);
  });

  test('should not clear empty lines', () => {
    const before = manager.getSnapshot();
    const cleared = manager.clearLines();
    expect(cleared).toBe(0);
    expect(manager.getSnapshot()).toEqual(before);
  });

  test('should clear full line', () => {
    // Fill row 0 completely
    for (let x = 0; x < 10; x++) {
      manager.setCell(x, 0, 1, true);
    }
    const cleared = manager.clearLines();
    expect(cleared).toBe(1);
    // Top row should now be empty
    for (let x = 0; x < 10; x++) {
      expect(manager.getCell(x, 0).value).toBe(0);
    }
  });

  test('should clear multiple lines', () => {
    // Fill rows 0 and 1
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 10; x++) {
        manager.setCell(x, y, 1, true);
      }
    }
    const cleared = manager.clearLines();
    expect(cleared).toBe(2);
  });

  test('should reset board', () => {
    manager.setCell(5, 5, 1, true);
    manager.reset();
    const cell = manager.getCell(5, 5);
    expect(cell.value).toBe(0);
    expect(cell.locked).toBe(false);
  });

  test('should return correct width', () => {
    expect(manager.getWidth()).toBe(10);
  });

  test('should return correct height', () => {
    expect(manager.getHeight()).toBe(20);
  });

  test('should return board snapshot', () => {
    manager.setCell(0, 0, 1, true);
    const snapshot = manager.getSnapshot();
    expect(snapshot[0][0]).toBe(1);
  });
});
