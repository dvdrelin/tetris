"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PieceFactoryProvider = exports.PieceFactory = exports.PIECE_SHAPES = void 0;
exports.buildPiece = buildPiece;
const types_1 = require("./types");
const COLORS = {
    [types_1.PieceType.I]: 1,
    [types_1.PieceType.O]: 2,
    [types_1.PieceType.T]: 3,
    [types_1.PieceType.S]: 4,
    [types_1.PieceType.Z]: 5,
    [types_1.PieceType.J]: 6,
    [types_1.PieceType.L]: 7,
};
// Canonical SRS rotation states.
// Rule: every piece keeps its bounding box in all 4 rotations (I = 4x4, O = 2x2,
// JLSTZ = 3x3) and every rotation is a true 90° turn of the previous one.
exports.PIECE_SHAPES = {
    [types_1.PieceType.I]: [
        [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
        [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
        [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
    ],
    [types_1.PieceType.O]: [
        [[1, 1], [1, 1]],
        [[1, 1], [1, 1]],
        [[1, 1], [1, 1]],
        [[1, 1], [1, 1]],
    ],
    [types_1.PieceType.T]: [
        [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
        [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
        [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
    ],
    [types_1.PieceType.S]: [
        [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
        [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
        [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
        [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    ],
    [types_1.PieceType.Z]: [
        [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
        [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
        [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
        [[0, 1, 0], [1, 1, 0], [1, 0, 0]],
    ],
    [types_1.PieceType.J]: [
        [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
        [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
        [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
        [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
    ],
    [types_1.PieceType.L]: [
        [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
        [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
        [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
        [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
    ],
};
// 7-bag randomizer for fair piece distribution
class PieceFactory {
    constructor() {
        this.bag = [];
        this.shuffledBag = [];
        this.resetBag();
    }
    resetBag() {
        const base = [
            types_1.PieceType.I, types_1.PieceType.O, types_1.PieceType.T, types_1.PieceType.S, types_1.PieceType.Z, types_1.PieceType.J, types_1.PieceType.L
        ];
        this.shuffledBag = [...base];
        // Fisher-Yates shuffle
        for (let i = this.shuffledBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shuffledBag[i], this.shuffledBag[j]] = [this.shuffledBag[j], this.shuffledBag[i]];
        }
    }
    nextPieceType() {
        if (this.shuffledBag.length === 0) {
            this.resetBag();
        }
        return this.shuffledBag.pop();
    }
}
exports.PieceFactory = PieceFactory;
class PieceFactoryProvider {
    constructor() {
        this.factory = new PieceFactory();
    }
    nextPieceType() {
        return this.factory.nextPieceType();
    }
    createPiece(type) {
        return buildPiece(type, exports.PIECE_SHAPES[type][0]);
    }
}
exports.PieceFactoryProvider = PieceFactoryProvider;
// Builds a piece (shape + matching colors) for an arbitrary rotation.
function buildPiece(type, shape) {
    const colors = [];
    for (let r = 0; r < shape.length; r++) {
        const row = [];
        for (let c = 0; c < shape[r].length; c++) {
            row.push(shape[r][c] ? COLORS[type] : 0);
        }
        colors.push(row);
    }
    return { type, shape, colors };
}
