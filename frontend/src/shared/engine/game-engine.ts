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
import { GAME_CONFIG, LOCK_CONFIG, QUEUE_SIZE, SCORING_CONFIG, dropInterval } from '../config/game-config';

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
  // 180° turns (A5) have their own kick set: a half turn is one rotation with one kick attempt,
  // not two 90° rotations. Classic y-up offsets (0,0) (±1,0) (0,±1), y inverted for engine coords.
  '0>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  '2>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  '1>3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  '3>1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
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
  // I-piece 180° kicks (A5): the same half-turn offsets as JLSTZ.
  '0>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  '2>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  '1>3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  '3>1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
};

const KICKS_O: Record<string, Kick[]> = {
  '0>1': [{ x: 0, y: 0 }], '1>0': [{ x: 0, y: 0 }],
  '1>2': [{ x: 0, y: 0 }], '2>1': [{ x: 0, y: 0 }],
  '2>3': [{ x: 0, y: 0 }], '3>2': [{ x: 0, y: 0 }],
  '3>0': [{ x: 0, y: 0 }], '0>3': [{ x: 0, y: 0 }],
  // O is symmetric: a half turn needs no offset at all.
  '0>2': [{ x: 0, y: 0 }], '2>0': [{ x: 0, y: 0 }],
  '1>3': [{ x: 0, y: 0 }], '3>1': [{ x: 0, y: 0 }],
};

function kicksFor(type: PieceType, from: number, to: number): Kick[] {
  const key = `${from}>${to}`;
  const table = type === PieceType.I ? KICKS_I : type === PieceType.O ? KICKS_O : KICKS_JLSTZ;
  return table[key] ?? [{ x: 0, y: 0 }];
}

// A single frame delta is capped so that a background tab (rAF paused for seconds) cannot
// teleport a piece to the bottom in one tick. 250ms is well above a real frame (~16ms) and
// well below a tab-switch gap.
const MAX_TICK_DELTA_MS = 250;

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
  // Upcoming pieces, nearest first (A6). There is no separate "next piece" field: nextQueue[0]
  // is the next piece, and the queue is always kept at QUEUE_SIZE entries.
  private nextQueue: PieceType[] = [];
  private holdType: PieceType | null = null;
  private canHold: boolean = true;
  private score: number = 0;
  private level: number = 1;
  private linesCleared: number = 0;
  private combo: number = 0;
  private _isRunning: boolean = false;
  private _isPaused: boolean = false;
  private _isGameOver: boolean = false;
  private mode: GameMode;
  // Gravity timing lives here, not in the UI: Tick carries elapsed milliseconds and the
  // engine decides how many rows the piece falls.
  private gravityAccumulator: number = 0;
  private elapsedMs: number = 0;
  // Lock delay (A3): counted from Tick milliseconds only, never from a wall clock, so paused
  // time and background tabs can never spend the lock timer.
  private lockAccumulator: number = 0;
  private lockResets: number = 0;

  constructor(callbacks: GameEngineCallbacks) {
    this.callbacks = callbacks;
    const config = GAME_CONFIG;
    this.width = config.boardWidth;
    this.height = config.boardHeight;
    this.boardManager = new BoardManager(config.boardWidth, config.boardHeight);
    this.pieceFactory = new PieceFactoryProvider();
    this.mode = GameMode.Arcade;

    // Fill the visible queue (A6)
    this.nextQueue = this.fillQueue();
  }

  private fillQueue(): PieceType[] {
    const queue: PieceType[] = [];
    while (queue.length < QUEUE_SIZE) {
      queue.push(this.pieceFactory.nextPieceType());
    }
    return queue;
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
        if (direction !== 'cw' && direction !== 'ccw' && direction !== '180') return;
        const turn = direction === 'cw' ? 1 : direction === 'ccw' ? -1 : 2;
        this.rotatePiece(this.currentRotation.index, turn);
        return;
      }
      case CommandType.SoftDrop:
        this.softDrop();
        return;
      case CommandType.HardDrop:
        this.hardDrop();
        return;
      case CommandType.HoldPiece:
        this.holdPiece();
        return;
      case CommandType.Tick: {
        const dt = command.payload?.dt;
        this.tick(typeof dt === 'number' ? dt : 0);
        return;
      }
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
    this.gravityAccumulator = 0;
    this.elapsedMs = 0;
    this.lockAccumulator = 0;
    this.lockResets = 0;
    this.holdType = null;
    this.canHold = true;
    this.nextQueue = this.fillQueue();
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
      case 'down':
        // Down is a soft drop: it locks on the floor instead of killing, even in Hardcore.
        this.softDrop();
        return;
      default:
        // Unknown movement direction: ignore the command rather than treating it as a move.
        // Rotation is not a movement alias any more — it arrives as RotatePiece.
        return;
    }

    if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x + dx, y: this.currentPos.y + dy })) {
      this.currentPos.x += dx;
      this.currentPos.y += dy;
      this.onSuccessfulManipulation();
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
        this.onSuccessfulManipulation();
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
      // Soft drop onto the surface locks immediately: the lock timer is for gravity landings.
      if (this.isGrounded()) {
        this.placePiece();
        return;
      }
      this.lockAccumulator = 0;
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

  // dtMs = milliseconds elapsed since the previous Tick. Gravity is accumulated here, so a
  // dropped frame loses no time: the leftover is carried into the next tick, and a long frame
  // can pay for several rows. Auto-drop runs in both modes; Hardcore differs by death on a
  // blocked move, not by having no gravity.
  private tick(dtMs: number): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;

    // A missing, negative, NaN or Infinity delta contributes no time: gravity can never run
    // backwards and the accumulator can never become NaN.
    const dt = Number.isFinite(dtMs) ? Math.min(Math.max(dtMs, 0), MAX_TICK_DELTA_MS) : 0;
    this.elapsedMs += dt;

    // Gravity runs only while the piece can still fall. Once it rests on the floor or on locked
    // cells, the same dt feeds the lock timer instead (A3). A piece that lands mid-frame starts
    // its lock delay on the next Tick: the frame that carried it down is not lock time.
    if (this.isGrounded()) {
      this.lockAccumulator += dt;
      if (this.lockAccumulator >= LOCK_CONFIG.delayMs) {
        this.placePiece();
      }
    } else {
      let interval = dropInterval(this.level, this.mode);
      this.gravityAccumulator += dt;
      while (this.gravityAccumulator >= interval) {
        this.gravityAccumulator -= interval;
        const pieceBefore: Piece | null = this.currentPiece;
        this.autoDrop();
        // The piece locked (or the game ended): stop spending the remaining time on a new piece.
        if (this._isGameOver || this.currentPiece !== pieceBefore) {
          this.gravityAccumulator = 0;
          break;
        }
        // A line clear can raise the level, and the level changes the interval.
        interval = dropInterval(this.level, this.mode);
        if (this.isGrounded()) {
          // Landed by gravity: leftover gravity time is not carried over into the lock timer.
          this.gravityAccumulator = 0;
          break;
        }
      }
    }

    this.callbacks.onStateChange?.();
  }

  private autoDrop(): void {
    if (!this.currentPiece) return;
    if (this.isValidPosition(this.currentPiece, { x: this.currentPos.x, y: this.currentPos.y + 1 })) {
      this.currentPos.y += 1;
    }
    // A gravity landing does not lock the piece: tick() spends the next LOCK_CONFIG.delayMs of
    // active play on the lock timer, during which moves and rotations can still restart it.
  }

  // ====== Lock delay (A3) ======

  /** True when the piece cannot move down any more (floor or locked cells directly below). */
  isGrounded(): boolean {
    if (!this.currentPiece) return false;
    return !this.isValidPosition(this.currentPiece, { x: this.currentPos.x, y: this.currentPos.y + 1 });
  }

  /**
   * A successful move or rotation restarts the lock timer while the piece is grounded, at most
   * LOCK_CONFIG.maxResets times. After that budget is spent, the next successful manipulation
   * locks the piece where it stands.
   */
  private onSuccessfulManipulation(): void {
    if (!this.isGrounded()) {
      this.lockAccumulator = 0;
      return;
    }
    if (this.lockResets >= LOCK_CONFIG.maxResets) {
      this.placePiece();
      return;
    }
    this.lockResets++;
    this.lockAccumulator = 0;
  }

  // ====== Piece Placement ======

  private spawnNextPiece(): void {
    const type = this.nextQueue.shift() ?? this.pieceFactory.nextPieceType();
    while (this.nextQueue.length < QUEUE_SIZE) {
      this.nextQueue.push(this.pieceFactory.nextPieceType());
    }
    // A freshly spawned piece may be held once (A4).
    this.canHold = true;
    this.spawnPiece(type);
  }

  private spawnPiece(type: PieceType): void {
    const piece = this.pieceFactory.createPiece(type);
    this.currentPiece = piece;
    // Center the piece
    const offsetX = Math.floor((this.width - piece.shape[0].length) / 2);
    this.currentPos = { x: offsetX, y: 0 };
    this.currentRotation = { index: 0 };
    this.gravityAccumulator = 0;
    this.lockAccumulator = 0;
    this.lockResets = 0;

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

  /**
   * Hold (A4): swap the active piece with the hold slot, once per piece. An empty slot pulls the
   * piece from the front of the queue; the queue is refilled to QUEUE_SIZE either way.
   */
  private holdPiece(): void {
    if (!this.currentPiece || !this._isRunning || this._isPaused) return;
    if (!this.canHold) return;

    const heldNow = this.currentPiece.type;
    const spawnType = this.holdType ?? this.nextQueue.shift() ?? this.pieceFactory.nextPieceType();
    this.holdType = heldNow;
    this.canHold = false;
    while (this.nextQueue.length < QUEUE_SIZE) {
      this.nextQueue.push(this.pieceFactory.nextPieceType());
    }
    // canHold stays false: the new piece of this turn cannot be held again.
    this.spawnPiece(spawnType);
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

    // Next piece: spawnNextPiece pulls from the queue and refills it.
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
      nextQueue: [...this.nextQueue],
      holdType: this.holdType,
      canHold: this.canHold,
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
    return this.nextQueue[0] ?? this.pieceFactory.nextPieceType();
  }

  getNextQueue(): PieceType[] {
    return [...this.nextQueue];
  }

  getHoldType(): PieceType | null {
    return this.holdType;
  }

  canHoldPiece(): boolean {
    return this.canHold;
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

  // Milliseconds of active play accumulated by the engine (Tick deltas, capped per tick).
  getElapsedMs(): number {
    return this.elapsedMs;
  }

  // Milliseconds of gravity time still unpaid towards the next automatic row.
  getGravityAccumulator(): number {
    return this.gravityAccumulator;
  }

  // Current gravity interval, ms per row, for this level and mode.
  getDropInterval(): number {
    return dropInterval(this.level, this.mode);
  }

  // Milliseconds of active play the grounded piece has already spent in its lock delay.
  getLockAccumulator(): number {
    return this.lockAccumulator;
  }

  // How many lock-delay restarts the grounded piece has already used (max LOCK_CONFIG.maxResets).
  getLockResets(): number {
    return this.lockResets;
  }

}
