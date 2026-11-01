// ======================== DOMAIN TYPES ========================

export enum PieceType {
  I = 'I', O = 'O', T = 'T', S = 'S', Z = 'Z', J = 'J', L = 'L'
}

export interface Cell {
  value: number;        // 0-7 piece type index, 0 = empty
  locked: boolean;      // true = placed on board
}

export interface Position {
  x: number;
  y: number;
}

export interface RotationState {
  index: number;
}

export interface GameState {
  board: Cell[][];
  boardWidth: number;
  boardHeight: number;
  currentPiece: Piece | null;
  currentPos: Position;
  currentRotation: RotationState;
  // Upcoming pieces, nearest first (A6). The queue is the single source: there is no separate
  // "next piece" field any more.
  nextQueue: PieceType[];
  // Held piece slot (A4): one swap per piece, `canHold` tells the UI whether the swap is used up.
  holdType: PieceType | null;
  canHold: boolean;
  score: number;
  level: number;
  linesCleared: number;
  combo: number;
  isRunning: boolean;
  isPaused: boolean;
  isGameOver: boolean;
  mode: GameMode;
  // Why the game ended. Set only together with `isGameOver`, cleared on restart. Hardcore kills
  // for reasons Arcade never has (wall crash, refused rotation), so the UI needs the cause to
  // explain the difference instead of leaving the player with a mysterious GAME OVER.
  overReason: GameOverReason | null;
}

export enum GameMode { Arcade, Hardcore }

export enum GameOverReason {
  /** A newly spawned/held piece had nowhere to appear — the only cause present in both modes. */
  BlockOut = 'block-out',
  /** Hardcore: a left/right move was stopped by a placed block (the stack). The side wall is
   *  safe — see A13. The id keeps the historical name 'wall-crash'. */
  HardcoreWallCrash = 'hardcore-wall-crash',
  /** Hardcore: a rotation had no valid position, not even with a wall kick. */
  HardcoreRotationStuck = 'hardcore-rotation-stuck',
}

export interface Piece {
  type: PieceType;
  shape: number[][];
  colors: number[][];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface SpeedConfig {
  initialInterval: number;
  intervalDecrease: number;
  minInterval: number;
}

export interface LockConfig {
  readonly delayMs: number;
  readonly maxResets: number;
}

export interface GameConfig {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly speedConfig: SpeedConfig;
  readonly scoring: ScoringConfig;
  readonly lockConfig: LockConfig;
}

export interface ScoringConfig {
  readonly single: number;
  readonly double: number;
  readonly triple: number;
  readonly tetris: number;
  readonly softDrop: number;
  readonly hardDrop: number;
  readonly comboMultiplier: number;
}
