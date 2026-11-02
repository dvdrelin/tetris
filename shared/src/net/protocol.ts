// Multiplayer wire protocol (MP block B). Discriminated unions shared by backend and frontend:
// both sides get compile-time exhaustiveness over the same vocabulary. The event names follow
// GDD §2.3 (game_start / piece_lock / game_over...) extended with the MVP room lifecycle
// (create/join/rejoin/ready/chat/surrender) — this supersedes the seven-type sketch in
// docs/PHASE3_MULTIPLAYER.md.
import { PieceType } from '../domain/types';

// ===== Client → Server =====

export enum ClientMsgType {
  CreateRoom = 'create_room',
  JoinRoom = 'join_room',
  RejoinRoom = 'rejoin_room',
  SetReady = 'set_ready',
  LeaveRoom = 'leave_room',
  Chat = 'chat',
  Surrender = 'surrender',
  PieceLock = 'piece_lock', // handled (validated) from block D; the server accepts it once playing
  Ping = 'ping',            // app-level keepalive + clock offset (browser WS has no protocol ping)
}

export interface CreateRoomPayload {
  name: string;
  /** MVP heads-up is 1v1; 2 keeps the door open for 4-player rooms later (GDD §3). */
  maxPlayers?: number;
}

export interface JoinRoomPayload {
  /** Room code as shown to the host (case-insensitive on the wire, normalized by the server). */
  code: string;
  name: string;
}

export interface RejoinRoomPayload {
  code: string;
  /** Rejoin token issued on the original join (block C stores it for reconnects). */
  token: string;
}

export interface SetReadyPayload {
  ready: boolean;
}

export interface ChatPayload {
  text: string;
}

export interface SurrenderPayload {
  // No fields: the socket identifies the player. (payload stays for envelope uniformity)
}

// Mirrors PieceLockInfo from the engine: what the client's engine observed at the lock.
// The server's replay (block D) compares its own onPieceLocked payload against this.
export interface PieceLockPayload {
  globalStep: number;
  pieceType: PieceType;
  x: number;
  y: number;
  rotation: number;
  linesCleared: number;
  /** Visual-only: the piece this player will spawn next (opponent panels). Never affects rules. */
  nextType?: PieceType;
  /**
   * Hold accounting for the server replay: this step the player hit hold while the hold slot
   * was EMPTY — the engine pulled one extra bag piece to keep the hand filled, so the server
   * must consume one extra pull from its seeded bag. (Swaps with a filled slot need no flag:
   * the locked piece then equals the server's remembered `held` piece.)
   */
  holdExtra?: boolean;
}

export interface PingPayload {
  /** Client clock reading echoed back in `pong` so the client can estimate RTT and offset. */
  clientTs?: number;
}

export type ClientMessage =
  | { type: ClientMsgType.CreateRoom; payload?: CreateRoomPayload }
  | { type: ClientMsgType.JoinRoom; payload: JoinRoomPayload }
  | { type: ClientMsgType.RejoinRoom; payload: RejoinRoomPayload }
  | { type: ClientMsgType.SetReady; payload: SetReadyPayload }
  | { type: ClientMsgType.LeaveRoom; payload?: Record<string, never> }
  | { type: ClientMsgType.Chat; payload: ChatPayload }
  | { type: ClientMsgType.Surrender; payload?: Record<string, never> }
  | { type: ClientMsgType.PieceLock; payload: PieceLockPayload }
  | { type: ClientMsgType.Ping; payload?: PingPayload };

// ===== Server → Client =====

export enum ServerMsgType {
  RoomCreated = 'room_created',
  RoomSnapshot = 'room_snapshot', // full authoritative room state; sent on join and after roster/phase changes
  PlayerJoined = 'player_joined',
  PlayerLeft = 'player_left',
  ChatMessage = 'chat_message',
  GameStart = 'game_start', // per-recipient: the shared seed + this player's index
  PieceLockedRelay = 'piece_locked', // one player's lock forwarded to the opponents (shadow boards)
  GarbageArrive = 'garbage_arrive', // server-scheduled attack rows against this player
  MatchOver = 'match_over',
  Pong = 'pong',
  Error = 'error',
}

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface RoomPlayerRef {
  id: string;
  name: string;
  host: boolean;
  ready: boolean;
  connected: boolean;
  /** Seat assigned at join (0-based); stable for the life of the room. */
  playerIndex: number;
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  maxPlayers: number;
  players: RoomPlayerRef[];
  /** Last ~20 room-chat messages, oldest first (a late joiner sees context). */
  chat: ChatMessagePayload[];
}

export interface RoomCreatedPayload {
  room: RoomSnapshot;
  /** Rejoin token, issued to this socket only (never broadcast). */
  token: string;
  /** The joiner's own player id — the client cannot derive it from the snapshot. */
  playerId: string;
}

export interface RoomSnapshotPayload {
  room: RoomSnapshot;
}

export interface PlayerJoinedPayload {
  player: RoomPlayerRef;
}

export type PlayerLeftReason = 'left' | 'disconnect_timeout';

export interface PlayerLeftPayload {
  playerId: string;
  name: string;
  reason: PlayerLeftReason;
}

export interface ChatMessagePayload {
  playerId: string;
  name: string;
  text: string;
  ts: number;
}

export interface GameStartPayload {
  /** uint32, GDD §2.2 — every seat runs the same seeded 7-bag from this number. */
  seed: number;
  /** Wall-clock ms when the round must start; clients align their tick clocks to it. */
  startTime: number;
  playerIndex: number; // recipient-specific
  league: 'heads_up';
}

export type MatchOverReason = 'surrender' | 'forfeit' | 'survival' | 'points';

// One player's lock, relayed to the opponents so they can draw a shadow board: the receiver
// replays the placement (pieceType+rotation at x/y, then line clears) on a local BoardManager.
export interface PlayerPieceLockPayload {
  playerId: string;
  lock: PieceLockPayload;
}

// Garbage the server scheduled against a player. `arrivals` is a batch so a mid-match rejoin
// gets the full pending queue in one message (applyAt in the past = apply immediately).
export interface GarbageArrival {
  rows: number[][]; // bottom-to-top, 0 = hole, 1..7 = colored garbage cells
  applyAt: number; // server-clock ms; the client inserts when its synced clock reaches it
}
export interface GarbageArrivePayload {
  arrivals: GarbageArrival[];
}

export interface MatchResult {
  playerId: string;
  name: string;
  /** Winner first, then by placement. */
  placement: number;
  /** Engine counters reported at `piece_lock` time until block D certifies them. */
  score: number;
  lines: number;
}

export interface MatchOverPayload {
  reason: MatchOverReason;
  winnerId: string | null;
  results: MatchResult[];
}

export interface PongPayload {
  clientTs?: number;
  serverTs: number;
}

export enum MpErrorCode {
  BadRequest = 'bad_request',
  BadName = 'bad_name',
  RoomNotFound = 'room_not_found',
  BadToken = 'bad_token',
  RoomFull = 'room_full',
  BadPhase = 'bad_phase',
  NotInRoom = 'not_in_room',
  BadMessage = 'bad_message', // unknown type / malformed payload
  RateLimited = 'rate_limited',
  InvalidMove = 'invalid_move', // piece_lock failed the server replay (anticheat: mismatch → drop)
}

export interface MpErrorPayload {
  code: MpErrorCode;
  message: string;
}

export type ServerMessage =
  | { type: ServerMsgType.RoomCreated; payload: RoomCreatedPayload }
  | { type: ServerMsgType.RoomSnapshot; payload: RoomSnapshotPayload }
  | { type: ServerMsgType.PlayerJoined; payload: PlayerJoinedPayload }
  | { type: ServerMsgType.PlayerLeft; payload: PlayerLeftPayload }
  | { type: ServerMsgType.ChatMessage; payload: ChatMessagePayload }
  | { type: ServerMsgType.GameStart; payload: GameStartPayload }
  | { type: ServerMsgType.PieceLockedRelay; payload: PlayerPieceLockPayload }
  | { type: ServerMsgType.GarbageArrive; payload: GarbageArrivePayload }
  | { type: ServerMsgType.MatchOver; payload: MatchOverPayload }
  | { type: ServerMsgType.Pong; payload: PongPayload }
  | { type: ServerMsgType.Error; payload: MpErrorPayload };

/** Interval an MP client should send app-level `ping` at (server answers `pong`). */
export const MP_CLIENT_PING_MS = 25_000;
/** Server transport heartbeat: ws-level ping every 30 s (README pattern of `ws`). */
export const MP_WS_TRANSPORT_PING_MS = 30_000;

/** Normalizes a wire room code: trims, uppercases, strips separators (`ab-12` → `AB12`). */
export function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[\s\-_]/g, '');
}
