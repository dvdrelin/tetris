// Public surface of @neon-tetris/shared. The backend consumes the engine/domain through
// this barrel (single runtime specifier, CJS-resolvable); the frontend imports per-module
// paths through the vite/tsconfig aliases, which keeps its bundles granular.
export * from './config/control-hints';
export * from './config/game-config';
export * from './cqrs/commands';
export * from './cqrs/queries';
export * from './domain/board';
export * from './domain/pieces';
export * from './domain/player-name';
export * from './domain/types';
export * from './engine/game-engine';
export * from './input/input-actions';
export * from './input/input-controller';
export * from './input/repeat-controller';
export * from './input/touch';
export * from './net/protocol';
