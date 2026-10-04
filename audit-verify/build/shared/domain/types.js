"use strict";
// ======================== DOMAIN TYPES ========================
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameMode = exports.PieceType = exports.CellState = void 0;
var CellState;
(function (CellState) {
    CellState[CellState["Empty"] = 0] = "Empty";
    CellState[CellState["Filled"] = 1] = "Filled";
})(CellState || (exports.CellState = CellState = {}));
var PieceType;
(function (PieceType) {
    PieceType["I"] = "I";
    PieceType["O"] = "O";
    PieceType["T"] = "T";
    PieceType["S"] = "S";
    PieceType["Z"] = "Z";
    PieceType["J"] = "J";
    PieceType["L"] = "L";
})(PieceType || (exports.PieceType = PieceType = {}));
var GameMode;
(function (GameMode) {
    GameMode[GameMode["Arcade"] = 0] = "Arcade";
    GameMode[GameMode["Hardcore"] = 1] = "Hardcore";
})(GameMode || (exports.GameMode = GameMode = {}));
