// MP block C — the frontend room client. One WebSocket for the room lifecycle, one seeded
// GameEngine for the local match, and shadow boards rebuilt from relayed piece_lock messages.
// The protocol contract is shared (`@neon-tetris/shared`), so this file and the server cannot
// drift apart silently — tsc checks both sides of every message.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  ClientMsgType, ServerMsgType, MpErrorCode, ClientMessage, RoomSnapshot, RoomPlayerRef, GameStartPayload,
  MatchOverPayload, PlayerPieceLockPayload, ChatMessagePayload, FastPhraseReceived, ServerMessage, MpErrorPayload,
  MP_CLIENT_PING_MS, normalizeRoomCode,
  PieceType, PIECE_SHAPES, buildPiece, BoardManager, GameEngine,
  GarbageAppliedPayload, OpponentDroppedPayload, SurrenderPayload,
} from '@neon-tetris/shared'
import { GameMode, GameOverReason } from '@neon-tetris/shared/domain/types'
import { AnyCommand, CommandType } from '@neon-tetris/shared/cqrs/commands'
import { GAME_CONFIG } from '@neon-tetris/shared/config/game-config'
import { GameStateDTO, CellStyle, CELL_COLORS } from './gameStore'

const BOARD_WIDTH = GAME_CONFIG.boardWidth
const BOARD_HEIGHT = GAME_CONFIG.boardHeight

const TOKEN_KEY = 'nt_mp_rejoin'
const MATCH_KEY = 'nt_mp_match'

interface StoredToken { code: string; token: string }
interface StoredMatch { seed: number; startTime: number; playerIndex: number; code: string }

export interface ShadowBoard {
  board: number[][]
  nextType: PieceType | null
  linesCleared: number
  locks: number
  // Locks arrived while our socket was down — the picture lags; block D's step-gap fill fixes it.
  stale: boolean
}

function emptyGameState(): GameStateDTO {
  return {
    board: Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0)),
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    currentPiece: null,
    currentPos: null,
    currentRotation: null,
    nextQueue: [],
    holdType: null,
    canHold: true,
    score: 0,
    level: 1,
    linesCleared: 0,
    combo: 0,
    isRunning: false,
    isPaused: false,
    isGameOver: false,
    mode: GameMode.Arcade,
    overReason: null,
    ghostY: -1,
  }
}

const readJson = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export const useMultiplayerStore = defineStore('multiplayer', () => {
  // ====== reactive room state ======
  const connected = ref(false)
  const room = ref<RoomSnapshot | null>(null)
  const myId = ref<string | null>(null)
  const lastError = ref<MpErrorPayload | null>(null)
  const lastEvent = ref<string | null>(null) // human line for toasts ("Гость вышел")
  const match = ref<GameStartPayload | null>(null)
  const matchOverInfo = ref<MatchOverPayload | null>(null)
  const lastPhrase = ref<FastPhraseReceived | null>(null) // fast-phrase toast, server-stamped
  // A seat lost its socket mid-match: who, and until when the server still counts a return.
  // The versus screen turns this into a banner — without it a crashed opponent looks like a
  // player who simply stopped moving.
  const dropNotice = ref<OpponentDroppedPayload | null>(null)
  // Why *this* client ended the match ('button' | 'topout' | 'reload'), so the result panel can
  // explain its own side instead of showing the opponent's point of view only.
  const myOverCause = ref<SurrenderPayload['cause'] | null>(null)
  // True once the server has rejected one of our reports (invalid_move → anticheat verdict).
  const invalidMoveSeen = ref(false)
  const mpGameState = ref<GameStateDTO>(emptyGameState())
  const shadows = ref<Record<string, ShadowBoard>>({})

  // ====== non-reactive machinery ======
  let ws: WebSocket | null = null
  let engine: GameEngine | null = null
  const shadowBoards = new Map<string, BoardManager>()
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let startTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000
  let intentionalClose = false
  let clockOffset = 0 // serverTs - Date.now(); one-way estimate, ±RTT/2 (block D refines)
  // Garbage scheduled by the server, keyed to the synced clock.
  let garbageTimers: ReturnType<typeof setTimeout>[] = []
  // Locks that went out while the socket was down: retransmitted in order right after rejoin
  // so the server replay never sees a step gap.
  let unsentLocks: ClientMessage[] = []
  // Spawn/hold bookkeeping for the piece_lock holdExtra flag (see protocol.ts).
  let spawnedType: PieceType | null = null
  let awaitingSpawn = false
  let pendingHoldExtra = false

  const me = computed<RoomPlayerRef | null>(
    () => room.value?.players.find((p) => p.id === myId.value) ?? null,
  )
  const inMatch = computed(() => room.value?.phase === 'playing')

  // server effective time = local clock + offset (used for the aligned startTime)
  const serverNow = () => Date.now() + clockOffset

  // ====== WebSocket plumbing ======

  function wsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/ws`
  }

  function ensureConnected(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    intentionalClose = false
    openSocket()
  }

  function openSocket(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws = new WebSocket(wsUrl())

    ws.onopen = () => {
      connected.value = true
      reconnectDelay = 1000
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(() => send({ type: ClientMsgType.Ping, payload: { clientTs: Date.now() } }), MP_CLIENT_PING_MS)
      // A page reload during a live room: take the seat back with the stored token.
      const stored = readJson<StoredToken>(TOKEN_KEY)
      if (stored) send({ type: ClientMsgType.RejoinRoom, payload: { code: stored.code, token: stored.token } })
    }

    ws.onmessage = (ev: MessageEvent) => handleServerMessage(String(ev.data))

    ws.onclose = () => {
      connected.value = false
      if (pingTimer) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      if (!intentionalClose) {
        reconnectTimer = setTimeout(openSocket, reconnectDelay)
        reconnectDelay = Math.min(8000, Math.round(reconnectDelay * 1.5))
      }
    }

    ws.onerror = () => { /* onclose follows and carries the retry logic */ }
  }

  function send(msg: ClientMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
      return
    }
    // Locks produced during a socket outage are buffered (bounded) and retransmitted in order
    // right after a rejoin — the server replay requires strictly consecutive steps.
    if (msg.type === ClientMsgType.PieceLock && unsentLocks.length < 300) unsentLocks.push(msg)
  }

  function handleServerMessage(raw: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      return // the server never sends invalid JSON; a corrupted frame is unactionable
    }
    switch (msg.type) {
      case ServerMsgType.RoomCreated: {
        room.value = msg.payload.room
        myId.value = msg.payload.playerId
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ code: msg.payload.room.code, token: msg.payload.token } satisfies StoredToken))
        lastError.value = null
        // Rejoin into a running match after a page reload: our engine state is gone for good
        // (no replay yet — block D), so the honest move is an immediate surrender.
        const storedMatch = readJson<StoredMatch>(MATCH_KEY)
        if (room.value.phase === 'playing') {
          if (engine) {
            // The engine survived the reconnect (tab stayed open): retransmit buffered locks,
            // keep playing.
            for (const m of unsentLocks) send(m)
            unsentLocks = []
            break
          }
          if (storedMatch && storedMatch.code === room.value.code) {
            // Honest and irreversible: the local board is gone, so the match cannot continue.
            // The cause rides to the server (the other seat reads "forfeit", not "сдался") and is
            // remembered locally so our own result panel can explain what happened.
            myOverCause.value = 'reload'
            send({ type: ClientMsgType.Surrender, payload: { cause: 'reload' } })
            localStorage.removeItem(MATCH_KEY)
          }
        } else {
          resetMatchLocal()
        }
        break
      }
      case ServerMsgType.RoomSnapshot:
        room.value = msg.payload.room
        if (room.value.phase !== 'playing' && !matchOverInfo.value) resetMatchLocal()
        // The dropped seat came back — stop warning the players who are still in the match.
        if (dropNotice.value && msg.payload.room.players.every((p) => p.connected)) {
          dropNotice.value = null
        }
        break
      case ServerMsgType.PlayerJoined:
        lastEvent.value = `${msg.payload.player.name} зашёл`
        break
      case ServerMsgType.PlayerLeft:
        lastEvent.value = `${msg.payload.name} ${msg.payload.reason === 'disconnect_timeout' ? 'потерял связь' : 'вышел'}`
        break
      case ServerMsgType.ChatMessage:
        appendChat(msg.payload)
        break
      case ServerMsgType.FastPhrase:
        lastPhrase.value = msg.payload
        break
      case ServerMsgType.GameStart:
        beginMatch(msg.payload)
        break
      case ServerMsgType.PieceLockedRelay:
        applyShadow(msg.payload)
        break
      case ServerMsgType.GarbageArrive:
        for (const a of msg.payload.arrivals) scheduleGarbage(a)
        break
      case ServerMsgType.GarbageApplied:
        applyShadowGarbage(msg.payload)
        break
      case ServerMsgType.OpponentDropped:
        dropNotice.value = msg.payload
        lastEvent.value = `${msg.payload.name} потерял связь`
        break
      case ServerMsgType.MatchOver:
        matchOverInfo.value = msg.payload
        dropNotice.value = null
        stopEngine()
        localStorage.removeItem(MATCH_KEY)
        break
      case ServerMsgType.Pong:
        if (typeof msg.payload.serverTs === 'number') clockOffset = msg.payload.serverTs - Date.now()
        break
      case ServerMsgType.Error: {
        lastError.value = msg.payload
        // The server ended the match because our own report failed its replay (block D anticheat).
        // Without this flag the result panel would only say "техническая победа соперника" and the
        // player never learns the server rejected a move.
        if (msg.payload.code === MpErrorCode.InvalidMove) invalidMoveSeen.value = true
        if (msg.payload.code === MpErrorCode.BadToken || msg.payload.code === MpErrorCode.RoomNotFound) {
          localStorage.removeItem(TOKEN_KEY)
        }
        break
      }
    }
  }

  function appendChat(m: ChatMessagePayload): void {
    if (!room.value) return
    room.value = { ...room.value, chat: [...room.value.chat, m].slice(-20) }
  }

  // ====== room actions ======

  function createRoom(name: string): void {
    send({ type: ClientMsgType.CreateRoom, payload: { name } })
  }

  function joinRoom(code: string, name: string): void {
    const c = normalizeRoomCode(code)
    if (!c) return
    send({ type: ClientMsgType.JoinRoom, payload: { code: c, name } })
  }

  function setReady(ready: boolean): void {
    send({ type: ClientMsgType.SetReady, payload: { ready } })
  }

  function sendChat(text: string): void {
    const clean = text.trim()
    if (clean) send({ type: ClientMsgType.Chat, payload: { text: clean } })
  }

  function sendFastPhrase(text: string): void {
    const clean = text.trim()
    if (clean) send({ type: ClientMsgType.FastPhrase, payload: { text: clean } })
  }

  function surrender(cause: SurrenderPayload['cause'] = 'button'): void {
    myOverCause.value = cause
    send({ type: ClientMsgType.Surrender, payload: { cause } })
  }

  function leaveRoom(): void {
    send({ type: ClientMsgType.LeaveRoom })
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(MATCH_KEY)
    room.value = null
    myId.value = null
    matchOverInfo.value = null
    resetMatchLocal()
  }

  function disconnect(): void {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) ws.close()
    ws = null
    connected.value = false
  }

  // ====== match: local seeded engine + shadow boards ======

  function beginMatch(p: GameStartPayload): void {
    // Reset first (it clears `match`!), then arm the new match.
    matchOverInfo.value = null
    shadows.value = {}
    shadowBoards.clear()
    dropNotice.value = null
    myOverCause.value = null
    invalidMoveSeen.value = false
    resetMatchLocal()
    match.value = p
    localStorage.setItem(MATCH_KEY, JSON.stringify({
      seed: p.seed, startTime: p.startTime, playerIndex: p.playerIndex, code: room.value?.code ?? '',
    } satisfies StoredMatch))

    engine = new GameEngine(
      {
        onStateChange: () => {
          // The first state change after a spawn names the hand piece — the lock payload
          // compares against it to decide whether this step involved hold.
          if (awaitingSpawn) {
            spawnedType = engine?.getGameState().currentPiece?.type ?? null
            awaitingSpawn = false
          }
          updateLocalState()
        },
        onPieceLocked: (info) => {
          const state = engine?.getGameState()
          send({
            type: ClientMsgType.PieceLock,
            payload: {
              globalStep: info.globalStep,
              pieceType: info.pieceType,
              x: info.x,
              y: info.y,
              rotation: info.rotation,
              linesCleared: info.linesCleared,
              nextType: state?.nextQueue[0],
              // hold on an EMPTY slot pulled an extra bag piece this step (the only kind the
              // server mirror cannot infer from piece identity alone):
              holdExtra: pendingHoldExtra || undefined,
              // How many garbage rows this engine has absorbed so far — the server's replay
              // applies exactly this many of the rows it handed out, so its board matches ours.
              garbageRows: engine?.getGarbageRowsApplied() ?? 0,
            },
          })
          pendingHoldExtra = false
          awaitingSpawn = true
        },
        // In a match, topping out is the loss signal: report it (with the cause, so the other
        // seat reads "развалился" rather than "сдался"); the server answers match_over, which
        // stops the engine and shows the results panel.
        onGameOver: () => {
          if (inMatch.value) surrender('topout')
        },
      },
      { seed: p.seed },
    )

    if (startTimer) clearTimeout(startTimer)
    const wait = Math.max(0, p.startTime - serverNow())
    startTimer = setTimeout(() => {
      awaitingSpawn = true // the very first spawn names the initial hand piece
      engine?.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } })
      updateLocalState()
    }, wait)
  }

  function mpHandleCommand(cmd: AnyCommand): void {
    if (!engine) return
    // A hold press while the slot is empty is the "extra bag pull" the server mirror must know
    // about (flag rides the next piece_lock).
    if (cmd.type === CommandType.HoldPiece && engine.getGameState().holdType === null) {
      pendingHoldExtra = true
    }
    engine.handleCommand(cmd)
    updateLocalState()
  }

  function mpTick(dtMs: number): void {
    if (!engine) return
    engine.handleCommand({ type: CommandType.Tick, payload: { dt: dtMs } })
  }

  function updateLocalState(): void {
    if (!engine) return
    const s = engine.getGameState()
    mpGameState.value = {
      board: s.board.map((row) => row.map((cell) => cell.value)),
      boardWidth: s.boardWidth,
      boardHeight: s.boardHeight,
      currentPiece: s.currentPiece ? { type: s.currentPiece.type, shape: s.currentPiece.shape, colors: s.currentPiece.colors } : null,
      currentPos: s.currentPos,
      currentRotation: s.currentRotation,
      nextQueue: [...s.nextQueue],
      holdType: s.holdType,
      canHold: s.canHold,
      score: s.score,
      level: s.level,
      linesCleared: s.linesCleared,
      combo: s.combo,
      isRunning: s.isRunning,
      isPaused: s.isPaused,
      isGameOver: s.isGameOver,
      mode: s.mode,
      overReason: engine.getOverReason(),
      ghostY: engine.getGhostY(),
    }
  }

  function stopEngine(): void {
    if (startTimer) {
      clearTimeout(startTimer)
      startTimer = null
    }
    for (const t of garbageTimers) clearTimeout(t)
    garbageTimers = []
    if (engine) {
      engine.stop()
      engine = null
    }
    updateLocalState()
  }

  /** One server-scheduled garbage arrival → InsertGarbage on the synced clock. */
  function scheduleGarbage(a: { rows: number[][]; applyAt: number }): void {
    const delay = Math.max(0, a.applyAt - serverNow())
    const timer = setTimeout(() => {
      if (engine && mpGameState.value.isRunning && !mpGameState.value.isGameOver) {
        mpHandleCommand({ type: CommandType.InsertGarbage, payload: { rows: a.rows } })
      }
    }, delay)
    garbageTimers.push(timer)
  }

  function resetMatchLocal(): void {
    stopEngine()
    match.value = null
    shadows.value = {}
    shadowBoards.clear()
    unsentLocks = []
    spawnedType = null
    awaitingSpawn = false
    pendingHoldExtra = false
    lastPhrase.value = null
    dropNotice.value = null
    mpGameState.value = emptyGameState()
  }

  /**
   * Rebuild an opponent board from relayed locks: place the reported piece (type + rotation at
   * x/y) into a local BoardManager, then collapse completed lines — the same primitives the
   * engine uses, so the picture is cell-exact for locks we actually received.
   */
  function applyShadow(p: PlayerPieceLockPayload): void {
    if (!p.playerId || p.playerId === myId.value) return
    let mgr = shadowBoards.get(p.playerId)
    if (!mgr) {
      mgr = new BoardManager(BOARD_WIDTH, BOARD_HEIGHT)
      shadowBoards.set(p.playerId, mgr)
    }
    const lock = p.lock
    const shape = PIECE_SHAPES[lock.pieceType]?.[lock.rotation]
    if (shape) {
      mgr.setCells(buildPiece(lock.pieceType, shape), { x: lock.x, y: lock.y })
      mgr.clearLines()
    }
    const prev = shadows.value[p.playerId]
    shadows.value = {
      ...shadows.value,
      [p.playerId]: {
        board: mgr.getSnapshot(),
        nextType: lock.nextType ?? null,
        linesCleared: (prev?.linesCleared ?? 0) + lock.linesCleared,
        locks: (prev?.locks ?? 0) + 1,
        stale: prev?.stale ?? false,
      },
    }
  }

  /**
   * The garbage an opponent has just absorbed, applied to their shadow board before the lock that
   * rides on top of it. Shadow boards are otherwise rebuilt from locks alone, so without this the
   * opponent's glass would show a clean floor under a stack that actually sits on attack rows.
   * Rows arrive in the same encoding the server sent them to the victim (each group bottom-to-top).
   */
  function applyShadowGarbage(p: GarbageAppliedPayload): void {
    if (!p.playerId || p.playerId === myId.value || !Array.isArray(p.groups)) return
    let mgr = shadowBoards.get(p.playerId)
    if (!mgr) {
      mgr = new BoardManager(BOARD_WIDTH, BOARD_HEIGHT)
      shadowBoards.set(p.playerId, mgr)
    }
    for (const rows of p.groups) {
      if (Array.isArray(rows) && rows.length) mgr.insertGarbageRows(rows)
    }
    const prev = shadows.value[p.playerId]
    shadows.value = {
      ...shadows.value,
      [p.playerId]: {
        board: mgr.getSnapshot(),
        nextType: prev?.nextType ?? null,
        linesCleared: prev?.linesCleared ?? 0,
        locks: prev?.locks ?? 0,
        stale: prev?.stale ?? false,
      },
    }
  }

  function cellColor(value: number): CellStyle {
    return CELL_COLORS[value] ?? CELL_COLORS[0]
  }

  // A toast helper: views read these refs and clear them once displayed.
  function clearNotice(): void {
    lastError.value = null
    lastEvent.value = null
  }

  return {
    connected, room, myId, lastError, lastEvent, match, matchOverInfo, mpGameState, shadows,
    dropNotice, myOverCause, invalidMoveSeen,
    me, inMatch, serverNow,
    ensureConnected, createRoom, joinRoom, setReady, sendChat, sendFastPhrase, lastPhrase, surrender, leaveRoom, disconnect,
    mpHandleCommand, mpTick, clearNotice, cellColor,
    // test seam: feeds one raw server frame through the real message handler
    __handleServerMessage: handleServerMessage,
  }
})
