import { Cell, CellState, GameState, Piece, Position } from './types';

const INITIAL_BOARD = (width: number, height: number): Cell[][] =>
  Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ value: 0, locked: false }))
  );

export class BoardManager {
  private cells: Cell[][];
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = INITIAL_BOARD(width, height);
  }

  reset(): void {
    this.cells = INITIAL_BOARD(this.width, this.height);
  }

  getCell(x: number, y: number): Cell {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return { value: 0, locked: false };
    }
    return this.cells[y][x];
  }

  setCell(x: number, y: number, value: number, locked: boolean = false): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.cells[y][x] = { value, locked };
    }
  }

  setCells(piece: Piece, pos: Position): void {
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (piece.shape[r][c]) {
          const boardX = pos.x + c;
          const boardY = pos.y + r;
          if (boardY >= 0 && boardY < this.height && boardX >= 0 && boardX < this.width) {
            this.cells[boardY][boardX] = { value: piece.colors[r][c], locked: true };
          }
        }
      }
    }
  }

  // Check if piece placement is valid (not overlapping, within bounds)
  isValidPosition(piece: Piece, pos: Position): boolean {
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (piece.shape[r][c]) {
          const boardX = pos.x + c;
          const boardY = pos.y + r;
          if (boardX < 0 || boardX >= this.width || boardY >= this.height) return false;
          if (boardY >= 0 && this.cells[boardY][boardX].locked) return false;
        }
      }
    }
    return true;
  }

  // Check collision with current piece
  hasCollision(piece: Piece, pos: Position): boolean {
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (piece.shape[r][c]) {
          const boardX = pos.x + c;
          const boardY = pos.y + r;
          if (boardY >= 0 && boardY < this.height && boardX >= 0 && boardX < this.width) {
            if (this.cells[boardY][boardX].locked) return true;
          }
          if (boardY < 0) continue; // above board is fine
          if (boardX < 0 || boardX >= this.width || boardY >= this.height) return true;
        }
      }
    }
    return false;
  }

  // Count and lock full rows
  clearLines(): number {
    let linesCleared = 0;
    const newCells: Cell[][] = [];

    for (let y = 0; y < this.height; y++) {
      if (this.cells[y].every(cell => cell.locked)) {
        linesCleared++;
        // Keep everything above this row
      } else {
        newCells.push([...this.cells[y]]);
      }
    }

    // Fill the top with empty cells
    const emptyRows = linesCleared;
    for (let i = 0; i < emptyRows; i++) {
      newCells.unshift(
        Array.from({ length: this.width }, () => ({ value: 0, locked: false }))
      );
    }

    this.cells = newCells;
    return linesCleared;
  }

  getSnapshot(): number[][] {
    return this.cells.map(row => row.map(cell => cell.value));
  }

  getCells(): Cell[][] {
    return this.cells;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }
}
