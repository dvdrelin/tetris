export enum CommandType {
  StartGame = 'StartGame',
  MovePiece = 'MovePiece',
  RotatePiece = 'RotatePiece',
  SoftDrop = 'SoftDrop',
  HardDrop = 'HardDrop',
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
  payload: { direction: string };
}

export interface RotateCommand extends Command {
  type: CommandType.RotatePiece;
  payload: { direction: 'cw' | 'ccw' };
}

export interface SoftDropCommand extends Command {
  type: CommandType.SoftDrop;
}

export interface HardDropCommand extends Command {
  type: CommandType.HardDrop;
}

export interface TickCommand extends Command {
  type: CommandType.Tick;
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

export type AnyCommand = MoveCommand | RotateCommand | SoftDropCommand | HardDropCommand | TickCommand | StartGameCommand | PauseGameCommand | ResumeGameCommand;
