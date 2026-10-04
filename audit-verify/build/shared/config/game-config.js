"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GAME_CONFIG = exports.SPEED_CONFIG = exports.SCORING_CONFIG = void 0;
exports.SCORING_CONFIG = Object.freeze({
    single: 100,
    double: 300,
    triple: 500,
    tetris: 800,
    softDrop: 10,
    hardDrop: 20,
    comboMultiplier: 1.5,
    comboDecay: 0.5,
});
exports.SPEED_CONFIG = Object.freeze({
    initialInterval: 800,
    intervalDecrease: 50,
    minInterval: 50,
});
exports.GAME_CONFIG = Object.freeze({
    boardWidth: 10,
    boardHeight: 20,
    speedConfig: exports.SPEED_CONFIG,
    scoring: exports.SCORING_CONFIG,
});
