import { Cell, Piece, Position } from './types';

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
            // A locked cell is never overwritten: a piece cannot delete already placed blocks.
            if (this.cells[boardY][boardX].locked) continue;
            this.cells[boardY][boardX] = { value: piece.colors[r][c], locked: true };
          }
        }
      }
    }
  }

  // Check if piece placement is valid (not overlapping, within bounds).
  // Cells above the visible board (boardY < 0) are not allowed: a piece spawns at y = 0
  // and never enters the hidden rows.
  isValidPosition(piece: Piece, pos: Position): boolean {
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (piece.shape[r][c]) {
          const boardX = pos.x + c;
          const boardY = pos.y + r;
          if (boardX < 0 || boardX >= this.width || boardY < 0 || boardY >= this.height) return false;
          if (this.cells[boardY][boardX].locked) return false;
        }
      }
    }
    return true;
  }

  // Collision is exactly "this placement is not valid" — one rule, one implementation.
  hasCollision(piece: Piece, pos: Position): boolean {
    return !this.isValidPosition(piece, pos);
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

  /**
   * Multiplayer garbage rows (MP block A): `rows` are listed bottom-to-top — rows[0] lands as
   * the new bottom line. Cell value 0 is the hole (a never-locked empty cell), 1..7 are locked
   * colored blocks, so the row is exactly as the attack pipeline computed it (determinism: the
   * server builds the same rows for its replay). The stack shifts up by rows.length and the same
   * number of top rows leaves the board. Returns how many of those leaving rows contained locked
   * cells — the top-out evidence the engine judges (0 means only empty space overflowed).
   */
  insertGarbageRows(rows: number[][]): number {
    const n = rows.length;
    let pushedOut = 0;
    for (let y = 0; y < n; y++) {
      if (this.cells[y].some(cell => cell.locked)) pushedOut++;
    }
    const garbage = rows.map(row =>
      row.map(v => ({ value: v, locked: v !== 0 }))
    ).reverse(); // board rows are indexed top→bottom, payload is bottom→top
    this.cells = [...this.cells.slice(n), ...garbage];
    return pushedOut;
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
