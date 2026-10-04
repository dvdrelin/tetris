"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandType = void 0;
var CommandType;
(function (CommandType) {
    CommandType["StartGame"] = "StartGame";
    CommandType["MovePiece"] = "MovePiece";
    CommandType["RotatePiece"] = "RotatePiece";
    CommandType["SoftDrop"] = "SoftDrop";
    CommandType["HardDrop"] = "HardDrop";
    CommandType["Tick"] = "Tick";
    CommandType["PauseGame"] = "PauseGame";
    CommandType["ResumeGame"] = "ResumeGame";
})(CommandType || (exports.CommandType = CommandType = {}));
