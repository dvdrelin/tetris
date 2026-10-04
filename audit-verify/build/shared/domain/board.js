"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardManager = void 0;
const INITIAL_BOARD = (width, height) => Array.from({ length: height }, () => Array.from({ length: width }, () => ({ value: 0, locked: false })));
class BoardManager {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.cells = INITIAL_BOARD(width, height);
    }
    reset() {
        this.cells = INITIAL_BOARD(this.width, this.height);
    }
    getCell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return { value: 0, locked: false };
        }
        return this.cells[y][x];
    }
    setCell(x, y, value, locked = false) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.cells[y][x] = { value, locked };
        }
    }
    setCells(piece, pos) {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (piece.shape[r][c]) {
                    const boardX = pos.x + c;
                    const boardY = pos.y + r;
                    if (boardY >= 0 && boardY < this.height && boardX >= 0 && boardX < this.width) {
                        // A locked cell is never overwritten: a piece cannot delete already placed blocks.
                        if (this.cells[boardY][boardX].locked)
                            continue;
                        this.cells[boardY][boardX] = { value: piece.colors[r][c], locked: true };
                    }
                }
            }
        }
    }
    // Check if piece placement is valid (not overlapping, within bounds)
    isValidPosition(piece, pos) {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (piece.shape[r][c]) {
                    const boardX = pos.x + c;
                    const boardY = pos.y + r;
                    if (boardX < 0 || boardX >= this.width || boardY < 0 || boardY >= this.height)
                        return false;
                    if (boardY >= 0 && boardY < this.height && this.cells[boardY][boardX].locked)
                        return false;
                }
            }
        }
        return true;
    }
    // Check collision with current piece
    hasCollision(piece, pos) {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (piece.shape[r][c]) {
                    const boardX = pos.x + c;
                    const boardY = pos.y + r;
                    if (boardY >= 0 && boardY < this.height && boardX >= 0 && boardX < this.width) {
                        if (this.cells[boardY][boardX].locked)
                            return true;
                    }
                    if (boardY < 0)
                        continue; // above board is fine
                    if (boardX < 0 || boardX >= this.width || boardY >= this.height)
                        return true;
                }
            }
        }
        return false;
    }
    // Count and lock full rows
    clearLines() {
        let linesCleared = 0;
        const newCells = [];
        for (let y = 0; y < this.height; y++) {
            if (this.cells[y].every(cell => cell.locked)) {
                linesCleared++;
                // Keep everything above this row
            }
            else {
                newCells.push([...this.cells[y]]);
            }
        }
        // Fill the top with empty cells
        const emptyRows = linesCleared;
        for (let i = 0; i < emptyRows; i++) {
            newCells.unshift(Array.from({ length: this.width }, () => ({ value: 0, locked: false })));
        }
        this.cells = newCells;
        return linesCleared;
    }
    getSnapshot() {
        return this.cells.map(row => row.map(cell => cell.value));
    }
    getCells() {
        return this.cells;
    }
    getWidth() {
        return this.width;
    }
    getHeight() {
        return this.height;
    }
}
exports.BoardManager = BoardManager;
