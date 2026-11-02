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
  FastPhrase = 'fast_phrase',
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
  /**
   * Why this client ended its own side of the match. The server turns it into the `match_over`
   * reason, so the *other* seat learns what actually happened instead of guessing:
   *  - 'button': the player pressed «Сдаться»;
   *  - 'topout': the local engine died (block-out / garbage pushed the stack off the top);
   *  - 'reload': the page reloaded mid-match and the local board state is gone for good.
   */
  cause?: 'button' | 'topout' | 'reload';
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
  /**
   * How many garbage rows this player has already inserted into their own board since the match
   * started (monotonic counter). The server *schedules* garbage but cannot see which arrivals the
   * client actually absorbed; without this counter the replay board is missing rows the real
   * board has, and every honest lock resting on that garbage then fails the support/line checks.
   * The server applies exactly this many of the arrivals it had handed out, in FIFO order.
   */
  garbageRows?: number;
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
  | { type: ClientMsgType.FastPhrase; payload: FastPhrasePayload }
  | { type: ClientMsgType.Surrender; payload?: SurrenderPayload }
  | { type: ClientMsgType.PieceLock; payload: PieceLockPayload }
  | { type: ClientMsgType.Ping; payload?: PingPayload };

// ===== Server → Client =====

export enum ServerMsgType {
  RoomCreated = 'room_created',
  RoomSnapshot = 'room_snapshot', // full authoritative room state; sent on join and after roster/phase changes
  PlayerJoined = 'player_joined',
  PlayerLeft = 'player_left',
  ChatMessage = 'chat_message',
  FastPhrase = 'fast_phrase', // one-tap sportsmanship during a match (GDD room.fast_phrase) — ephemeral, not chat history
  GameStart = 'game_start', // per-recipient: the shared seed + this player's index
  PieceLockedRelay = 'piece_locked', // one player's lock forwarded to the opponents (shadow boards)
  GarbageApplied = 'garbage_applied', // rows a player just absorbed — keeps the shadow boards honest
  GarbageArrive = 'garbage_arrive', // server-scheduled attack rows against this player
  OpponentDropped = 'opponent_dropped', // a seat lost its socket mid-match; the seat is held for a rejoin
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

/**
 * Client side: one preset sportsmanship phrase during a match (GDD room.fast_phrase). The
 * presets are a client UX concern; the server sanitizes, rate-limits (one per player per
 * fastPhraseRateLimitMs) and broadcasts — phrases never enter chat history.
 */
export interface FastPhrasePayload {
  text: string;
}

/** Server side: who said it, stamped by the server clock. */
export interface FastPhraseReceived {
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

export type MatchOverReason = 'surrender' | 'forfeit' | 'survival' | 'points' | 'topout';

/**
 * What actually happened behind the rule verdict. `reason` says how the rules scored it (who
 * wins); `detail` says what one of the humans did — the result screen needs it to tell the
 * winner "your opponent reloaded the page" instead of the shrug "surrendered or left", and to
 * say which seat the server's replay threw out.
 */
export type MatchOverDetail =
  | 'surrender_button' // someone pressed «Сдаться»
  | 'reload' // a seat lost its board to a page reload (an honest technical forfeit)
  | 'left_room' // a seat pressed «Выход» / left the room while the match was running
  | 'disconnect' // a seat dropped the socket and did not return within the grace
  | 'invalid_move' // the server's replay rejected a seat's move (anticheat)
  | 'topout' // a stack reached the top and killed its owner
  | 'time_limit'; // the match clock ran out

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

/**
 * Garbage a player has just absorbed, relayed to the opponents so their shadow boards show the
 * same stack the real board has. `groups` are the arrival row-sets in the order the player
 * inserted them (each group bottom-to-top, same encoding as `GarbageArrival.rows`). The relay
 * goes out *before* the `piece_locked` of the same report: rows first, then the piece placement.
 */
export interface GarbageAppliedPayload {
  playerId: string;
  groups: number[][][];
}

/**
 * A seat lost its socket while a match was running. Sent immediately (not only when the rejoin
 * grace expires) so the players still in the match know why the opponent stopped moving, and
 * until when a return still counts as a return. `returnBy` is a server-clock deadline.
 */
export interface OpponentDroppedPayload {
  playerId: string;
  name: string;
  returnBy: number | null;
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
  /** Optional so an older server still parses on a newer client (and vice versa). */
  detail?: MatchOverDetail;
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
  | { type: ServerMsgType.FastPhrase; payload: FastPhraseReceived }
  | { type: ServerMsgType.GameStart; payload: GameStartPayload }
  | { type: ServerMsgType.PieceLockedRelay; payload: PlayerPieceLockPayload }
  | { type: ServerMsgType.GarbageArrive; payload: GarbageArrivePayload }
  | { type: ServerMsgType.GarbageApplied; payload: GarbageAppliedPayload }
  | { type: ServerMsgType.OpponentDropped; payload: OpponentDroppedPayload }
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
