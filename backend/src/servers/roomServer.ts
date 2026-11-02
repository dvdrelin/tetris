/**
 * Room server (MP block B): the authoritative room lifecycle over `/ws`.
 *
 * Scope: room codes, the `lobby → playing → over` state machine, ready/start (seed issuing),
 * room chat, surrender, disconnect grace with token rejoin, per-connection message limits.
 * Deliberately NOT here yet (block D): piece_lock replay validation, garbage/attack pipeline,
 * certified match results — `piece_lock` messages are accumulated (sum of linesCleared) so a
 * surrender verdict has *some* counters until the replay certifies them.
 *
 * Design notes:
 *  - sockets are the structural `ClientSocket`: no `ws` types leak into the logic, and the test
 *    suite drives this class with a fake EventEmitter socket — the same code path runs in prod;
 *  - the clock is injected (`now`), timers use setTimeout so Jest fake timers control them;
 *  - the server never trusts client text: names go through `normalizePlayerName`, chat is
 *    control-stripped and length-capped, payloads are shape-checked before use.
 */
import { randomUUID, randomInt } from 'crypto'
import {
  ClientMsgType, ClientMessage, ServerMessage, ServerMsgType, MpErrorCode,
  RoomPhase, RoomSnapshot, ChatMessagePayload, MatchOverReason, MatchOverDetail, MatchResult,
  PieceLockPayload, PieceType, ConnTestPayload, ConnTestAckPayload, ConnTransportStats, MpErrorPayload,
  ClientInfoPayload, PieceTrace, ClientDiagPayload, PIECE_SHAPES, GAME_CONFIG,
  normalizeRoomCode, normalizePlayerName,
} from '@neon-tetris/shared'
import { RateLimiter } from '../middleware/rate-limit'
import { MP_CONFIG } from '../config/mpConfig'
import { MP_BALANCE } from '../config/mpBalance'
import { BOOT_ID, RUNTIME_VERSION } from '../config/runtime'
import { MatchState } from '../services/matchState'
import { MatchLogStore } from '../services/matchLog'

/** Minimal surface of a `ws` WebSocket used by the room logic (readyState 1 = OPEN). */
export interface ClientSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate(): void
  on(event: 'message', cb: (raw: unknown) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'error', cb: (err: unknown) => void): void
  /**
   * Transport-level counters the `ws` heartbeat maintains on the real socket (the adapter fills
   * them in; the room logic only reads them for `conn_test_ack`).
   */
  transportStats?: ConnTransportStats
}

const WS_OPEN = 1

/** Как часто в лог кладётся полный снимок доски (в отказах — всегда). 10 ≈ 2 снимка на матч. */
const SNAPSHOT_EVERY_LOCKS = 10

interface PlayerSlot {
  id: string
  name: string
  playerIndex: number
  token: string
  ws: ClientSocket | null
  connected: boolean
  ready: boolean
  host: boolean
  graceTimer: ReturnType<typeof setTimeout> | null
  /** Counters accumulated from reported piece_lock messages (certified by the replay in D). */
  reportedLines: number
  /** Which frontend build this seat came from — written into the match log header. */
  client?: ClientInfoPayload
}

interface Room {
  code: string
  phase: RoomPhase
  maxPlayers: number
  /** Index === playerIndex is NOT guaranteed after removals: seats stay stable for seed dealing. */
  players: PlayerSlot[]
  chat: ChatMessagePayload[]
  createdAt: number
}

export interface RoomServerOptions {
  now?: () => number
  graceMs?: number
  /** Match-seed source. Injectable so an integration test can replay a known bag; default: uint32 CSPRNG. */
  seed?: () => number
  /** Where the match-by-match JSONL diagnostics go. Default: a disabled store (tests stay silent). */
  matchLog?: MatchLogStore
}

export class RoomServer {
  private rooms = new Map<string, Room>()
  private socketToPlayer = new Map<ClientSocket, { code: string; playerId: string }>()
  /**
   * Application frames in/out per socket since it connected (with byte totals). Read back in
   * `conn_test_ack` so a player can see what their link actually delivered — the same counters the
   * match logs carry, but live.
   */
  private connCounters = new WeakMap<ClientSocket, { msgsIn: number; msgsOut: number; bytesIn: number; bytesOut: number }>()
  private violations = new Map<ClientSocket, number>()
  private preRoomKeys = new WeakMap<ClientSocket, string>()
  private preRoomSeq = 0
  /** Block D: server-side match simulation per room (verification + garbage scheduler). */
  private matchStates = new Map<string, MatchState>()
  /**
   * Soft resync state per player (playerId): how many resyncs this match already asked for and
   * the forfeit timer armed by the last request. Cleared at match start and at match end.
   */
  private resync = new Map<string, { until: number; timer: ReturnType<typeof setTimeout>; count: number }>()
  private timeLimitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private msgLimiter: RateLimiter
  private chatLimiter: RateLimiter
  private phraseLimiter: RateLimiter
  private readonly now: () => number
  private readonly graceMs: number
  private readonly seedFn: () => number
  /** Per-match JSONL diagnostics (see services/matchLog.ts). */
  private readonly matchLog: MatchLogStore

  constructor(options: RoomServerOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.graceMs = options.graceMs ?? MP_CONFIG.rejoinGraceMs
    this.seedFn = options.seed ?? (() => randomInt(0, 2 ** 32)) // uint32 per GDD §2.2
    this.matchLog = options.matchLog ?? new MatchLogStore({ enabled: false })
    this.msgLimiter = new RateLimiter({
      windowMs: MP_CONFIG.msgWindowMs,
      max: MP_CONFIG.msgMaxPerWindow,
      now: this.now,
    })
    this.chatLimiter = new RateLimiter({
      // Strict cooldown shape: one chat message per chatCooldownMs window per player.
      windowMs: MP_CONFIG.chatCooldownMs,
      max: 1,
      now: this.now,
    })
    this.phraseLimiter = new RateLimiter({
      // GDD fast_phrase_rate_limit_ms: one preset phrase per player per window.
      windowMs: MP_CONFIG.fastPhraseRateLimitMs,
      max: 1,
      now: this.now,
    })
    // Due-garbage sweep. unref(): it must not hold the event loop open in tests or CLI runs.
    setInterval(() => this.sweepGarbage(), MP_CONFIG.garbageSweepMs).unref()
  }

  // ====== observability (health check) ======

  get roomCount(): number {
    return this.rooms.size
  }

  get connectedPlayerCount(): number {
    let n = 0
    for (const room of this.rooms.values()) {
      for (const p of room.players) if (p.connected) n++
    }
    return n
  }

  // ====== connection lifecycle ======

  handleConnection(ws: ClientSocket): void {
    ws.on('message', (raw) => this.onMessage(ws, raw))
    ws.on('close', () => this.onSocketClosed(ws))
    ws.on('error', () => this.onSocketClosed(ws))
  }

  private onMessage(ws: ClientSocket, raw: unknown): void {
    const counters = this.counters(ws)
    counters.msgsIn += 1
    counters.bytesIn += Buffer.byteLength(String(raw ?? ''))

    const limitKey = this.limiterKey(ws)
    if (!this.msgLimiter.check(limitKey).allowed) {
      this.violate(ws, { code: MpErrorCode.RateLimited, message: 'Too many messages' })
      return
    }

    let msg: ClientMessage
    try {
      const parsed = JSON.parse(String(raw))
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
        this.violate(ws, { code: MpErrorCode.BadMessage, message: 'Expected a JSON object with a string type' })
        return
      }
      msg = parsed as ClientMessage
    } catch {
      this.violate(ws, { code: MpErrorCode.BadMessage, message: 'Invalid JSON' })
      return
    }

    switch (msg.type) {
      case ClientMsgType.CreateRoom: this.createRoom(ws, msg.payload); break
      case ClientMsgType.JoinRoom: this.joinRoom(ws, msg.payload); break
      case ClientMsgType.RejoinRoom: this.rejoinRoom(ws, msg.payload); break
      case ClientMsgType.SetReady: this.setReady(ws, msg.payload?.ready); break
      case ClientMsgType.LeaveRoom: this.leaveRoom(ws); break
      case ClientMsgType.Chat: this.chat(ws, msg.payload?.text); break
      case ClientMsgType.FastPhrase: this.fastPhrase(ws, msg.payload?.text); break
      case ClientMsgType.Surrender: this.surrender(ws, msg.payload?.cause); break
      case ClientMsgType.PieceLock: this.pieceLock(ws, msg.payload); break
      case ClientMsgType.Ping: this.pong(ws, msg.payload?.clientTs); break
      case ClientMsgType.ConnTest: this.connTest(ws, msg.payload); break
      default:
        this.violate(ws, { code: MpErrorCode.BadMessage, message: 'Unknown message type' })
    }
  }

  // ====== room commands ======

  private createRoom(ws: ClientSocket, payload: { name?: string; maxPlayers?: number; client?: ClientInfoPayload } | undefined): void {
    if (this.findPlayer(ws)) {
      this.sendError(ws, MpErrorCode.BadPhase, 'Leave the current room first')
      return
    }
    const name = normalizePlayerName(payload?.name)
    const maxPlayers = clampInt(payload?.maxPlayers, MP_CONFIG.defaultMaxPlayers, 2, MP_CONFIG.maxPlayersCap)
    const code = this.generateCode()
    const room: Room = { code, phase: 'lobby', maxPlayers, players: [], chat: [], createdAt: this.now() }
    const slot = this.addPlayer(room, ws, name, true, this.clientStamp(payload?.client))
    this.rooms.set(code, room)
    this.send(ws, {
      type: ServerMsgType.RoomCreated,
      payload: { room: this.snapshot(room), token: slot.token, playerId: slot.id },
    })
  }

  private joinRoom(ws: ClientSocket, payload: { code?: string; name?: string; client?: ClientInfoPayload } | undefined): void {
    if (this.findPlayer(ws)) {
      this.sendError(ws, MpErrorCode.BadPhase, 'Leave the current room first')
      return
    }
    const code = normalizeRoomCode(payload?.code)
    const room = code ? this.rooms.get(code) : undefined
    if (!room) {
      this.sendError(ws, MpErrorCode.RoomNotFound, 'No room with this code')
      return
    }
    // Joining is open in the lobby *and* in the `over` phase. A player whose match ended on a
    // technical forfeit has his seat removed and his socket terminated, so before this the room was
    // closed to him until the host pressed «Готов» — the loser's only way back was to build a new
    // room (that is the PRA4 dead end). In `over` a joiner takes a free seat, sees the results and
    // can press «Готов» himself: `setReady` reopens the lobby for everyone.
    if (room.phase === 'playing') {
      this.sendError(ws, MpErrorCode.BadPhase, 'The match is already running')
      return
    }
    if (room.players.length >= room.maxPlayers) {
      this.sendError(ws, MpErrorCode.RoomFull, 'Room is full')
      return
    }
    const slot = this.addPlayer(room, ws, normalizePlayerName(payload?.name), false, this.clientStamp(payload?.client))
    this.send(ws, {
      type: ServerMsgType.RoomCreated, // joiner gets the same envelope: room + personal token
      payload: { room: this.snapshot(room), token: slot.token, playerId: slot.id },
    })
    this.broadcast(room, ws, { type: ServerMsgType.PlayerJoined, payload: { player: this.ref(slot) } })
    this.broadcastSnapshot(room)
  }

  private rejoinRoom(ws: ClientSocket, payload: { code?: string; token?: string; client?: ClientInfoPayload } | undefined): void {
    if (this.findPlayer(ws)) {
      this.sendError(ws, MpErrorCode.BadPhase, 'Leave the current room first')
      return
    }
    const code = normalizeRoomCode(payload?.code)
    const room = code ? this.rooms.get(code) : undefined
    const slot = room?.players.find((p) => p.token === payload?.token)
    if (!room || !slot) {
      this.sendError(ws, MpErrorCode.BadToken, 'Rejoin token is not valid for this room')
      return
    }
    if (slot.graceTimer) {
      clearTimeout(slot.graceTimer)
      slot.graceTimer = null
    }
    if (slot.ws && slot.ws !== ws) {
      // A live socket already owns this seat: the stale one loses (double connection or hijack try).
      this.socketToPlayer.delete(slot.ws)
      try { slot.ws.terminate() } catch { /* already gone */ }
    }
    const clientPrev = slot.client?.app ?? null
    const stamped = this.clientStamp(payload?.client)
    if (stamped) slot.client = stamped
    slot.ws = ws
    slot.connected = true
    this.socketToPlayer.set(ws, { code: room.code, playerId: slot.id })
    slot.token = randomUUID() // rotate: the old token never works twice
    this.send(ws, {
      type: ServerMsgType.RoomCreated,
      payload: { room: this.snapshot(room), token: slot.token, playerId: slot.id },
    })
    this.broadcastSnapshot(room)
    // Возврат места — обязательно с билдом клиента: «этот ход пришёл из вкладки со старым фронтом»
    // раньше было чем предположить, но не чем ответить.
    this.matchLog.event(room.code, 'seat_rejoined', slot.id, {
      phase: room.phase,
      client: slot.client?.app ?? null,
      clientPrev,
    })
    // Mid-match rejoin: hand over everything the server scheduled against this player while
    // the socket was down — the client reschedules past applyAt arrivals as immediate.
    if (room.phase === 'playing') {
      const state = this.matchStates.get(room.code)
      const arrivals = state ? state.claimAllArrivals(slot.id) : []
      this.matchLog.event(room.code, 'rejoin', slot.id, {
        phase: room.phase,
        pendingGarbage: arrivals.map((a) => ({ applyAt: a.applyAt, rows: a.rows.length, content: a.rows })),
      })
      if (arrivals.length) this.send(ws, { type: ServerMsgType.GarbageArrive, payload: { arrivals } })
    } else {
      this.matchLog.event(room.code, 'rejoin', slot.id, { phase: room.phase })
    }
  }

  private setReady(ws: ClientSocket, ready: unknown): void {
    const ctx = this.requirePlayer(ws)
    if (!ctx) return
    const { room, slot } = ctx
    if (typeof ready !== 'boolean') {
      this.sendError(ws, MpErrorCode.BadRequest, 'ready must be a boolean')
      return
    }
    if (room.phase === 'over') {
      // Rematch flow: the first ready after a match reopens the lobby for everyone.
      this.reopenLobby(room)
    }
    if (room.phase !== 'lobby') {
      this.sendError(ws, MpErrorCode.BadPhase, 'Ready is only possible in the lobby')
      return
    }
    slot.ready = ready
    this.broadcastSnapshot(room)
    this.maybeStart(room)
  }

  private leaveRoom(ws: ClientSocket): void {
    const ctx = this.requirePlayer(ws)
    if (!ctx) return
    const { room, slot } = ctx
    this.matchLog.event(room.code, 'leave_room', slot.id)
    this.socketToPlayer.delete(ws)
    if (room.phase === 'playing') {
      // Walking out mid-match is a forfeit (same verdict as surrender, different reason).
      slot.connected = false
      slot.ws = null
      this.matchOver(room, 'forfeit', this.firstOtherPlayer(room, slot), 'left_room')
      this.finalizeDisconnect(room, slot, 'left')
    } else {
      this.removePlayer(room, slot, 'left')
    }
  }

  private surrender(ws: ClientSocket, cause: unknown): void {
    const ctx = this.requirePlayer(ws)
    if (!ctx) return
    const { room, slot } = ctx
    if (room.phase !== 'playing') {
      this.sendError(ws, MpErrorCode.BadPhase, 'There is no running match to surrender')
      return
    }
    // The cause is not decoration: 'topout' means the stack killed this player (the other seat
    // did not win a mind game, it simply outlived an accident), 'reload' means the board state
    // was lost with the page, and only a bare surrender is a concession.
    const reason: MatchOverReason =
      cause === 'topout' ? 'topout' : cause === 'reload' ? 'forfeit' : 'surrender'
    const detail: MatchOverDetail =
      cause === 'topout' ? 'topout' : cause === 'reload' ? 'reload' : 'surrender_button'
    // What the client *claims* happened (button / topout / reload) is logged verbatim: when a
    // player says "nobody reloaded anything", this line plus socket_closed shows the truth.
    this.matchLog.event(room.code, 'surrender', slot.id, {
      claimedCause: typeof cause === 'string' ? cause : 'button',
      reason,
      detail,
    })
    this.matchOver(room, reason, this.firstOtherPlayer(room, slot), detail)
  }

  private chat(ws: ClientSocket, text: unknown): void {
    const ctx = this.requirePlayer(ws)
    if (!ctx) return
    const { room, slot } = ctx
    if (room.phase === 'playing') {
      this.sendError(ws, MpErrorCode.BadPhase, 'Room chat is disabled during the match')
      return
    }
    if (typeof text !== 'string') {
      this.sendError(ws, MpErrorCode.BadRequest, 'Chat text must be a string')
      return
    }
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MP_CONFIG.chatMaxLen)
    if (!clean) return
    if (!this.chatLimiter.check(slot.id).allowed) {
      this.sendError(ws, MpErrorCode.RateLimited, 'Chat is on cooldown')
      return
    }
    const msg: ChatMessagePayload = { playerId: slot.id, name: slot.name, text: clean, ts: this.now() }
    room.chat.push(msg)
    if (room.chat.length > MP_CONFIG.chatHistorySize) room.chat.splice(0, room.chat.length - MP_CONFIG.chatHistorySize)
    this.broadcast(room, null, { type: ServerMsgType.ChatMessage, payload: msg })
  }

  /**
   * Fast phrases (GDD room.fast_phrase): one-tap sportsmanship during a match. Room chat stays
   * lobby-only by design, so this is a separate ephemeral channel — sanitized, hard rate-limited
   * (fastPhraseRateLimitMs per player), and never stored in chat history.
   */
  private fastPhrase(ws: ClientSocket, text: unknown): void {
    const ctx = this.requirePlayer(ws)
    if (!ctx) return
    const { room, slot } = ctx
    if (typeof text !== 'string') {
      this.sendError(ws, MpErrorCode.BadRequest, 'Phrase text must be a string')
      return
    }
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MP_CONFIG.fastPhraseMaxLen)
    if (!clean) return
    if (!this.phraseLimiter.check(slot.id).allowed) {
      this.sendError(ws, MpErrorCode.RateLimited, 'Fast phrases are on cooldown')
      return
    }
    this.broadcast(room, null, {
      type: ServerMsgType.FastPhrase,
      payload: { playerId: slot.id, name: slot.name, text: clean, ts: this.now() },
    })
  }

  /**
   * piece_lock handling (block D): the server replays the lock through the room's MatchState
   * *before* anyone else sees it — a report that fails verification (bag order, overlap,
   * support, fake clear count, step gap) ends the match per the GDD anticheat rule
   * (disconnect_on_mismatch). Verified locks are relayed (sanitized) to the opponents and
   * schedule garbage against them inside MatchState.
   */
  private pieceLock(ws: ClientSocket, payload: Partial<PieceLockPayload> | undefined): void {
    const ctx = this.requirePlayer(ws)
    if (!ctx) return
    const { room, slot } = ctx
    if (room.phase !== 'playing') {
      this.sendError(ws, MpErrorCode.BadPhase, 'No match is running')
      return
    }
    const { lock, problem } = sanitizeLock(payload)
    if (!lock) {
      const detail = problem ? `${problem.field}=${problem.value}${problem.step !== undefined ? ` (шаг ${problem.step})` : ''}` : 'нет тела'
      // The raw frame goes to the match log next to the reason: this is the only place where an
      // unparseable report can be told apart from a lost one, and it is what the next replay of a
      // "mystery forfeit" is read from.
      const brokenState = this.matchStates.get(room.code)
      this.matchLog.event(room.code, 'malformed_lock', slot.id, {
        ...(problem ?? {}),
        raw: payload === undefined ? 'нет тела' : JSON.stringify(payload).slice(0, 600),
        // Доска на момент сломанного отчёта: по ней видно, разошёлся ли реплей ещё до этого кадра
        // (тогда кадр — следствие, а не причина).
        ...(brokenState ? { digest: brokenState.boardDigest(slot.id), snapshot: brokenState.boardSnapshot(slot.id) } : {}),
      })
      this.violate(ws, {
        code: MpErrorCode.BadRequest,
        message: `Malformed piece_lock payload: ${detail}${problem?.hint ? ` — ${problem.hint}` : ''}`,
        ...(problem ?? {}),
      })
      return
    }
    const state = this.matchStates.get(room.code)
    let appliedGarbage: number[][][] = []
    if (state) {
      const verdict = state.applyLock(slot.id, lock)
      // The lock and the verdict the replay produced travel together — this line *is* the evidence
      // for "why was this legal move rejected", and the input for an offline replay of the match.
      // `digest` (board fingerprint after this lock) is what localizes the first divergence without
      // reading every line; the full `snapshot` is written on a rejection and every Nth lock, so a
      // divergence has a board to compare against right where it starts.
      const rejected = !verdict.accepted
      const extra = (payload ?? {}) as { trace?: PieceTrace; diag?: ClientDiagPayload }
      this.matchLog.event(room.code, 'piece_lock', slot.id, {
        lock,
        accepted: verdict.accepted,
        digest: state.boardDigest(slot.id),
        ...(rejected || lock.globalStep % SNAPSHOT_EVERY_LOCKS === 0 ? { snapshot: state.boardSnapshot(slot.id) } : {}),
        // След фигуры и самочувствие клиента: не влияют на правила, но объясняют, как кадр получился
        // именно таким (каким киком доехал до стены, сколько ходов было в кольце перевыдачи).
        ...(extra.trace ? { trace: extra.trace } : {}),
        ...(extra.diag ? { diag: extra.diag } : {}),
        ...(verdict.accepted ? {} : { violation: verdict.violation }),
      })
      // What the server actually generated against the opponents (and what it ate with counteract):
      // without these lines a replay regenerates garbage from its own RNG stream and drifts, which
      // later reads as "the player lied" — the 5QBH post-mortem.
      for (const s of verdict.accepted ? verdict.scheduled : []) {
        this.matchLog.event(room.code, 'garbage_scheduled', slot.id, { victimId: s.victimId, applyAt: s.applyAt, rows: s.rows })
      }
      for (const c of verdict.accepted ? verdict.cancelled : []) {
        this.matchLog.event(room.code, 'garbage_cancelled', slot.id, { by: c.by, count: c.count, ...(c.rows ? { rows: c.rows } : {}) })
      }
      if (!verdict.accepted) {
        // A forward step gap is a lost report, not a cheat: give the client a chance to
        // retransmit the missing locks (it keeps a ring buffer of them) before the verdict.
        if (verdict.gap && this.requestResync(room, slot, ws, verdict.gap)) return
        console.warn(`[mp] piece_lock violation room=${room.code} player=${slot.name}: ${verdict.violation}`)
        this.sendError(ws, MpErrorCode.InvalidMove, 'Ход отклонён сервером')
        // The verdict travels before the socket dies: a player thrown out of a live match must
        // learn *why* it ended (match_over is what stops their engine and shows the result),
        // not sit in front of a frozen board.
        this.matchOver(room, 'forfeit', this.firstOtherPlayer(room, slot), 'invalid_move')
        this.onSocketClosed(ws)
        this.finalizeDisconnect(room, slot, 'disconnect_timeout')
        try { ws.terminate() } catch { /* already gone */ }
        return
      }
      appliedGarbage = verdict.appliedGarbage
    }
    slot.reportedLines += lock.linesCleared
    // Rows first, then the piece placed on top of them — the shadow board replays in that order.
    if (appliedGarbage.length) {
      this.broadcast(room, ws, {
        type: ServerMsgType.GarbageApplied,
        payload: { playerId: slot.id, groups: appliedGarbage },
      })
    }
    this.broadcast(room, ws, {
      type: ServerMsgType.PieceLockedRelay,
      payload: { playerId: slot.id, lock },
    })
  }

  /**
   * Ask a client whose step counter ran ahead of the server's replay to retransmit the missing
   * locks instead of ending the match as a cheat (the live EX8H case). Returns true when the
   * soft path was taken — the offending lock is simply left unapplied, the client will resend it
   * in order. The forfeit fires only if the retransmission does not restore the sequence in time.
   */
  private requestResync(room: Room, slot: PlayerSlot, ws: ClientSocket, gap: { expectedStep: number; gotStep: number }): boolean {
    const pending = this.resync.get(slot.id)
    if (pending && this.now() <= pending.until) {
      // Already waiting for the retransmission: later out-of-order reports add nothing to log.
      this.matchLog.event(room.code, 'resync_waiting', slot.id, gap)
      return true
    }
    const count = pending?.count ?? 0
    if (count >= MP_CONFIG.resyncMaxPerMatch) return false // patience used up → hard verdict

    const deadline = this.now() + MP_CONFIG.resyncGraceMs
    this.matchLog.event(room.code, 'resync_requested', slot.id, {
      ...gap,
      attempt: count + 1,
      deadline,
      digest: this.matchStates.get(room.code)?.boardDigest(slot.id),
      transport: ws.transportStats ?? null,
    })
    this.send(ws, { type: ServerMsgType.ResyncRequest, payload: { ...gap, deadline } })
    const timer = setTimeout(() => {
      this.resync.delete(slot.id)
      if (room.phase !== 'playing') return
      const state = this.matchStates.get(room.code)
      if (state && state.stepsFor(slot.id) >= gap.gotStep) return // the client caught up in time
      this.matchLog.event(room.code, 'resync_failed', slot.id, { ...gap })
      console.warn(`[mp] resync failed room=${room.code} player=${slot.name}: expected ${gap.expectedStep}, got ${gap.gotStep}`)
      this.sendError(ws, MpErrorCode.InvalidMove, 'Ход отклонён сервером')
      this.matchOver(room, 'forfeit', this.firstOtherPlayer(room, slot), 'invalid_move')
      this.onSocketClosed(ws)
      this.finalizeDisconnect(room, slot, 'disconnect_timeout')
      try { ws.terminate() } catch { /* already gone */ }
    }, MP_CONFIG.resyncGraceMs)
    timer.unref?.()
    this.resync.set(slot.id, { until: deadline, timer, count: count + 1 })
    return true
  }

  private clearResync(room: Room): void {
    for (const p of room.players) {
      const entry = this.resync.get(p.id)
      if (!entry) continue
      clearTimeout(entry.timer)
      this.resync.delete(p.id)
    }
  }

  /**
   * One frame of the room-side link test (`conn_test`): ack it with everything the server knows
   * about this connection — app frames in/out with bytes, plus the `ws` heartbeat's ping counters.
   * The client measures RTT per frame and counts the frames that never come back.
   */
  private connTest(ws: ClientSocket, payload: ConnTestPayload | undefined): void {
    const c = this.counters(ws)
    const ctx = this.socketToPlayer.get(ws)
    const ack: ConnTestAckPayload = {
      seq: typeof payload?.seq === 'number' ? payload.seq : 0,
      clientTs: typeof payload?.clientTs === 'number' ? payload.clientTs : 0,
      serverTs: this.now(),
      playerId: ctx?.playerId ?? null,
      msgsIn: c.msgsIn,
      msgsOut: c.msgsOut,
      bytesIn: c.bytesIn,
      bytesOut: c.bytesOut,
      transport: ws.transportStats ?? { pingsSent: 0, pingsLost: 0, lastPongRttMs: null },
    }
    this.send(ws, { type: ServerMsgType.ConnTestAck, payload: ack })
    // Тест канала живёт только в памяти сокета, а через минуту его уже не восстановить. Пишем в лог
    // матча (реже, чем кадры): «линия была кривая в этот момент» должно читаться по факту.
    if (ctx && (ack.seq === 0 || ack.seq % 4 === 0)) {
      this.matchLog.event(ctx.code, 'conn_test', ctx.playerId, {
        seq: ack.seq,
        msgsIn: ack.msgsIn,
        msgsOut: ack.msgsOut,
        bytesIn: ack.bytesIn,
        bytesOut: ack.bytesOut,
        transport: ack.transport,
      })
    }
  }

  private counters(ws: ClientSocket): { msgsIn: number; msgsOut: number; bytesIn: number; bytesOut: number } {
    let c = this.connCounters.get(ws)
    if (!c) {
      c = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0 }
      this.connCounters.set(ws, c)
    }
    return c
  }

  private pong(ws: ClientSocket, clientTs: unknown): void {
    this.send(ws, {
      type: ServerMsgType.Pong,
      payload: {
        clientTs: typeof clientTs === 'number' ? clientTs : undefined,
        serverTs: this.now(),
      },
    })
  }

  // ====== state machine ======

  private maybeStart(room: Room): void {
    if (room.phase !== 'lobby') return
    if (room.players.length < MP_CONFIG.minPlayersToStart) return
    if (room.players.some((p) => !p.ready || !p.connected)) return

    const seed = this.seedFn() // uint32 per GDD §2.2
    const startTime = this.now() + MP_CONFIG.startDelayMs
    room.phase = 'playing'
    this.matchStates.set(room.code, new MatchState(room.players.map((p) => p.id), seed, this.now))
    this.clearResync(room) // a rematch gets a fresh resync budget
    // One log file per match: the seed and the roster are the header, everything else is events.
    // A rematch opens a new file, so a room's history stays readable.
    this.matchLog.startMatch({
      code: room.code,
      seed,
      startTime,
      players: room.players.map((p) => ({
        playerId: p.id,
        name: p.name,
        playerIndex: p.playerIndex,
        ...(p.client?.app ? { client: p.client.app } : {}),
      })),
      // Правила этого матча записываются рядом с ним: после изменения env сравнивать два матча
      // без этого — гадание.
      config: {
        version: RUNTIME_VERSION,
        boot: BOOT_ID,
        board: { width: GAME_CONFIG.boardWidth, height: GAME_CONFIG.boardHeight },
        mp: { ...MP_CONFIG },
        balance: { ...MP_BALANCE } as Record<string, unknown>,
      },
    })
    // heads_up survival limit: when time is up, the survivor wins; both alive → honest draw.
    // unref(): the timer must not hold the event loop open (tests, graceful shutdown).
    const limitTimer = setTimeout(() => {
      this.timeLimitTimers.delete(room.code)
      if (room.phase !== 'playing') return
      this.matchOver(room, 'survival', this.topScorer(room), 'time_limit')
    }, MP_CONFIG.timeLimitSec * 1000)
    limitTimer.unref?.()
    this.timeLimitTimers.set(room.code, limitTimer)
    for (const p of room.players) {
      this.send(p.ws, {
        type: ServerMsgType.GameStart,
        payload: { seed, startTime, playerIndex: p.playerIndex, league: 'heads_up' },
      })
    }
    this.broadcastSnapshot(room)
  }

  /** Winner by the server-certified line count; exact ties (or zero lines) end in a draw. */
  private topScorer(room: Room): PlayerSlot | null {
    const state = this.matchStates.get(room.code)
    const values = room.players.map((p) => ({ p, lines: state?.certifiedLines(p.id) ?? p.reportedLines }))
    const best = Math.max(...values.map((v) => v.lines))
    if (best <= 0) return null
    const top = values.filter((v) => v.lines === best)
    return top.length === 1 ? top[0].p : null
  }

  /** Periodic sweep: deliver every due garbage arrival to its (still connected) victim. */
  private sweepGarbage(): void {
    const now = this.now()
    for (const [code, state] of this.matchStates) {
      const room = this.rooms.get(code)
      if (!room || room.phase !== 'playing') continue
      for (const p of room.players) {
        if (!p.connected || !p.ws) continue
        const { delivered, cancelled } = state.takeDueArrivals(p.id, now)
        if (delivered.length) {
          // Rows are logged on delivery (not at scheduling) because the replay needs the rows the
          // client was actually told to insert, in the order the client inserts them.
          this.matchLog.event(room.code, 'garbage_delivered', p.id, {
            arrivals: delivered.map((a) => ({ applyAt: a.applyAt, rows: a.rows })),
          })
          this.send(p.ws, { type: ServerMsgType.GarbageArrive, payload: { arrivals: delivered } })
        }
        // Immunity dropped rows are logged for the same reason scheduled rows are: they consumed
        // the match's RNG, and a replay that regenerates garbage from the seed cannot know that.
        for (const c of cancelled) {
          this.matchLog.event(room.code, 'garbage_cancelled', p.id, { by: c.by, count: c.count, rows: c.rows })
        }
      }
    }
  }

  private matchOver(room: Room, reason: MatchOverReason, winner: PlayerSlot | null, detail?: MatchOverDetail): void {
    if (room.phase === 'over') return
    room.phase = 'over'
    const state = this.matchStates.get(room.code)
    this.matchStates.delete(room.code)
    this.clearResync(room)
    const limitTimer = this.timeLimitTimers.get(room.code)
    if (limitTimer) {
      clearTimeout(limitTimer)
      this.timeLimitTimers.delete(room.code)
    }
    const alive = room.players
    const ordered: PlayerSlot[] = winner
      ? [winner, ...alive.filter((p) => p !== winner)]
      : [...alive]
    const results: MatchResult[] = ordered.map((p, i) => ({
      playerId: p.id,
      name: p.name,
      placement: i + 1,
      // Lines are the server-certified clear counts from the replay (block D); score stays 0
      // until a full engine replay certifies scoring — an honest zero beats a reported guess.
      score: 0,
      lines: state?.certifiedLines(p.id) ?? p.reportedLines,
    }))
    this.matchLog.event(room.code, 'match_over', winner?.id, { reason, detail, winnerId: winner?.id ?? null, results })
    this.matchLog.close(room.code, { reason, detail, winnerId: winner?.id ?? null })
    for (const p of alive) {
      // `detail` rides to both seats: each of them renders its own point of view of the same event.
      this.send(p.ws, { type: ServerMsgType.MatchOver, payload: { reason, detail, winnerId: winner?.id ?? null, results } })
    }
    this.broadcastSnapshot(room)
  }

  private reopenLobby(room: Room): void {
    room.phase = 'lobby'
    for (const p of room.players) {
      p.ready = false
      p.reportedLines = 0
    }
  }

  // ====== disconnect / grace ======

  private onSocketClosed(ws: ClientSocket): void {
    this.violations.delete(ws)
    const ctx = this.socketToPlayer.get(ws)
    if (!ctx) return
    this.socketToPlayer.delete(ws)
    const room = this.rooms.get(ctx.code)
    const slot = room?.players.find((p) => p.id === ctx.playerId)
    // Every socket that was mapped to a seat leaves a line — even a stale one, and even after the
    // match already ended. The moment the connection died is the evidence in a dispute like
    // "nobody reloaded the page": a drop at :12 and a surrender claiming 'reload' at :40 are two
    // different stories in the log.
    const ownsSeat = slot ? slot.ws === ws : false
    this.matchLog.event(ctx.code, 'socket_closed', ctx.playerId, {
      phase: room?.phase ?? 'unknown',
      stale: !ownsSeat,
      seat: slot?.playerIndex ?? null,
      name: slot?.name ?? null,
      graceUntil: ownsSeat && room?.phase === 'playing' && this.graceMs > 0 ? this.now() + this.graceMs : null,
      // Транспортные счётчики `ws` на момент разрыва: «канал был дерганым» перестаёт быть словами.
      transport: ws.transportStats ?? null,
    })
    if (!room || !slot || !ownsSeat) return

    slot.ws = null
    slot.connected = false
    this.broadcastSnapshot(room)

    if (room.phase === 'playing') {
      // Mid-match the versus screen has no roster to show this in, and silence is indistinguishable
      // from "the opponent is hiding". Say it the moment the socket drops, with the deadline a
      // return still counts against — the survivor then knows what they are waiting for.
      this.broadcast(room, ws, {
        type: ServerMsgType.OpponentDropped,
        payload: {
          playerId: slot.id,
          name: slot.name,
          returnBy: this.graceMs > 0 ? this.now() + this.graceMs : null,
        },
      })
    }

    if (this.graceMs <= 0) {
      this.finalizeDisconnect(room, slot, 'disconnect_timeout')
      return
    }
    slot.graceTimer = setTimeout(() => {
      slot.graceTimer = null
      if (!slot.connected) this.finalizeDisconnect(room, slot, 'disconnect_timeout')
    }, this.graceMs)
  }

  private finalizeDisconnect(room: Room, slot: PlayerSlot, reason: 'left' | 'disconnect_timeout'): void {
    this.matchLog.event(room.code, reason === 'left' ? 'seat_removed_left' : 'grace_expired', slot.id, {
      // Кто именно ушёл и почему: в PRA4 по логу нельзя было понять, какое место сняли и можно ли
      // в эту комнату было вернуться.
      seat: slot.playerIndex,
      name: slot.name,
      reason,
      phase: room.phase,
    })
    if (room.phase === 'playing') {
      // GDD: a disconnected player freezes out of the match — the others play on. In a 1v1 the
      // remaining player wins by forfeit; with more seats the verdict stays honest this way too.
      const opponent = this.firstOtherPlayer(room, slot)
      // Reaching this line means the grace ran out (a walk-out already closed the match above).
      this.matchOver(room, 'forfeit', opponent, reason === 'left' ? 'left_room' : 'disconnect')
    }
    this.removePlayer(room, slot, reason)
  }

  private removePlayer(room: Room, slot: PlayerSlot, reason: 'left' | 'disconnect_timeout'): void {
    const at = room.players.indexOf(slot)
    if (at >= 0) room.players.splice(at, 1)
    if (slot.graceTimer) {
      clearTimeout(slot.graceTimer)
      slot.graceTimer = null
    }
    // Host handover: the earliest remaining player inherits the host flag.
    if (slot.host && room.players.length > 0 && !room.players.some((p) => p.host)) {
      room.players[0].host = true
    }
    this.broadcast(room, null, {
      type: ServerMsgType.PlayerLeft,
      payload: { playerId: slot.id, name: slot.name, reason },
    })
    if (room.players.length === 0) this.rooms.delete(room.code)
    else this.broadcastSnapshot(room)
  }

  // ====== helpers ======

  /**
   * Client-supplied build stamp: never trusted, never allowed to bloat a log line. Control chars and
   * over-long strings are what a hostile or broken client sends; the value only ever goes to the log.
   */
  private clientStamp(client: ClientInfoPayload | undefined): ClientInfoPayload | undefined {
    const raw = typeof client?.app === 'string' ? client.app : ''
    const clean = raw.replace(/[^\x21-\x7e]/g, '').slice(0, 40)
    return clean ? { app: clean } : undefined
  }

  private addPlayer(room: Room, ws: ClientSocket, name: string, host: boolean, client?: ClientInfoPayload): PlayerSlot {
    const nextIndex = room.players.reduce((m, p) => Math.max(m, p.playerIndex), -1) + 1
    const slot: PlayerSlot = {
      id: randomUUID(),
      name,
      playerIndex: nextIndex,
      token: randomUUID(),
      ws,
      connected: true,
      ready: false,
      host,
      graceTimer: null,
      reportedLines: 0,
      ...(client?.app ? { client: { app: client.app } } : {}),
    }
    room.players.push(slot)
    this.socketToPlayer.set(ws, { code: room.code, playerId: slot.id })
    return slot
  }

  /** Side-effect-free lookup: for the "already in a room" guards (no error is emitted here). */
  private findPlayer(ws: ClientSocket): { room: Room; slot: PlayerSlot } | null {
    const ctx = this.socketToPlayer.get(ws)
    if (!ctx) return null
    const room = this.rooms.get(ctx.code)
    const slot = room?.players.find((p) => p.id === ctx.playerId)
    return room && slot ? { room, slot } : null
  }

  private requirePlayer(ws: ClientSocket): { room: Room; slot: PlayerSlot } | null {
    const ctx = this.socketToPlayer.get(ws)
    if (!ctx) {
      this.sendError(ws, MpErrorCode.NotInRoom, 'Not in a room')
      return null
    }
    const room = this.rooms.get(ctx.code)
    const slot = room?.players.find((p) => p.id === ctx.playerId)
    if (!room || !slot) {
      this.socketToPlayer.delete(ws)
      this.sendError(ws, MpErrorCode.NotInRoom, 'Not in a room')
      return null
    }
    return { room, slot }
  }

  private firstOtherPlayer(room: Room, slot: PlayerSlot): PlayerSlot | null {
    return room.players.find((p) => p !== slot && p.connected) ?? room.players.find((p) => p !== slot) ?? null
  }

  private ref(slot: PlayerSlot) {
    return { id: slot.id, name: slot.name, host: slot.host, ready: slot.ready, connected: slot.connected, playerIndex: slot.playerIndex }
  }

  private snapshot(room: Room): RoomSnapshot {
    return {
      code: room.code,
      phase: room.phase,
      maxPlayers: room.maxPlayers,
      players: room.players.map((p) => this.ref(p)),
      chat: [...room.chat],
    }
  }

  private broadcastSnapshot(room: Room): void {
    this.broadcast(room, null, { type: ServerMsgType.RoomSnapshot, payload: { room: this.snapshot(room) } })
  }

  /** Send to every connected player of the room; `except` may be null. */
  private broadcast(room: Room, except: ClientSocket | null, msg: ServerMessage): void {
    for (const p of room.players) {
      if (p.connected && p.ws && p.ws !== except) this.send(p.ws, msg)
    }
  }

  private send(ws: ClientSocket | null, msg: ServerMessage): void {
    if (!ws || ws.readyState !== WS_OPEN) return
    const data = JSON.stringify(msg)
    const counters = this.counters(ws)
    counters.msgsOut += 1
    counters.bytesOut += Buffer.byteLength(data)
    ws.send(data)
  }

  private sendError(ws: ClientSocket, code: MpErrorCode, message: string): void {
    this.send(ws, { type: ServerMsgType.Error, payload: { code, message } })
  }

  /** Protocol abuse: answer once, count, and drop the socket when the client keeps misbehaving. */
  private violate(ws: ClientSocket, error: MpErrorPayload): void {
    const ctx = this.socketToPlayer.get(ws)
    // Until now a protocol violation left no trace at all — the EX8H hunt had to guess that a
    // malformed report was even possible. A malformed `piece_lock` returns before the lock event,
    // so without this line the match log shows a step hole with no explanation.
    const n = (this.violations.get(ws) ?? 0) + 1
    this.violations.set(ws, n)
    console.warn(`[mp] protocol violation ${error.code}: ${error.message}${ctx ? ` room=${ctx.code} player=${ctx.playerId.slice(0, 8)}` : ''} (#${n})`)
    if (ctx) this.matchLog.event(ctx.code, 'protocol_violation', ctx.playerId, { code: error.code, message: error.message, violations: n })
    this.send(ws, { type: ServerMsgType.Error, payload: error })
    if (n >= MP_CONFIG.maxViolations) {
      this.onSocketClosed(ws)
      try { ws.terminate() } catch { /* already gone */ }
    }
  }

  private limiterKey(ws: ClientSocket): string {
    const ctx = this.socketToPlayer.get(ws)
    if (ctx) return `p:${ctx.playerId}`
    let key = this.preRoomKeys.get(ws)
    if (!key) {
      key = `s:${++this.preRoomSeq}`
      this.preRoomKeys.set(ws, key)
    }
    return key
  }

  private generateCode(): string {
    const { roomCodeAlphabet: alphabet, roomCodeLen: len } = MP_CONFIG
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = ''
      for (let i = 0; i < len; i++) {
        code += alphabet[randomInt(0, alphabet.length)]
      }
      if (!this.rooms.has(code)) return code
    }
    // Practically unreachable (millions of codes): fail loudly rather than collide silently.
    throw new Error('room code space exhausted')
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

const PIECE_TYPE_SET = new Set<string>(['I', 'O', 'T', 'S', 'Z', 'J', 'L'])

/** Shape-checks a reported lock and rebuilds a clean payload (never relay the raw object). */
/** The first field of a `piece_lock` report that failed the shape check, and what it carried. */
interface LockProblem {
  field: string
  value: string
  step?: number
  /** How the value was expected to look — turns "malformed" into something a maintainer can act on. */
  hint?: string
}

/**
 * Legal *origin* range for a piece in a given rotation, derived from the occupied cells rather than
 * from the bounding box. SRS keeps the box fixed (JLSTZ 3×3, I 4×4, O 2×2), so several rotations
 * have empty leading/trailing columns: a T in r1 occupies columns 1..2, hence `x = -1` puts its
 * cells at columns 0..1 — a perfectly legal placement that the previous fixed guard (`x ≥ 0`)
 * rejected as "malformed", and that is exactly how 5QBH lost a match it had not cheated in.
 * Geometry itself (out of bounds, overlap, support, bag order) stays the replay's job.
 */
export function originRange(pieceType: PieceType, rotation: number): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const shape = PIECE_SHAPES[pieceType]?.[rotation]
  if (!shape) return null
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = -1
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = -1
  for (const [rowIdx, row] of shape.entries()) {
    for (const [colIdx, cell] of row.entries()) {
      if (!cell) continue
      if (colIdx < minCol) minCol = colIdx
      if (colIdx > maxCol) maxCol = colIdx
      if (rowIdx < minRow) minRow = rowIdx
      if (rowIdx > maxRow) maxRow = rowIdx
    }
  }
  if (maxCol < 0) return null
  return {
    minX: -minCol,
    maxX: GAME_CONFIG.boardWidth - 1 - maxCol,
    minY: -minRow,
    maxY: GAME_CONFIG.boardHeight - 1 - maxRow,
  }
}

/**
 * Shape check for an inbound `piece_lock`. Returns the clean lock, or the first offending field
 * with the value it carried: a rejected report and a lost report look identical in the log unless
 * we say *why* it was rejected — that missing answer is what made PRA4 (and before it EX8H)
 * unanswerable. The reason travels to the client too, so a player can tell us about it.
 */
export function sanitizeLock(payload: Partial<PieceLockPayload> | undefined): { lock: PieceLockPayload | null; problem?: LockProblem } {
  const show = (v: unknown): string => {
    if (v === undefined) return 'нет поля'
    if (v === null) return 'null'
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return `${v}`
    return Array.isArray(v) ? 'array' : typeof v
  }
  const rawStep = typeof payload?.globalStep === 'number' ? payload.globalStep : undefined
  const bad = (field: string, value: unknown, hint?: string): { lock: null; problem: LockProblem } =>
    ({ lock: null, problem: { field, value: show(value), ...(rawStep !== undefined ? { step: rawStep } : {}), ...(hint ? { hint } : {}) } })

  if (!payload || typeof payload !== 'object') return bad('payload', payload)
  const { globalStep, pieceType, x, y, rotation, linesCleared, nextType, garbageRows } = payload
  if (!Number.isInteger(globalStep) || (globalStep as number) < 1) return bad('globalStep', globalStep)
  if (typeof pieceType !== 'string' || !PIECE_TYPE_SET.has(pieceType)) return bad('pieceType', pieceType)
  if (!Number.isInteger(rotation) || (rotation as number) < 0 || (rotation as number) > 3) return bad('rotation', rotation)
  // Position: a shape check, not a geometry authority. The bounds come from the piece's occupied
  // cells (see `originRange`); a fixed `0 ≤ x ≤ 12` used to reject honest reports — 5QBH, `T r1 x=-1`.
  const where = originRange(pieceType as PieceType, rotation as number)
  if (!where) return bad('rotation', rotation, `для ${pieceType} нет такой формы`)
  if (!Number.isInteger(x)) return bad('x', x, `ожидалось целое ${where.minX}..${where.maxX} для ${pieceType} r${rotation}`)
  if ((x as number) < where.minX || (x as number) > where.maxX) {
    return bad('x', x, `для ${pieceType} r${rotation} origin x допустим ${where.minX}..${where.maxX} (клетки должны остаться в поле ${GAME_CONFIG.boardWidth})`)
  }
  if (!Number.isInteger(y)) return bad('y', y, `ожидалось целое ${where.minY}..${where.maxY} для ${pieceType} r${rotation}`)
  if ((y as number) < where.minY || (y as number) > where.maxY) {
    return bad('y', y, `для ${pieceType} r${rotation} origin y допустим ${where.minY}..${where.maxY} (поле ${GAME_CONFIG.boardHeight} рядов)`)
  }
  if (!Number.isInteger(linesCleared) || (linesCleared as number) < 0 || (linesCleared as number) > 4) return bad('linesCleared', linesCleared)
  if (nextType !== undefined && (typeof nextType !== 'string' || !PIECE_TYPE_SET.has(nextType))) return bad('nextType', nextType)
  // Garbage counter: a bounded monotonic integer. MatchState clamps it to rows it actually handed
  // out, so an inflated number cannot buy a cheater anything — a negative or fractional one can.
  if (garbageRows !== undefined && (!Number.isInteger(garbageRows) || (garbageRows as number) < 0 || (garbageRows as number) > 4096)) return bad('garbageRows', garbageRows)
  const clean: PieceLockPayload = {
    globalStep: globalStep as number,
    pieceType: pieceType as PieceType,
    x: x as number,
    y: y as number,
    rotation: rotation as number,
    linesCleared: linesCleared as number,
  }
  if (nextType !== undefined) clean.nextType = nextType as PieceType
  if (garbageRows !== undefined) clean.garbageRows = garbageRows as number
  if (payload.holdExtra === true) clean.holdExtra = true
  return { lock: clean }
}
