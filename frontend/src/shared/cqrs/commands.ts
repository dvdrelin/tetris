export enum CommandType {
  StartGame = 'StartGame',
  MovePiece = 'MovePiece',
  RotatePiece = 'RotatePiece',
  SoftDrop = 'SoftDrop',
  HardDrop = 'HardDrop',
  HoldPiece = 'HoldPiece',
  Tick = 'Tick',
  PauseGame = 'PauseGame',
  ResumeGame = 'ResumeGame',
}

export interface Command {
  type: CommandType;
  payload?: unknown;
}

export interface MoveCommand extends Command {
  type: CommandType.MovePiece;
  // Rotation is not a movement direction: it has its own RotatePiece command.
  payload: { direction: 'left' | 'right' | 'down' };
}

export interface RotateCommand extends Command {
  type: CommandType.RotatePiece;
  // '180' is a half turn (A5): one command, one wall-kick attempt, not two 90° rotations.
  payload: { direction: 'cw' | 'ccw' | '180' };
}

export interface SoftDropCommand extends Command {
  type: CommandType.SoftDrop;
}

export interface HardDropCommand extends Command {
  type: CommandType.HardDrop;
}

export interface HoldPieceCommand extends Command {
  type: CommandType.HoldPiece;
  // Swaps the active piece with the hold slot. The engine enforces "one hold per piece".
}

export interface TickCommand extends Command {
  type: CommandType.Tick;
  // Milliseconds elapsed since the previous Tick. The engine owns gravity: it accumulates
  // this time and decides how many rows the piece falls. UI does not compute intervals.
  payload: { dt: number };
}

export interface StartGameCommand extends Command {
  type: CommandType.StartGame;
  payload: { mode: number };
}

export interface PauseGameCommand extends Command {
  type: CommandType.PauseGame;
}

export interface ResumeGameCommand extends Command {
  type: CommandType.ResumeGame;
}

export type AnyCommand = MoveCommand | RotateCommand | SoftDropCommand | HardDropCommand | HoldPieceCommand | TickCommand | StartGameCommand | PauseGameCommand | ResumeGameCommand;
