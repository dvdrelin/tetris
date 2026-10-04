import {
  GameState, Position, RotationState, GameMode,
  Cell, Piece, PieceType
} from '../domain/types';
import { BoardManager } from '../domain/board';
import { PieceFactoryProvider, PIECE_SHAPES, buildPiece } from '../domain/pieces';
import {
  AnyCommand, CommandType, MoveCommand, StartGameCommand
} from '../cqrs/commands';
import { AnyQuery, QueryType } from '../cqrs/queries';
import { GAME_CONFIG, SCORING_CONFIG } from '../config/game-config';

export interface GameEngineCallbacks {
  onStateChange?: () => void;
  onLineClear?: (count: number, combo: number) => void;
  onGameOver?: (score: number) => void;
}

// ===== SRS wall-kick tables =====
// Rotation indices: 0 = spawn, 1 = R (CW from spawn), 2 = 180, 3 = L (CCW from spawn).
// Offsets are in ENGINE coordinates: +x right, +y DOWN. The classic SRS tables use
// +y up, so their y signs are inverted here. Tables are direction-specific: the CW and
// CCW kick lists are different, and I-piece kicks differ from JLSTZ kicks.
interface Kick { x: number; y: number }

const KICKS_JLSTZ: Record<string, Kick[]> = {
  '0>1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
  '1>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
  '1>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
  '2>1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
  '2>3': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
  '3>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
  '3>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  '0>3': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: -2 }, { x: -1, y: -2 }],
};

const KICKS_I: Record<string, Kick[]> = {
  '0>1': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 1 }, { x: 1, y: -2 }],
  '1>0': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: -1 }, { x: -1, y: 2 }],
  '1>2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: -2 }, { x: 2, y: 1 }],
  '2>1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 2 }, { x: -2, y: -1 }],
  '2>3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 2 }, { x: -2, y: -1 }],
  '3>2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: -2 }, { x: 2, y: 1 }],
  '3>0': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: -1 }, { x: -1, y: 2 }],
  '0>3': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 1 }, { x: 1, y: -2 }],
};

const KICKS_O: Record<string, Kick[]> = {
  '0>1': [{ x: 0, y: 0 }], '1>0': [{ x: 0, y: 0 }],
  '1>2': [{ x: 0, y: 0 }], '2>1': [{ x: 0, y: 0 }],
  '2>3': [{ x: 0, y: 0 }], '3>2': [{ x: 0, y: 0 }],
  '3>0': [{ x: 0, y: 0 }], '0>3': [{ x: 0, y: 0 }],
};

function kicksFor(type: PieceType, from: number, to: number): Kick[] {
  const key = `${from}>${to}`;
  const table = type === PieceType.I ? KICKS_I : type === PieceType.O ? KICKS_O : KICKS_JLSTZ;
  return table[key] ?? [{ x: 0, y: 0 }];
}

export class GameEngine {
  private boardManager: BoardManager;
  private pieceFactory: PieceFactoryProvider;
  private callbacks: GameEngineCallbacks;

  // Mutable state (not exposed directly)
  private board: Cell[][] = [];
  private readonly width: number;
  private readonly height: number;
  private currentPiece: Piece | null = null;
  private currentPos: Position = { x: 0, y: 0 };
  private currentRotation: RotationState = { index: 0 };
  private nextPieceType: PieceType = PieceType.I;
  private score: number = 0;
  private level: number = 1;
  private linesCleared: number = 0;
  private combo: number = 0;
  private _isRunning: boolean = false;
  private _isPaused: boolean = false;
  private _isGameOver: boolean = false;
  private mode: GameMode;

  constructor(callbacks: GameEngineCallbacks) {
    this.callbacks = callbacks;
    const config = GAME_CONFIG;
    this.width = config.boardWidth;
    this.height = config.boardHeight;
    this.boardManager = new BoardManager(config.boardWidth, config.boardHeight);
    this.pieceFactory = new PieceFactoryProvider();
    this.mode = GameMode.Arcade;

    // Generate next piece
    this.nextPieceType = this.pieceFactory.nextPieceType();
  }

  // ====== CQRS Command Handlers ======

  handleCommand(command: AnyCommand): void {
    // Once the game is over (or before it starts) only StartGame may reach the engine.
    if (command.type !== CommandType.StartGame && (this._isGameOver || !this._isRunning)) return;

    // One switch instead of a string-keyed handler map: TypeScript narrows `command`
    // to its concrete command type in every branch, so handlers get real parameter types.
    switch (command.type) {
      case CommandType.StartGame:
        this.startGame(command);
        return;
      case CommandType.MovePiece:
        this.movePiece(command);
        return;
      case CommandType.RotatePiece: {
        // A malformed direction is ignored instead of silently turning counter-clockwise.
        const direction = command.payload?.direction;
        if (direction !== 'cw' && direction !== 'ccw') return;
        this.rotatePiece(this.currentRotation.index, direction === 'cw' ? 1 : -1);
        return;
      }
      case CommandType.SoftDrop:
        this.softDrop();
        return;
      case CommandType.HardDrop:
        this.hardDrop();
        return;
      case CommandType.Tick:
        this.tick();
        return;
      case CommandType.PauseGame:
        this.pauseGame();
        return;
      case CommandType.ResumeGame:
        this.resumeGame();
        return;
      default:
        // Unknown command type: ignore it.
        return;
    }
  }

  // ====== CQRS Query Handlers ======

  handleQuery(query: AnyQuery): unknown {
    switch (query.type) {
      case QueryType.GetGameState:
        return this.getGameState();
      case QueryType.GetNextPiece:
        return this.getNextPieceType();
      case QueryType.GetBoardState:
        return this.getBoardSnapshot();
      default:
        return null;
    }
  }

  // ====== Game Lifecycle ======

  private startGame(command: StartGameCommand): void {
    // The store sends payload.mode (GameMode); `payload.hardcore` is kept as a legacy alias.
    const payload = command.payload as { mode?: number; hardcore?: boolean } | undefined;
    const requested = payload?.mode ?? (payload?.hardcore ? GameMode.Hardcore : GameMode.Arcade);
    this.mode = requested === GameMode.Hardcore ? GameMode.Hardcore : GameMode.Arcade;
    this.reset();
    this._isRunning = true;
    this._isPaused = false;
    this._isGameOver = false;
    this.spawnNextPiece();
    this.callbacks.onStateChange?.();
  }

  private pauseGame(): void {
    this._isPaused = true;
    this.callbacks.onStateChange?.();
  }

  private resumeGame(): void {
    this._isPaused = false;
    this.callbacks.onStateChange?.();
  }

  reset(): void {
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

  private movePiece(command: MoveCommand): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;
    const direction = command.payload?.direction;
    if (!direction) return;

    let dx = 0, dy = 0;
    switch (direction) {
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
      case 'down': dy = 1; break;
      default:
        // Unknown movement direction: ignore the command rather than treating it as a move.
        // Rotation is not a movement alias any more — it arrives as RotatePiece.
        return;
    }

    if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x + dx, y: this.currentPos.y + dy })) {
      this.currentPos.x += dx;
      this.currentPos.y += dy;
    } else if (this.mode === GameMode.Hardcore) {
      // Hardcore mode: any move into a wall/block is instant death.
      this.hardcoreDeath();
    }
    this.callbacks.onStateChange?.();
  }

  private hardcoreDeath(): void {
    this._isGameOver = true;
    this._isRunning = false;
    this.callbacks.onGameOver?.(this.score);
    this.callbacks.onStateChange?.();
  }

  private rotatePiece(rotationIndex: number, direction: number): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;

    const newRotation = ((rotationIndex + direction) % 4 + 4) % 4;
    const rotatedShape = PIECE_SHAPES[this.currentPiece.type][newRotation];

    // Direction-specific SRS wall kicks for this piece and this rotation pair.
    const kicks = kicksFor(this.currentPiece.type, rotationIndex, newRotation);

    const rotatedPiece = buildPiece(this.currentPiece.type, rotatedShape);

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
    if (this.mode === GameMode.Hardcore) {
      this.hardcoreDeath();
    }
  }

  private softDrop(): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;
    const nextPos = { x: this.currentPos.x, y: this.currentPos.y + 1 };
    if (this.isValidPosition(this.currentPiece, nextPos)) {
      this.currentPos = nextPos;
      this.score += SCORING_CONFIG.softDrop;
      this.callbacks.onStateChange?.();
    } else {
      // Cannot move down: lock the piece where it actually is (never below the floor).
      this.placePiece();
    }
  }

  private hardDrop(): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;
    let dropDist = 0;
    while (this.isValidPosition(this.currentPiece, { x: this.currentPos.x, y: this.currentPos.y + dropDist + 1 })) {
      dropDist++;
    }
    this.currentPos.y += dropDist;
    this.score += SCORING_CONFIG.hardDrop * dropDist;
    this.placePiece();
  }

  // ====== Game Tick ======

  private tick(): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;

    // Arcade mode: auto-drop
    if (this.mode === GameMode.Arcade) {
      this.autoDrop();
    }
    this.callbacks.onStateChange?.();
  }

  private autoDrop(): void {
    if (!this.currentPiece) return;
    const config = GAME_CONFIG.speedConfig;
    const interval = Math.max(config.minInterval, config.initialInterval - (this.level - 1) * config.intervalDecrease);
    // For tick-based, we just move down one row per tick
    if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x, y: this.currentPos.y + 1 })) {
      this.currentPos.y += 1;
    } else {
      this.placePiece();
    }
  }

  // ====== Piece Placement ======

  private spawnNextPiece(): void {
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

  private placePiece(): void {
    if (!this.currentPiece) return;
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
    } else {
      // A gap without a line clear breaks the combo chain.
      this.combo = 0;
    }

    // Next piece
    this.nextPieceType = this.pieceFactory.nextPieceType();
    this.spawnNextPiece();

    this.callbacks.onStateChange?.();
  }

  private calculateScore(lines: number, combo: number): number {
    const config = SCORING_CONFIG;
    let points = 0;
    switch (lines) {
      case 1: points = config.single; break;
      case 2: points = config.double; break;
      case 3: points = config.triple; break;
      case 4: points = config.tetris; break;
    }
    return Math.floor(points * (1 + (combo - 1) * config.comboMultiplier));
  }

  // ====== Collision Detection ======

  isValidPosition(piece: Piece, pos: Position): boolean {
    return this.boardManager.isValidPosition(piece, pos);
  }

  // ====== Getters ======

  getGameState(): GameState {
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

  getNextPieceType(): PieceType {
    return this.nextPieceType;
  }

  getBoardSnapshot(): number[][] {
    return this.boardManager.getSnapshot();
  }

  getCurrentPiece(): Piece | null {
    return this.currentPiece;
  }

  getCurrentPos(): Position {
    return this.currentPos;
  }

  getCurrentRotation(): RotationState {
    return this.currentRotation;
  }

  getScore(): number {
    return this.score;
  }

  getLevel(): number {
    return this.level;
  }

  getLinesCleared(): number {
    return this.linesCleared;
  }

  getCombo(): number {
    return this.combo;
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  isGameOver(): boolean {
    return this._isGameOver;
  }

  getMode(): GameMode {
    return this.mode;
  }

}
