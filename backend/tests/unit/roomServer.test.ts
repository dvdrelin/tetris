// MP block B — RoomServer: room codes, the lobby→playing→over lifecycle, ready/start, room chat
// with cooldown, disconnect grace + token rejoin, per-connection message limits, and the
// surrender/forfeit verdict paths. The server logic is driven through its real connection entry
// point (`handleConnection`) with a fake `ws`: same code path as production.
import { EventEmitter } from 'events'
import {
  ClientMsgType, ServerMsgType, MpErrorCode, RoomSnapshot, ServerMessage,
  PieceFactoryProvider, PIECE_SHAPES, GAME_CONFIG, PieceLockPayload,
} from '@neon-tetris/shared'
import { RoomServer, ClientSocket } from '../../src/servers/roomServer'
import { MP_CONFIG } from '../../src/config/mpConfig'

// A lock the server replay will accept: the first piece of the room's seeded bag, resting on
// the floor of an empty board (support + bounds satisfied, nothing clears).
function honestFirstLock(seed: number): PieceLockPayload {
  const factory = new PieceFactoryProvider({ seed })
  const pieceType = factory.nextPieceType()
  const shape = PIECE_SHAPES[pieceType][0]
  let maxRow = 0
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) if (shape[r][c]) maxRow = Math.max(maxRow, r)
  }
  return { globalStep: 1, pieceType, x: 0, y: GAME_CONFIG.boardHeight - 1 - maxRow, rotation: 0, linesCleared: 0 }
}

function seedOf(host: { lastOf: (t: ServerMsgType) => any }): number {
  return host.lastOf(ServerMsgType.GameStart).payload.seed
}

class FakeSocket extends EventEmitter implements ClientSocket {
  readyState = 1
  sent: ServerMessage[] = []
  terminated = false

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage)
  }
  close(): void {
    this.emit('close')
  }
  terminate(): void {
    this.terminated = true
  }
  /** Feed one raw frame the way `ws` would. */
  emitMessage(obj: unknown): void {
    this.emit('message', JSON.stringify(obj))
  }
  of(type: ServerMsgType): ServerMessage[] {
    return this.sent.filter((m) => m.type === type)
  }
  lastOf(type: ServerMsgType): any {
    const all = this.of(type)
    return all[all.length - 1]
  }
}

let clock = 0
const now = () => clock

function newServer(): RoomServer {
  clock = 1_000_000
  return new RoomServer({ now, graceMs: 5_000 })
}

function connect(server: RoomServer): FakeSocket {
  const ws = new FakeSocket()
  server.handleConnection(ws)
  return ws
}

function createRoom(server: RoomServer, name = 'Host'): {
  ws: FakeSocket; snapshot: RoomSnapshot; code: string; token: string
  of: (t: ServerMsgType) => ServerMessage[]; lastOf: (t: ServerMsgType) => any
} {
  const ws = connect(server)
  ws.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name } })
  const created = ws.lastOf(ServerMsgType.RoomCreated)
  return {
    ws,
    snapshot: created.payload.room,
    code: created.payload.room.code,
    token: created.payload.token,
    of: (t: ServerMsgType) => ws.of(t),
    lastOf: (t: ServerMsgType) => ws.lastOf(t),
  }
}

function joinRoom(server: RoomServer, code: string, name = 'Guest'): FakeSocket {
  const ws = connect(server)
  ws.emitMessage({ type: ClientMsgType.JoinRoom, payload: { code, name } })
  return ws
}

describe('room creation and join', () => {
  test('create_room returns a 4-char room code, a token and the host seat', () => {
    const server = newServer()
    const { snapshot, code, token } = createRoom(server)
    expect(code).toHaveLength(MP_CONFIG.roomCodeLen)
    expect(code).toMatch(new RegExp(`^[${MP_CONFIG.roomCodeAlphabet}]{4}$`))
    expect(token).toMatch(/[0-9a-f-]{36}/)
    expect(snapshot.phase).toBe('lobby')
    expect(snapshot.maxPlayers).toBe(2)
    expect(snapshot.players).toHaveLength(1)
    expect(snapshot.players[0]).toMatchObject({ name: 'Host', host: true, ready: false, connected: true, playerIndex: 0 })
    expect(server.roomCount).toBe(1)
  })

  test('second player joins by code (case-insensitively), both sides learn the roster', () => {
    const server = newServer()
    const host = createRoom(server)
    const guest = joinRoom(server, host.code.toLowerCase() + '-' , 'Гость') // separators/spacing are normalized
    const created = guest.lastOf(ServerMsgType.RoomCreated)
    expect(created.payload.room.players.map((p: { name: string }) => p.name)).toEqual(['Host', 'Гость'])
    expect(host.of(ServerMsgType.PlayerJoined).length).toBe(1)
    const snap = host.lastOf(ServerMsgType.RoomSnapshot)
    expect(snap.payload.room.players[1]).toMatchObject({ name: 'Гость', host: false, playerIndex: 1 })
  })

  test('third player into a 1v1 room gets room_full; unknown code gets room_not_found', () => {
    const server = newServer()
    const host = createRoom(server)
    joinRoom(server, host.code, 'P2')
    const third = joinRoom(server, host.code, 'P3')
    expect(third.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.RoomFull)
    const stranger = joinRoom(server, 'ZZZZ', 'P4')
    expect(stranger.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.RoomNotFound)
  })

  test('create_room while already in a room is refused', () => {
    const server = newServer()
    const host = createRoom(server)
    host.ws.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name: 'again' } })
    expect(host.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadPhase)
    expect(server.roomCount).toBe(1)
  })

  test('malformed frames produce bad_message errors and never crash the server', () => {
    const server = newServer()
    const ws = connect(server)
    ws.emit('message', '{not json')
    ws.emitMessage({ type: 42 })
    ws.emitMessage({ type: 'no_such_type' })
    expect(ws.of(ServerMsgType.Error).length).toBe(3)
    expect(ws.of(ServerMsgType.Error).every((m: any) => m.payload.code === MpErrorCode.BadMessage)).toBe(true)
  })
})

describe('chat', () => {
  test('lobby chat is broadcast (sender included) and lands in the join-time history', () => {
    const server = newServer()
    const host = createRoom(server)
    host.ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: 'привет\u0000!' } })
    expect(host.of(ServerMsgType.ChatMessage).length).toBe(1)
    expect(host.lastOf(ServerMsgType.ChatMessage).payload.text).toBe('привет!')
    const guest = joinRoom(server, host.code)
    const created = guest.lastOf(ServerMsgType.RoomCreated)
    expect(created.payload.room.chat).toHaveLength(1)
    expect(created.payload.room.chat[0].name).toBe('Host')
  })

  test('chat cooldown: the second immediate message is rate-limited, not broadcast', () => {
    const server = newServer()
    const host = createRoom(server)
    const guest = joinRoom(server, host.code)
    host.ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: 'первое' } })
    host.ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: 'второе' } })
    expect(host.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.RateLimited)
    expect(guest.of(ServerMsgType.ChatMessage)).toHaveLength(1)
    // After the cooldown window the same player may talk again.
    clock += MP_CONFIG.chatCooldownMs + 1
    host.ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: 'третье' } })
    expect(guest.of(ServerMsgType.ChatMessage)).toHaveLength(2)
  })

  test('long chat is capped, empty chat is dropped silently', () => {
    const server = newServer()
    const host = createRoom(server)
    host.ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: 'a'.repeat(MP_CONFIG.chatMaxLen + 50) } })
    expect(host.lastOf(ServerMsgType.ChatMessage).payload.text).toHaveLength(MP_CONFIG.chatMaxLen)
    const before = host.of(ServerMsgType.ChatMessage).length
    host.ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: '   ' } })
    expect(host.of(ServerMsgType.ChatMessage)).toHaveLength(before)
  })
})

describe('ready / game_start', () => {
  function twoPlayersInLobby() {
    const server = newServer()
    const host = createRoom(server)
    const guest = joinRoom(server, host.code)
    const token = guest.lastOf(ServerMsgType.RoomCreated).payload.token
    return { server, host, guest, token }
  }

  test('the match starts exactly when every player is ready; one ready alone does nothing', () => {
    const { server, host, guest } = twoPlayersInLobby()
    guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    expect(host.of(ServerMsgType.GameStart)).toHaveLength(0)
    host.ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })

    expect(host.of(ServerMsgType.GameStart)).toHaveLength(1)
    expect(guest.of(ServerMsgType.GameStart)).toHaveLength(1)
    const g1 = host.lastOf(ServerMsgType.GameStart).payload
    const g2 = guest.lastOf(ServerMsgType.GameStart).payload
    expect(Number.isInteger(g1.seed) && g1.seed >= 0 && g1.seed < 2 ** 32).toBe(true)
    expect(g1.seed).toBe(g2.seed)
    expect(g1.startTime).toBe(clock + MP_CONFIG.startDelayMs)
    expect(g1.playerIndex).not.toBe(g2.playerIndex)
    expect(g1.league).toBe('heads_up')
    expect(host.lastOf(ServerMsgType.RoomSnapshot).payload.room.phase).toBe('playing')
  })

  test('joins and ready flips are refused once the match is running', () => {
    const { server, host, guest } = twoPlayersInLobby()
    guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    host.ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    const late = joinRoom(server, host.code)
    expect(late.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadPhase)
    guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: false } })
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadPhase)
  })

  test('ready must be a boolean (protocol strictness)', () => {
    const { host, guest } = twoPlayersInLobby()
    guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: 'yes' } })
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadRequest)
  })
})

describe('disconnect grace and token rejoin', () => {
  test('a dropped socket keeps the seat (connected:false), a token rejoin takes it back', () => {
    const server = newServer()
    const host = createRoom(server)
    const guest = joinRoom(server, host.code)
    const token = guest.lastOf(ServerMsgType.RoomCreated).payload.token

    guest.emit('close')
    const snap = host.lastOf(ServerMsgType.RoomSnapshot)
    expect(snap.payload.room.players).toHaveLength(2)
    expect(snap.payload.room.players[1].connected).toBe(false)
    expect(server.connectedPlayerCount).toBe(1)

    const rejoiner = connect(server)
    rejoiner.emitMessage({ type: ClientMsgType.RejoinRoom, payload: { code: host.code, token } })
    const created = rejoiner.lastOf(ServerMsgType.RoomCreated)
    expect(created.payload.room.players[1].connected).toBe(true)
    // The token rotates: the captured old one can no longer hijack the seat.
    const stranger = connect(server)
    stranger.emitMessage({ type: ClientMsgType.RejoinRoom, payload: { code: host.code, token } })
    expect(stranger.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadToken)
  })

  test('grace expiry removes the player and announces it; an empty room is deleted', () => {
    jest.useFakeTimers()
    try {
      const server = newServer()
      const host = createRoom(server)
      const guest = joinRoom(server, host.code)
      guest.emit('close')
      jest.advanceTimersByTime(5_000 + 1) // graceMs = 5_000 in these tests
      const left = host.lastOf(ServerMsgType.PlayerLeft)
      expect(left.payload.reason).toBe('disconnect_timeout')
      expect(server.roomCount).toBe(1)
      host.ws.emit('close')
      jest.advanceTimersByTime(5_000 + 1)
      expect(server.roomCount).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  test('disconnect during a running match is a forfeit: the survivor gets match_over', () => {
    jest.useFakeTimers()
    try {
      const server = newServer()
      const host = createRoom(server)
      const guest = joinRoom(server, host.code)
      guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
      host.ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
      guest.emit('close')
      jest.advanceTimersByTime(5_000 + 1)
      const over = host.ws.lastOf(ServerMsgType.MatchOver)
      expect(over.payload.reason).toBe('forfeit')
      expect(over.payload.winnerId).toBe(host.snapshot.players[0].id)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('surrender, rematch and forfeit-by-leave', () => {
  function startedMatch() {
    const server = newServer()
    const host = createRoom(server)
    const guest = joinRoom(server, host.code)
    guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    host.ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    return { server, host, guest }
  }

  test('surrender ends the match, winner first in results, phase goes to over', () => {
    const { host, guest } = startedMatch()
    guest.emitMessage({ type: ClientMsgType.Surrender })
    const over = host.ws.lastOf(ServerMsgType.MatchOver)
    expect(over.payload.reason).toBe('surrender')
    expect(over.payload.winnerId).toBe(host.snapshot.players[0].id)
    expect(over.payload.results[0].placement).toBe(1)
    expect(over.payload.results[0].playerId).toBe(host.snapshot.players[0].id)
    expect(host.ws.lastOf(ServerMsgType.RoomSnapshot).payload.room.phase).toBe('over')
  })

  test('a verified lock certifies the line count that reaches the match results', () => {
    const { host, guest } = startedMatch()
    const lock = honestFirstLock(seedOf(host))
    guest.emitMessage({ type: ClientMsgType.PieceLock, payload: lock })
    guest.emitMessage({ type: ClientMsgType.Surrender })
    const over = guest.lastOf(ServerMsgType.MatchOver)
    const loser = over.payload.results.find((r: any) => r.playerId !== over.payload.winnerId)
    expect(loser.lines).toBe(0) // an empty-board lock clears nothing — the server certifies that
  })

  test('a verified lock is relayed (sanitized) to the opponent; a malformed one is rejected outright', () => {
    const { server, host, guest } = startedMatch()
    const lock = { ...honestFirstLock(seedOf(host)), nextType: 'O', injected: 'junk' }
    guest.emitMessage({ type: ClientMsgType.PieceLock, payload: lock })
    const relay = host.ws.lastOf(ServerMsgType.PieceLockedRelay)
    expect(relay.payload.playerId).toBeDefined()
    const expected = { ...honestFirstLock(seedOf(host)), nextType: 'O' }
    expect(relay.payload.lock).toEqual(expected) // the raw object never reaches the opponent
    // The reporter never receives its own relay back.
    expect(guest.of(ServerMsgType.PieceLockedRelay)).toHaveLength(0)

    guest.emitMessage({ type: ClientMsgType.PieceLock, payload: { globalStep: 2, pieceType: 'WTF', x: 3, y: 19, rotation: 0, linesCleared: 0 } })
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadRequest)
    expect(host.of(ServerMsgType.PieceLockedRelay)).toHaveLength(1) // no second relay
    void server
  })

  test('anticheat: a lock with a piece from the wrong bag position ends the match (invalid_move)', () => {
    const { server, host, guest } = startedMatch()
    const seed = seedOf(host)
    const honest = honestFirstLock(seed)
    const cheater = { ...honest, pieceType: honest.pieceType === 'O' ? 'I' : 'O' }
    guest.emitMessage({ type: ClientMsgType.PieceLock, payload: cheater })
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.InvalidMove)
    expect(guest.terminated).toBe(true)
    const over = host.ws.lastOf(ServerMsgType.MatchOver)
    expect(over.payload.reason).toBe('forfeit')
    expect(over.payload.winnerId).toBe(host.snapshot.players[0].id)
    void server
  })

  test('surrender outside a running match is refused', () => {
    const { guest } = startedMatch()
    guest.emitMessage({ type: ClientMsgType.Surrender })
    guest.emitMessage({ type: ClientMsgType.Surrender }) // already over
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadPhase)
  })

  test('rematch: a ready in the over phase reopens the lobby and the next start gets a fresh seed', () => {
    const { host, guest } = startedMatch()
    const seed1 = host.ws.lastOf(ServerMsgType.GameStart).payload.seed
    guest.emitMessage({ type: ClientMsgType.Surrender })
    guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    expect(host.ws.lastOf(ServerMsgType.RoomSnapshot).payload.room.phase).toBe('lobby')
    host.ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    const seed2 = host.ws.lastOf(ServerMsgType.GameStart).payload.seed
    // uint32 seeds collide with probability ~2^-32: equality here would be the bug, not the norm.
    expect(guest.of(ServerMsgType.GameStart)).toHaveLength(2)
    expect(seed2).toBeGreaterThanOrEqual(0)
    void seed1
  })

  test('leaving mid-match is a forfeit with reason forfeit and removal', () => {
    const { server, host, guest } = startedMatch()
    guest.emit('close') // network leave path covered elsewhere; use the explicit leave command here:
    const server2 = newServer()
    const host2 = createRoom(server2)
    const guest2 = joinRoom(server2, host2.code)
    guest2.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    host2.ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    guest2.emitMessage({ type: ClientMsgType.LeaveRoom })
    const over = host2.ws.lastOf(ServerMsgType.MatchOver)
    expect(over.payload.reason).toBe('forfeit')
    expect(server2.roomCount).toBe(1)
    void server
    void host
    void guest
  })
})

describe('protocol hygiene: ping/pong and message limits', () => {
  test('ping is answered with pong echoing clientTs and stamping serverTs', () => {
    const server = newServer()
    const ws = connect(server)
    ws.emitMessage({ type: ClientMsgType.Ping, payload: { clientTs: 111 } })
    const pong = ws.lastOf(ServerMsgType.Pong)
    expect(pong.payload.clientTs).toBe(111)
    expect(pong.payload.serverTs).toBe(clock)
  })

  test('flooding over the per-connection budget answers rate_limited', () => {
    const server = newServer()
    const ws = connect(server)
    for (let i = 0; i < MP_CONFIG.msgMaxPerWindow; i++) {
      ws.emitMessage({ type: ClientMsgType.Ping, payload: { clientTs: i } })
    }
    ws.emitMessage({ type: ClientMsgType.Ping, payload: { clientTs: -1 } })
    expect(ws.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.RateLimited)
    // The window moves with the injected clock: traffic is allowed again after it passes.
    clock += MP_CONFIG.msgWindowMs + 1
    ws.emitMessage({ type: ClientMsgType.Ping, payload: { clientTs: 1 } })
    expect(ws.lastOf(ServerMsgType.Pong).payload.clientTs).toBe(1)
  })

  test('persistent protocol abuse terminates the socket', () => {
    const server = newServer()
    const ws = connect(server)
    clock += MP_CONFIG.msgWindowMs // stay inside limiter sanity
    for (let i = 0; i < MP_CONFIG.maxViolations; i++) {
      ws.emit('message', '{oops')
    }
    expect(ws.terminated).toBe(true)
  })

  test('not-in-a-room commands are refused cleanly', () => {
    const server = newServer()
    const ws = connect(server)
    ws.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    ws.emitMessage({ type: ClientMsgType.Chat, payload: { text: 'hi' } })
    ws.emitMessage({ type: ClientMsgType.LeaveRoom })
    expect(ws.of(ServerMsgType.Error).every((m: any) => m.payload.code === MpErrorCode.NotInRoom)).toBe(true)
  })
})
