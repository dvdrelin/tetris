// MP block C — multiplayerStore: the WS client state machine (room, match, shadows, reconnect,
// token hygiene) tested against a fake WebSocket and the real protocol messages.
import { setActivePinia, createPinia } from 'pinia'
import {
  ServerMsgType, ClientMsgType, MpErrorCode, RoomSnapshot, CommandType,
} from '@neon-tetris/shared'
import { useMultiplayerStore } from '../../src/stores/multiplayerStore'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 2

  readyState = FakeWebSocket.CONNECTING
  sent: any[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  feed(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  lastSent(): any {
    return this.sent[this.sent.length - 1]
  }
}

const ws = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

function roomSnapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: 'AB12',
    phase: 'lobby',
    maxPlayers: 2,
    players: [
      { id: 'p1', name: 'Host', host: true, ready: false, connected: true, playerIndex: 0 },
      { id: 'p2', name: 'Guest', host: false, ready: false, connected: true, playerIndex: 1 },
    ],
    chat: [],
    ...over,
  }
}

function setupStore() {
  setActivePinia(createPinia())
  FakeWebSocket.instances = []
  localStorage.clear()
  const store = useMultiplayerStore()
  store.ensureConnected()
  ws().simulateOpen()
  return store
}

const RealWebSocket = globalThis.WebSocket

beforeEach(() => {
  // @ts-expect-error test double replaces the browser class the store constructs
  globalThis.WebSocket = FakeWebSocket
})
afterEach(() => {
  globalThis.WebSocket = RealWebSocket
})

describe('connection and room join', () => {
  test('createRoom sends the wire message after the socket opens', () => {
    const store = setupStore()
    store.createRoom('Хост')
    expect(ws().lastSent()).toEqual({ type: ClientMsgType.CreateRoom, payload: { name: 'Хост' } })
    expect(store.connected).toBe(true)
  })

  test('room_created binds room, myId and persists the rejoin token', () => {
    const store = setupStore()
    ws().feed({
      type: ServerMsgType.RoomCreated,
      payload: { room: roomSnapshot(), token: 'tok-1', playerId: 'p1' },
    })
    expect(store.room?.code).toBe('AB12')
    expect(store.me?.name).toBe('Host')
    expect(JSON.parse(localStorage.getItem('nt_mp_rejoin')!).token).toBe('tok-1')
  })

  test('chat arrives from the server into the room feed', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
    ws().feed({ type: ServerMsgType.ChatMessage, payload: { playerId: 'p2', name: 'Guest', text: 'uu', ts: 1 } })
    expect(store.room?.chat).toHaveLength(1)
  })

  test('bad_token clears the stored credential (a fresh join is then possible)', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 'tok-1', playerId: 'p1' } })
    ws().feed({ type: ServerMsgType.Error, payload: { code: MpErrorCode.BadToken, message: 'nope' } })
    expect(store.lastError?.code).toBe(MpErrorCode.BadToken)
    expect(localStorage.getItem('nt_mp_rejoin')).toBeNull()
  })

  test('leaveRoom resets local room state and drops the token', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 'tok', playerId: 'p1' } })
    store.leaveRoom()
    expect(ws().lastSent().type).toBe(ClientMsgType.LeaveRoom)
    expect(store.room).toBeNull()
    expect(store.me).toBeNull()
    expect(localStorage.getItem('nt_mp_rejoin')).toBeNull()
  })
})

describe('reconnect behaviour', () => {
  test('an unplanned close reconnects and rejoins with the stored token', () => {
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 'tok-9', playerId: 'p1' } })
      ws().close() // network drop (not intentional)
      expect(store.connected).toBe(false)
      jest.advanceTimersByTime(1000) // first backoff step
      expect(FakeWebSocket.instances).toHaveLength(2)
      ws().simulateOpen()
      expect(ws().lastSent()).toEqual({
        type: ClientMsgType.RejoinRoom,
        payload: { code: 'AB12', token: 'tok-9' },
      })
      store.disconnect()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('match lifecycle', () => {
  test('game_start starts the seeded engine at startTime and piece_lock goes out on locks', () => {
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
      const startTime = Date.now() + 50
      ws().feed({ type: ServerMsgType.GameStart, payload: { seed: 42, startTime, playerIndex: 0, league: 'heads_up' } })
      expect(store.match?.seed).toBe(42) // the store must retain the match descriptor
      expect(store.mpGameState.isRunning).toBe(false) // countdown before startTime
      jest.advanceTimersByTime(60)
      expect(store.mpGameState.isRunning).toBe(true)
      expect(store.mpGameState.nextQueue.length).toBeGreaterThan(0) // the seeded bag dealt pieces
      // Ticks produce locks; a lock must produce a piece_lock wire message.
      for (let i = 0; i < 60; i++) store.mpTick(250) // gravity pushes a piece to the floor
      const locks = ws().sent.filter((m) => m.type === ClientMsgType.PieceLock)
      expect(locks.length).toBeGreaterThan(0)
      expect(locks[0].payload).toMatchObject({ pieceType: expect.any(String), globalStep: expect.any(Number) })
      store.leaveRoom()
    } finally {
      jest.useRealTimers()
    }
  })

  test('relayed locks build the opponent shadow board (placement + line clear)', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
    const lock = (playerId: string, globalStep: number, x: number, y: number, linesCleared = 0) => ({
      type: ServerMsgType.PieceLockedRelay,
      payload: { playerId, lock: { globalStep, pieceType: 'O', x, y, rotation: 0, linesCleared, nextType: 'T' } },
    })

    // Two 2x2 O-pieces at y=18: both rows 18 and 19 carry exactly 4 filled cells.
    ws().feed(lock('p2', 1, 0, 18))
    ws().feed(lock('p2', 2, 4, 18))
    const shadow = store.shadows['p2']
    expect(shadow.locks).toBe(2)
    expect(shadow.nextType).toBe('T')
    expect(shadow.board[19].filter((v: number) => v !== 0)).toHaveLength(4)
    expect(shadow.board[18].filter((v: number) => v !== 0)).toHaveLength(4)

    // A full-width stack (five Os at y=17 fill rows 18+19 completely) is cleared on placement.
    for (let i = 0; i < 5; i++) ws().feed(lock('p3', 10 + i, i * 2, 17))
    expect(store.shadows['p3'].locks).toBe(5)
    expect(store.shadows['p3'].board[19].every((v: number) => v === 0)).toBe(true)

    // A relay for ourselves never creates a shadow entry.
    ws().feed(lock('p1', 20, 2, 18))
    expect(Object.keys(store.shadows).sort()).toEqual(['p2', 'p3'])
  })

  test('match_over stores the verdict and stops the local engine', () => {
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
      ws().feed({ type: ServerMsgType.GameStart, payload: { seed: 7, startTime: Date.now(), playerIndex: 0, league: 'heads_up' } })
      jest.advanceTimersByTime(1)
      expect(store.mpGameState.isRunning).toBe(true)
      ws().feed({
        type: ServerMsgType.MatchOver,
        payload: { reason: 'surrender', winnerId: 'p1', results: [{ playerId: 'p1', name: 'Host', placement: 1, score: 0, lines: 0 }] },
      })
      expect(store.matchOverInfo?.reason).toBe('surrender')
      expect(store.mpGameState.isRunning).toBe(false)
      expect(localStorage.getItem('nt_mp_match')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test('rejoining a live match after a reload surrenders (no replay yet — block D)', () => {
    const store = setupStore()
    localStorage.setItem('nt_mp_match', JSON.stringify({ seed: 1, startTime: 1, playerIndex: 0, code: 'AB12' }))
    ws().feed({
      type: ServerMsgType.RoomCreated,
      payload: { room: roomSnapshot({ phase: 'playing' }), token: 't', playerId: 'p1' },
    })
    expect(ws().lastSent().type).toBe(ClientMsgType.Surrender)
    expect(localStorage.getItem('nt_mp_match')).toBeNull()
  })

  test('a reconnect while the engine is still alive resumes — nobody is blamed for a reload', () => {
    // The false accusation the 5.1 live test ran into: a dropped WebSocket is not a page reload.
    // With the local engine intact the store must keep playing: no surrender, no forfeit cause,
    // and the match record stays so the game can be finished.
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
      ws().feed({ type: ServerMsgType.GameStart, payload: { seed: 12, startTime: Date.now(), playerIndex: 0, league: 'heads_up' } })
      jest.advanceTimersByTime(1)
      expect(localStorage.getItem('nt_mp_match')).not.toBeNull()

      ws().close() // the socket dies (nginx idle, a wifi hop); the tab and its engine survive
      jest.advanceTimersByTime(2000) // the reconnect backoff, then the new socket opens
      ws().simulateOpen()
      ws().feed({
        type: ServerMsgType.RoomCreated,
        payload: { room: roomSnapshot({ phase: 'playing' }), token: 't2', playerId: 'p1' },
      })

      const types = ws().sent.map((m: any) => m.type)
      expect(types).not.toContain(ClientMsgType.Surrender)
      expect(store.myOverCause).toBeNull()
      expect(store.inMatch).toBe(true)
      expect(localStorage.getItem('nt_mp_match')).not.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test('fast_phrase from the server lands in lastPhrase for the toast', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
    ws().feed({ type: ServerMsgType.FastPhrase, payload: { playerId: 'p2', name: 'Bob', text: 'GG', ts: 1 } })
    expect(store.lastPhrase).toEqual({ playerId: 'p2', name: 'Bob', text: 'GG', ts: 1 })
  })

  test('garbage_arrive lands the rows on the synced applyAt', () => {
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
      ws().feed({ type: ServerMsgType.GameStart, payload: { seed: 11, startTime: Date.now(), playerIndex: 0, league: 'heads_up' } })
      jest.advanceTimersByTime(1)
      const row = Array(10).fill(6)
      row[0] = 0
      ws().feed({ type: ServerMsgType.GarbageArrive, payload: { arrivals: [{ rows: [row], applyAt: Date.now() + 300 }] } })
      jest.advanceTimersByTime(100)
      expect(store.mpGameState.board[19].every((v) => v === 0)).toBe(true) // not yet
      jest.advanceTimersByTime(250)
      expect(store.mpGameState.board[19][0]).toBe(0)
      expect(store.mpGameState.board[19][1]).toBe(6) // the garbage row rode in at applyAt
    } finally {
      jest.useRealTimers()
    }
  })

  test('pong stamps the clock offset used for the aligned startTime', () => {
    const store = setupStore()
    const serverTs = Date.now() + 5000
    ws().feed({ type: ServerMsgType.Pong, payload: { serverTs } })
    // |serverNow - serverTs| stays inside a millisecond — this drives the countdown math.
    expect(Math.abs(store.serverNow() - serverTs)).toBeLessThanOrEqual(1)
  })
})

// The 5.1 bug report: honest players dying after a legal drop, empty opponent glasses, and a match
// that ends without anyone saying why. The store is the client half of all three fixes.
describe('garbage bookkeeping and match-end notices (5.1 fixes)', () => {
  const holeRow = (color: number) => {
    const row = Array(10).fill(color)
    row[0] = 0 // the engine rejects a garbage row without a hole
    return row
  }

  test('every piece_lock carries how much garbage this board has absorbed', () => {
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
      ws().feed({ type: ServerMsgType.GameStart, payload: { seed: 5, startTime: Date.now(), playerIndex: 0, league: 'heads_up' } })
      jest.advanceTimersByTime(1)
      ws().feed({ type: ServerMsgType.GarbageArrive, payload: { arrivals: [{ rows: [holeRow(6), holeRow(7)], applyAt: Date.now() }] } })
      jest.advanceTimersByTime(1)
      expect(store.mpGameState.board[19][1]).toBe(6) // two rows landed
      for (let i = 0; i < 60; i++) store.mpTick(250) // gravity locks the hand somewhere on them
      const locks = ws().sent.filter((m) => m.type === ClientMsgType.PieceLock)
      expect(locks.length).toBeGreaterThan(0)
      expect(locks[0].payload.garbageRows).toBeGreaterThanOrEqual(2)
      store.leaveRoom()
    } finally {
      jest.useRealTimers()
    }
  })

  test('a garbage_applied relay lifts the opponent shadow to match their real stack', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
    ws().feed({
      type: ServerMsgType.PieceLockedRelay,
      payload: { playerId: 'p2', lock: { globalStep: 1, pieceType: 'O', x: 0, y: 18, rotation: 0, linesCleared: 0 } },
    })
    // One garbage row arrives: the O that sat on the floor now rides one row up.
    ws().feed({ type: ServerMsgType.GarbageApplied, payload: { playerId: 'p2', groups: [[holeRow(4)]] } })
    const shadow = store.shadows['p2']
    expect(shadow.board[19][1]).toBe(4) // the garbage row itself
    expect(shadow.board[17].filter((v: number) => v !== 0)).toHaveLength(2) // the O, pushed up
    expect(shadow.board[18].filter((v: number) => v !== 0)).toHaveLength(2)
    // Our own shadow is never touched by our opponent's garbage.
    expect(store.shadows['p1']).toBeUndefined()
  })

  test('a dropped seat is announced as a banner notice and a room toast', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
    ws().feed({ type: ServerMsgType.OpponentDropped, payload: { playerId: 'p2', name: 'Гость', returnBy: Date.now() + 120_000 } })
    expect(store.dropNotice?.name).toBe('Гость')
    expect(store.lastEvent).toContain('Гость')
  })

  test('a local top-out ends the match as a topout, not as a surrender', () => {
    jest.useFakeTimers()
    try {
      const store = setupStore()
      ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot({ phase: 'playing' }), token: 't', playerId: 'p1' } })
      ws().feed({ type: ServerMsgType.GameStart, payload: { seed: 3, startTime: Date.now(), playerIndex: 0, league: 'heads_up' } })
      jest.advanceTimersByTime(1)
      // A full-height garbage push leaves the stack nowhere to go: block-out.
      store.mpHandleCommand({ type: CommandType.InsertGarbage, payload: { rows: Array.from({ length: 20 }, () => holeRow(5)) } })
      expect(store.mpGameState.isGameOver).toBe(true)
      expect(ws().lastSent()).toEqual({ type: ClientMsgType.Surrender, payload: { cause: 'topout' } })
      expect(store.myOverCause).toBe('topout')
    } finally {
      jest.useRealTimers()
    }
  })

  test('the drop banner clears once the lost seat is connected again', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot({ phase: 'playing' }), token: 't', playerId: 'p1' } })
    ws().feed({
      type: ServerMsgType.OpponentDropped,
      payload: { playerId: 'p2', name: 'Вова', returnBy: Date.now() + 60_000 },
    })
    expect(store.dropNotice?.name).toBe('Вова')
    ws().feed({
      type: ServerMsgType.RoomSnapshot,
      payload: { room: roomSnapshot({ phase: 'playing' }) },
    })
    expect(store.dropNotice).toBeNull()
  })

  test('a rejoin after a page reload surrenders with cause reload', () => {
    const store = setupStore()
    localStorage.setItem('nt_mp_match', JSON.stringify({ seed: 1, startTime: 1, playerIndex: 0, code: 'AB12' }))
    ws().feed({
      type: ServerMsgType.RoomCreated,
      payload: { room: roomSnapshot({ phase: 'playing' }), token: 't', playerId: 'p1' },
    })
    expect(ws().lastSent()).toEqual({ type: ClientMsgType.Surrender, payload: { cause: 'reload' } })
    expect(store.myOverCause).toBe('reload')
  })

  test('an invalid_move verdict is remembered so the result panel can explain itself', () => {
    const store = setupStore()
    ws().feed({ type: ServerMsgType.RoomCreated, payload: { room: roomSnapshot(), token: 't', playerId: 'p1' } })
    expect(store.invalidMoveSeen).toBe(false)
    ws().feed({ type: ServerMsgType.Error, payload: { code: MpErrorCode.InvalidMove, message: 'nope' } })
    expect(store.invalidMoveSeen).toBe(true)
  })
})
