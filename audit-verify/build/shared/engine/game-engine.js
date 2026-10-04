"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEngine = void 0;
const types_1 = require("../domain/types");
const board_1 = require("../domain/board");
const pieces_1 = require("../domain/pieces");
const commands_1 = require("../cqrs/commands");
const queries_1 = require("../cqrs/queries");
const game_config_1 = require("../config/game-config");
// Type guard for command types
function isCommandType(type) {
    return Object.values(commands_1.CommandType).includes(type);
}
const KICKS_JLSTZ = {
    '0>1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
    '1>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
    '1>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
    '2>1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
    '2>3': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
    '3>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
    '3>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
    '0>3': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: -2 }, { x: -1, y: -2 }],
};
const KICKS_I = {
    '0>1': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 1 }, { x: 1, y: -2 }],
    '1>0': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: -1 }, { x: -1, y: 2 }],
    '1>2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: -2 }, { x: 2, y: 1 }],
    '2>1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 2 }, { x: -2, y: -1 }],
    '2>3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 2 }, { x: -2, y: -1 }],
    '3>2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: -2 }, { x: 2, y: 1 }],
    '3>0': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: -1 }, { x: -1, y: 2 }],
    '0>3': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 1 }, { x: 1, y: -2 }],
};
const KICKS_O = {
    '0>1': [{ x: 0, y: 0 }], '1>0': [{ x: 0, y: 0 }],
    '1>2': [{ x: 0, y: 0 }], '2>1': [{ x: 0, y: 0 }],
    '2>3': [{ x: 0, y: 0 }], '3>2': [{ x: 0, y: 0 }],
    '3>0': [{ x: 0, y: 0 }], '0>3': [{ x: 0, y: 0 }],
};
function kicksFor(type, from, to) {
    const key = `${from}>${to}`;
    const table = type === types_1.PieceType.I ? KICKS_I : type === types_1.PieceType.O ? KICKS_O : KICKS_JLSTZ;
    return table[key] ?? [{ x: 0, y: 0 }];
}
class GameEngine {
    constructor(callbacks) {
        // Mutable state (not exposed directly)
        this.board = [];
        this.currentPiece = null;
        this.currentPos = { x: 0, y: 0 };
        this.currentRotation = { index: 0 };
        this.nextPieceType = types_1.PieceType.I;
        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;
        this.combo = 0;
        this._isRunning = false;
        this._isPaused = false;
        this._isGameOver = false;
        this.callbacks = callbacks;
        const config = game_config_1.GAME_CONFIG;
        this.width = config.boardWidth;
        this.height = config.boardHeight;
        this.boardManager = new board_1.BoardManager(config.boardWidth, config.boardHeight);
        this.pieceFactory = new pieces_1.PieceFactoryProvider();
        this.mode = types_1.GameMode.Arcade;
        // Generate next piece
        this.nextPieceType = this.pieceFactory.nextPieceType();
    }
    // ====== CQRS Command Handlers ======
    handleCommand(command) {
        if (!isCommandType(command.type))
            return;
        // Once the game is over (or before it starts) only StartGame may reach the engine.
        if (command.type !== commands_1.CommandType.StartGame && (this._isGameOver || !this._isRunning))
            return;
        const handlerMap = {
            [commands_1.CommandType.StartGame]: () => this.startGame(command),
            [commands_1.CommandType.MovePiece]: () => this.movePiece(command),
            [commands_1.CommandType.RotatePiece]: () => this.rotatePiece(this.currentRotation.index, command.payload?.direction === 'cw' ? 1 : -1),
            [commands_1.CommandType.SoftDrop]: () => this.softDrop(command),
            [commands_1.CommandType.HardDrop]: () => this.hardDrop(command),
            [commands_1.CommandType.Tick]: () => this.tick(),
            [commands_1.CommandType.PauseGame]: () => this.pauseGame(),
            [commands_1.CommandType.ResumeGame]: () => this.resumeGame(),
        };
        const handler = handlerMap[command.type];
        if (handler) {
            handler();
        }
    }
    // ====== CQRS Query Handlers ======
    handleQuery(query) {
        switch (query.type) {
            case queries_1.QueryType.GetGameState:
                return this.getGameState();
            case queries_1.QueryType.GetNextPiece:
                return this.getNextPieceType();
            case queries_1.QueryType.GetBoardState:
                return this.getBoardSnapshot();
            default:
                return null;
        }
    }
    // ====== Game Lifecycle ======
    startGame(command) {
        // The store sends payload.mode (GameMode); `payload.hardcore` is kept as a legacy alias.
        const requested = command.payload?.mode ?? (command.payload?.hardcore ? types_1.GameMode.Hardcore : types_1.GameMode.Arcade);
        this.mode = requested === types_1.GameMode.Hardcore ? types_1.GameMode.Hardcore : types_1.GameMode.Arcade;
        this.reset();
        this._isRunning = true;
        this._isPaused = false;
        this._isGameOver = false;
        this.spawnNextPiece();
        this.callbacks.onStateChange?.();
    }
    pauseGame() {
        this._isPaused = true;
        this.callbacks.onStateChange?.();
    }
    resumeGame() {
        this._isPaused = false;
        this.callbacks.onStateChange?.();
    }
    reset() {
        this.boardManager.reset();
        this.board = this.boardManager.getCells();
        this.currentPiece = null;
        this.currentPos = { x: 0, y: 0 };
        this.currentRotation = { index: 0 };
        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;
        this.combo = 0;
        this._isGameOver = false;
        this.nextPieceType = this.pieceFactory.nextPieceType();
    }
    // ====== Movement ======
    movePiece(command) {
        if (!this.currentPiece || !this._isRunning || this._isPaused)
            return;
        const direction = command.payload?.direction;
        if (!direction)
            return;
        let dx = 0, dy = 0;
        switch (direction) {
            case 'left':
                dx = -1;
                break;
            case 'right':
                dx = 1;
                break;
            case 'down':
                dy = 1;
                break;
            case 'rotateCW': {
                this.rotatePiece(this.currentRotation.index, 1);
                return;
            }
            case 'rotateCCW': {
                this.rotatePiece(this.currentRotation.index, -1);
                return;
            }
        }
        if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x + dx, y: this.currentPos.y + dy })) {
            this.currentPos.x += dx;
            this.currentPos.y += dy;
        }
        else if (this.mode === types_1.GameMode.Hardcore) {
            // Hardcore mode: any move into a wall/block is instant death.
            this.hardcoreDeath();
        }
        this.callbacks.onStateChange?.();
    }
    hardcoreDeath() {
        this._isGameOver = true;
        this._isRunning = false;
        this.callbacks.onGameOver?.(this.score);
        this.callbacks.onStateChange?.();
    }
    rotatePiece(rotationIndex, direction) {
        if (!this.currentPiece || !this._isRunning || this._isPaused)
            return;
        const newRotation = ((rotationIndex + direction) % 4 + 4) % 4;
        const rotatedShape = pieces_1.PIECE_SHAPES[this.currentPiece.type][newRotation];
        // Direction-specific SRS wall kicks for this piece and this rotation pair.
        const kicks = kicksFor(this.currentPiece.type, rotationIndex, newRotation);
        const rotatedPiece = (0, pieces_1.buildPiece)(this.currentPiece.type, rotatedShape);
        for (const kick of kicks) {
            const testPos = { x: this.currentPos.x + kick.x, y: this.currentPos.y + kick.y };
            if (this.isValidPosition(rotatedPiece, testPos)) {
                this.currentRotation.index = newRotation;
                this.currentPos = testPos;
                // Rebuild shape + matching colors for the active rotation.
                this.currentPiece = rotatedPiece;
                this.callbacks.onStateChange?.();
                return;
            }
        }
        // No valid position after all kicks → instant death in hardcore mode.
        if (this.mode === types_1.GameMode.Hardcore) {
            this.hardcoreDeath();
        }
    }
    softDrop(_command) {
        if (!this.currentPiece || !this._isRunning || this._isPaused)
            return;
        const nextPos = { x: this.currentPos.x, y: this.currentPos.y + 1 };
        if (this.isValidPosition(this.currentPiece, nextPos)) {
            this.currentPos = nextPos;
            this.score += game_config_1.SCORING_CONFIG.softDrop;
            this.callbacks.onStateChange?.();
        }
        else {
            // Cannot move down: lock the piece where it actually is (never below the floor).
            this.placePiece();
        }
    }
    hardDrop(_command) {
        if (!this.currentPiece || !this._isRunning || this._isPaused)
            return;
        let dropDist = 0;
        while (this.isValidPosition(this.currentPiece, { x: this.currentPos.x, y: this.currentPos.y + dropDist + 1 })) {
            dropDist++;
        }
        this.currentPos.y += dropDist;
        this.score += game_config_1.SCORING_CONFIG.hardDrop * dropDist;
        this.placePiece();
    }
    // ====== Game Tick ======
    tick() {
        if (!this.currentPiece || !this._isRunning || this._isPaused)
            return;
        // Arcade mode: auto-drop
        if (this.mode === types_1.GameMode.Arcade) {
            this.autoDrop();
        }
        this.callbacks.onStateChange?.();
    }
    autoDrop() {
        if (!this.currentPiece)
            return;
        const config = game_config_1.GAME_CONFIG.speedConfig;
        const interval = Math.max(config.minInterval, config.initialInterval - (this.level - 1) * config.intervalDecrease);
        // For tick-based, we just move down one row per tick
        if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x, y: this.currentPos.y + 1 })) {
            this.currentPos.y += 1;
        }
        else {
            this.placePiece();
        }
    }
    // ====== Piece Placement ======
    spawnNextPiece() {
        const piece = this.pieceFactory.createPiece(this.nextPieceType);
        this.currentPiece = piece;
        // Center the piece
        const offsetX = Math.floor((this.width - piece.shape[0].length) / 2);
        this.currentPos = { x: offsetX, y: 0 };
        this.currentRotation = { index: 0 };
        // Check game over
        if (!this.isValidPosition(piece, this.currentPos)) {
            this._isGameOver = true;
            this._isRunning = false;
            this.callbacks.onGameOver?.(this.score);
            this.callbacks.onStateChange?.();
            return;
        }
        this.callbacks.onStateChange?.();
    }
    placePiece() {
        if (!this.currentPiece)
            return;
        this.boardManager.setCells(this.currentPiece, this.currentPos);
        // Clear lines
        const linesCleared = this.boardManager.clearLines();
        if (linesCleared > 0) {
            this.combo++;
            this.linesCleared += linesCleared;
            const points = this.calculateScore(linesCleared, this.combo);
            this.score += points;
            // Level up
            const newLevel = Math.floor(this.linesCleared / 10) + 1;
            if (newLevel > this.level) {
                this.level = newLevel;
            }
            this.callbacks.onLineClear?.(linesCleared, this.combo);
        }
        else {
            // A gap without a line clear breaks the combo chain.
            this.combo = 0;
        }
        // Next piece
        this.nextPieceType = this.pieceFactory.nextPieceType();
        this.spawnNextPiece();
        this.callbacks.onStateChange?.();
    }
    calculateScore(lines, combo) {
        const config = game_config_1.SCORING_CONFIG;
        let points = 0;
        switch (lines) {
            case 1:
                points = config.single;
                break;
            case 2:
                points = config.double;
                break;
            case 3:
                points = config.triple;
                break;
            case 4:
                points = config.tetris;
                break;
        }
        return Math.floor(points * (1 + (combo - 1) * config.comboMultiplier));
    }
    // ====== Collision Detection ======
    isValidPosition(piece, pos) {
        return this.boardManager.isValidPosition(piece, pos);
    }
    hasCollision(piece, pos) {
        return this.boardManager.hasCollision(piece, pos);
    }
    // ====== Getters ======
    getGameState() {
        return {
            board: this.boardManager.getCells(),
            boardWidth: this.width,
            boardHeight: this.height,
            currentPiece: this.currentPiece,
            currentPos: this.currentPos,
            currentRotation: this.currentRotation,
            nextPieceType: this.nextPieceType,
            score: this.score,
            level: this.level,
            linesCleared: this.linesCleared,
            combo: this.combo,
            isRunning: this._isRunning,
            isPaused: this._isPaused,
            isGameOver: this._isGameOver,
            mode: this.mode,
        };
    }
    getNextPieceType() {
        return this.nextPieceType;
    }
    getBoardSnapshot() {
        return this.boardManager.getSnapshot();
    }
    getCurrentPiece() {
        return this.currentPiece;
    }
    getCurrentPos() {
        return this.currentPos;
    }
    getCurrentRotation() {
        return this.currentRotation;
    }
    getScore() {
        return this.score;
    }
    getLevel() {
        return this.level;
    }
    getLinesCleared() {
        return this.linesCleared;
    }
    getCombo() {
        return this.combo;
    }
    isRunning() {
        return this._isRunning;
    }
    isPaused() {
        return this._isPaused;
    }
    isGameOver() {
        return this._isGameOver;
    }
    getMode() {
        return this.mode;
    }
}
exports.GameEngine = GameEngine;
