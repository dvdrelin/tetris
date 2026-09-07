import { GameConfig, ScoringConfig, SpeedConfig } from '../domain/types';

export const SCORING_CONFIG: ScoringConfig = Object.freeze({
  single: 100,
  double: 300,
  triple: 500,
  tetris: 800,
  softDrop: 10,
  hardDrop: 20,
  comboMultiplier: 1.5,
  comboDecay: 0.5,
});

export const SPEED_CONFIG: SpeedConfig = Object.freeze({
  initialInterval: 800,
  intervalDecrease: 50,
  minInterval: 50,
});

export const GAME_CONFIG: GameConfig = Object.freeze({
  boardWidth: 10,
  boardHeight: 20,
  speedConfig: SPEED_CONFIG,
  scoring: SCORING_CONFIG,
});
