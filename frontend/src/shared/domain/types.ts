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
  nextPieceType: PieceType;
  score: number;
  level: number;
  linesCleared: number;
  combo: number;
  isRunning: boolean;
  isPaused: boolean;
  isGameOver: boolean;
  mode: GameMode;
}

export enum GameMode { Arcade, Hardcore }

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

export interface GameConfig {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly speedConfig: SpeedConfig;
  readonly scoring: ScoringConfig;
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
