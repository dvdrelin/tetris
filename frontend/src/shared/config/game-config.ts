import { GameConfig, GameMode, ScoringConfig, SpeedConfig } from '../domain/types';

export const SCORING_CONFIG: ScoringConfig = Object.freeze({
  single: 100,
  double: 300,
  triple: 500,
  tetris: 800,
  softDrop: 10,
  hardDrop: 20,
  comboMultiplier: 1.5,
});

export const SPEED_CONFIG: SpeedConfig = Object.freeze({
  initialInterval: 800,
  intervalDecrease: 50,
  minInterval: 50,
});

// Hardcore gravity is twice as fast as Arcade: the interval is halved, but never below
// SPEED_CONFIG.minInterval. Arcade keeps the frozen table untouched.
export const HARDCORE_SPEED_MULTIPLIER = 0.5;

// The single source of truth for gravity. The engine owns it: UI only reports elapsed time.
export function dropInterval(level: number, mode: GameMode): number {
  const config = SPEED_CONFIG;
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const base = Math.max(config.minInterval, config.initialInterval - (safeLevel - 1) * config.intervalDecrease);
  const scaled = mode === GameMode.Hardcore ? base * HARDCORE_SPEED_MULTIPLIER : base;
  return Math.max(config.minInterval, scaled);
}

export const GAME_CONFIG: GameConfig = Object.freeze({
  boardWidth: 10,
  boardHeight: 20,
  speedConfig: SPEED_CONFIG,
  scoring: SCORING_CONFIG,
});
