import {
  GameState, Position, RotationState, GameMode, GameConfig,
  Cell, CellState, Piece, PieceType, TickResult, Particle
} from '../domain/types';
import { BoardManager } from '../domain/board';
import { PieceFactoryProvider, PIECE_SHAPES } from '../domain/pieces';
import { CommandType } from '../cqrs/commands';
import { AnyCommand, AnyQuery, QueryType } from '../cqrs/queries';
import { GAME_CONFIG, SCORING_CONFIG } from '../config/game-config';

// Type guard for command types
function isCommandType(type: string): type is CommandType {
  return Object.values(CommandType).includes(type as CommandType);
}

export type CommandHandler = (command: AnyCommand) => void;
export type QueryHandler = (query: AnyQuery) => unknown;

export interface GameEngineCallbacks {
  onStateChange?: () => void;
  onLineClear?: (count: number, combo: number) => void;
  onGameOver?: (score: number) => void;
}

export class GameEngine {
  private boardManager: BoardManager;
  private pieceFactory: PieceFactoryProvider;
  private callbacks: GameEngineCallbacks;

  // Mutable state (not exposed directly)
  private board: Cell[][];
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
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private isGameOver: boolean = false;
  private readonly mode: GameMode;
  private particles: Particle[] = [];

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
    const handlerMap: Record<string, () => void> = {
      [CommandType.StartGame]: () => this.startGame(command),
      [CommandType.MovePiece]: () => this.movePiece(command),
      [CommandType.RotatePiece]: () => this.rotatePiece(command),
      [CommandType.SoftDrop]: () => this.softDrop(command),
      [CommandType.HardDrop]: () => this.hardDrop(command),
      [CommandType.Tick]: () => this.tick(),
      [CommandType.PauseGame]: () => this.pauseGame(),
      [CommandType.ResumeGame]: () => this.resumeGame(),
    };
    const handler = handlerMap[command.type];
    if (handler) {
      handler();
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

  private startGame(command: any): void {
    this.mode = command.payload?.mode === 1 ? GameMode.Hardcore : GameMode.Arcade;
    this.reset();
    this.spawnNextPiece();
    this.isRunning = true;
    this.isPaused = false;
    this.isGameOver = false;
    this.callbacks.onStateChange?.();
  }

  private pauseGame(): void {
    this.isPaused = true;
    this.callbacks.onStateChange?.();
  }

  private resumeGame(): void {
    this.isPaused = false;
    this.callbacks.onStateChange?.();
  }

  reset(): void {
    this.board = this.boardManager.getCells();
    this.boardManager.reset();
    this.currentPiece = null;
    this.currentPos = { x: 0, y: 0 };
    this.currentRotation = { index: 0 };
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.combo = 0;
    this.isGameOver = false;
    this.particles = [];
    this.nextPieceType = this.pieceFactory.nextPieceType();
  }

  // ====== Movement ======

  private movePiece(command: any): void {
    if (!this.currentPiece || !this.isRunning || this.isPaused) return;
    const direction = command.payload?.direction;
    if (!direction) return;

    let dx = 0, dy = 0;
    switch (direction) {
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
      case 'down': dy = 1; break;
      case 'rotateCW': {
        this.rotate(this.currentRotation.index, 1);
        return;
      }
      case 'rotateCCW': {
        this.rotate(this.currentRotation.index, -1);
        return;
      }
    }

    if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x + dx, y: this.currentPos.y + dy })) {
      this.currentPos.x += dx;
      this.currentPos.y += dy;
    }
    this.callbacks.onStateChange?.();
  }

  private rotate(rotationIndex: number, direction: number): void {
    if (!this.currentPiece || !this.isRunning || this.isPaused) return;

    const newRotation = ((rotationIndex + direction) % 4 + 4) % 4;
    const rotatedShape = PIECE_SHAPES[this.currentPiece.type][newRotation];

    // Wall kick offsets (SRS)
    const kicks = [
      { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }
    ];

    for (const kick of kicks) {
      const testPos = { x: this.currentPos.x + kick.x, y: this.currentPos.y + kick.y };
      if (this.isValidPosition({ type: this.currentPiece.type, shape: rotatedShape, colors: this.currentPiece.colors }, testPos)) {
        this.currentRotation.index = newRotation;
        this.currentPos = testPos;
        return;
      }
    }
  }

  private softDrop(_command: any): void {
    if (!this.currentPiece || !this.isRunning || this.isPaused) return;
    this.currentPos.y += 1;
    this.score += SCORING_CONFIG.softDrop;
    if (!this.isValidPosition(this.currentPiece, this.currentPos)) {
      this.placePiece();
    }
    this.callbacks.onStateChange?.();
  }

  private hardDrop(_command: any): void {
    if (!this.currentPiece || !this.isRunning || this.isPaused) return;
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
    if (!this.currentPiece || !this.isRunning || this.isPaused) return;

    // Arcade mode: auto-drop
    if (this.mode === GameMode.Arcade) {
      this.autoDrop();
    }
    this.callbacks.onStateChange?.();
  }

  private autoDrop(): void {
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
      this.isGameOver = true;
      this.callbacks.onGameOver?.(this.score);
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

      // Spawn particles
      this.spawnClearParticles(linesCleared);

      this.callbacks.onLineClear?.(linesCleared, this.combo);
    } else {
      this.combo = Math.max(0, this.combo - SCORING_CONFIG.comboDecay);
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

  hasCollision(piece: Piece, pos: Position): boolean {
    return this.boardManager.hasCollision(piece, pos);
  }

  getLowestEmptyY(piece: Piece, startX: number): number {
    return this.boardManager.getLowestEmptyY(piece, startX);
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
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isGameOver: this.isGameOver,
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
    return this.isRunning;
  }

  isPaused(): boolean {
    return this.isPaused;
  }

  isGameOver(): boolean {
    return this.isGameOver;
  }

  getMode(): GameMode {
    return this.mode;
  }

  // ====== Particles ======

  spawnClearParticles(lines: number): void {
    for (let i = 0; i < lines * 20; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        life: 1,
        maxLife: 1,
        color: `hsl(${Math.random() * 360}, 100%, 60%)`,
        size: 2 + Math.random() * 3,
      });
    }
  }

  updateParticles(dt: number): void {
    this.particles = this.particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 0.5;
      return p.life > 0;
    });
  }

  getParticles(): Particle[] {
    return this.particles;
  }

}
