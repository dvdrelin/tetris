export enum QueryType {
  GetGameState = 'GetGameState',
  GetNextPiece = 'GetNextPiece',
  GetBoardState = 'GetBoardState',
  GetGhost = 'GetGhost',
}

export interface Query {
  type: QueryType;
  payload?: unknown;
}

export interface GameStateQuery extends Query {
  type: QueryType.GetGameState;
}

export interface NextPieceQuery extends Query {
  type: QueryType.GetNextPiece;
}

export interface BoardStateQuery extends Query {
  type: QueryType.GetBoardState;
}

export interface GhostQuery extends Query {
  type: QueryType.GetGhost;
}

export type AnyQuery = GameStateQuery | NextPieceQuery | BoardStateQuery | GhostQuery;
