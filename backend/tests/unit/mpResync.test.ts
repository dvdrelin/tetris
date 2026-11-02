/**
 * Soft resync of a lost `piece_lock` report (the live EX8H case: the client's step counter ran
 * ahead because one report never reached the server). The server must ask for the missing steps
 * instead of declaring a cheat, and only forfeit if the retransmission does not arrive.
 */
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ClientMsgType, ServerMsgType, ServerMessage, GameEngine, GameMode, CommandType, PieceLockPayload,
  MpErrorCode,
} from '@neon-tetris/shared'
import { RoomServer, ClientSocket } from '../../src/servers/roomServer'
import { MatchLogStore } from '../../src/services/matchLog'
import { MP_CONFIG } from '../../src/config/mpConfig'

class FakeSocket extends EventEmitter implements ClientSocket {
  readyState = 1
  sent: ServerMessage[] = []
  terminated = false
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage) }
  close(): void { this.emit('close') }
  terminate(): void { this.terminated = true }
  emitMessage(obj: unknown): void { this.emit('message', JSON.stringify(obj)) }
  of(type: ServerMsgType): ServerMessage[] { return this.sent.filter((m) => m.type === type) }
  lastOf(type: ServerMsgType): any { const all = this.of(type); return all[all.length - 1] }
}

/** A client that plays by hard-dropping at the spawn column and reports every lock it emits. */
class MiniBot {
  readonly locks: PieceLockPayload[] = []
  private engine: GameEngine

  constructor(seed: number) {
    this.engine = new GameEngine(
      {
        onPieceLocked: (info) => {
          this.locks.push({
            globalStep: info.globalStep,
            pieceType: info.pieceType,
            x: info.x,
            y: info.y,
            rotation: info.rotation,
            linesCleared: info.linesCleared,
            garbageRows: this.engine.getGarbageRowsApplied(),
          })
        },
      },
      { seed },
    )
    this.engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } })
  }

  play(n: number): void {
    for (let i = 0; i < n; i++) this.engine.handleCommand({ type: CommandType.HardDrop })
  }
}

let clock: number
let dir: string
const now = () => clock

beforeEach(() => {
  clock = 1_000_000
  dir = mkdtempSync(join(tmpdir(), 'neon-mp-resync-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Two seats, a started match, and the guest's client engine driven by the room's seed. */
function playRoom(store: MatchLogStore) {
  const server = new RoomServer({ now, graceMs: 5_000, seed: () => 4242, matchLog: store })
  const host = new FakeSocket()
  const guest = new FakeSocket()
  server.handleConnection(host)
  server.handleConnection(guest)
  host.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name: 'Хост' } })
  const code = host.lastOf(ServerMsgType.RoomCreated).payload.room.code
  guest.emitMessage({ type: ClientMsgType.JoinRoom, payload: { code, name: 'Гость' } })
  guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
  host.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
  const seed = host.lastOf(ServerMsgType.GameStart).payload.seed
  const bot = new MiniBot(seed)
  const sendLock = (lock: PieceLockPayload) =>
    guest.emitMessage({ type: ClientMsgType.PieceLock, payload: lock })
  return { server, host, guest, bot, sendLock, code }
}

test('a missing report is repaired by retransmission, not by a forfeit', () => {
  jest.useFakeTimers()
  try {
    const store = new MatchLogStore({ dir, now })
    const { guest, bot, sendLock } = playRoom(store)
    bot.play(3) // the client played three pieces; the server will only see #1 and #3 first

    sendLock(bot.locks[0]) // step 1, accepted
    expect(guest.of(ServerMsgType.Error)).toEqual([])
    sendLock(bot.locks[2]) // step 3 arrives while the server waits for step 2 → the EX8H shape
    const resync = guest.lastOf(ServerMsgType.ResyncRequest)
    expect(resync.payload).toMatchObject({ expectedStep: 2, gotStep: 3 })
    expect(resync.payload.deadline).toBeGreaterThan(clock)
    expect(guest.of(ServerMsgType.Error)).toEqual([])
    expect(guest.of(ServerMsgType.MatchOver)).toEqual([])

    // What the browser store does on `resync_request`: re-send everything from the missing step
    // on, oldest first (the ring buffer of reported locks).
    for (const lock of [bot.locks[1], bot.locks[2]]) sendLock(lock)
    expect(guest.of(ServerMsgType.Error)).toEqual([])
    // The grace timer may fire later; the match must already be back in sequence and stay alive.
    clock += MP_CONFIG.resyncGraceMs + 500
    jest.advanceTimersByTime(MP_CONFIG.resyncGraceMs + 500)
    expect(guest.of(ServerMsgType.MatchOver)).toEqual([])
    expect(guest.terminated).toBe(false)

    const events = store.readLines(store.list()[0]!.file).map((l) => l.event)
    expect(events).toContain('resync_requested')
    expect(events).not.toContain('resync_failed')
  } finally {
    jest.useRealTimers()
  }
})

test('no retransmission within the grace window ends the match as invalid_move', () => {
  jest.useFakeTimers()
  try {
    const store = new MatchLogStore({ dir, now })
    const { guest, bot, sendLock } = playRoom(store)
    bot.play(2)
    sendLock(bot.locks[0])
    sendLock({ ...bot.locks[1], globalStep: bot.locks[1].globalStep + 2 }) // a forward gap stays soft
    expect(guest.lastOf(ServerMsgType.ResyncRequest).payload).toMatchObject({ expectedStep: 2, gotStep: 4 })

    clock += MP_CONFIG.resyncGraceMs + 1
    jest.advanceTimersByTime(MP_CONFIG.resyncGraceMs + 1)
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.InvalidMove)
    expect(guest.lastOf(ServerMsgType.MatchOver).payload).toMatchObject({ reason: 'forfeit', detail: 'invalid_move' })
    const events = store.readLines(store.list()[0]!.file).map((l) => l.event)
    expect(events).toContain('resync_requested')
    expect(events).toContain('resync_failed')
  } finally {
    jest.useRealTimers()
  }
})

test('a huge jump or a step going backwards is still a hard cheat verdict', () => {
  jest.useFakeTimers()
  try {
    const store = new MatchLogStore({ dir, now })
    const { guest, bot, sendLock } = playRoom(store)
    bot.play(1)
    sendLock({ ...bot.locks[0], globalStep: MP_CONFIG.resyncMaxGap + 5 })
    expect(guest.of(ServerMsgType.ResyncRequest)).toEqual([])
    expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.InvalidMove)
  } finally {
    jest.useRealTimers()
  }
})

test('an unparseable report says which field broke — to the client and into the match log', () => {
  jest.useFakeTimers()
  try {
    const store = new MatchLogStore({ dir, now })
    const { guest, bot, sendLock } = playRoom(store)
    bot.play(2)
    sendLock(bot.locks[0]) // step 1 is fine
    // The PRA4 shape: a report the server could not parse at all. Before this test the answer to
    // "which field, exactly?" was unobtainable, and the player was told they had cheated.
    sendLock({ ...bot.locks[1], x: -1 })
    const err = guest.lastOf(ServerMsgType.Error)
    expect(err.payload).toMatchObject({
      code: MpErrorCode.BadRequest,
      field: 'x',
      value: '-1',
      step: bot.locks[1].globalStep,
    })
    expect(err.payload.message).toContain('x=-1')
    // A report we cannot read is a bug report, not a cheat: the socket and the match stay alive.
    expect(guest.of(ServerMsgType.MatchOver)).toEqual([])
    expect(guest.terminated).toBe(false)
    sendLock(bot.locks[1]) // the honest retry lands, sequence continues
    expect(guest.of(ServerMsgType.ResyncRequest)).toEqual([])

    const lines = store.readLines(store.list()[0]!.file)
    const broken = lines.find((l) => l.event === 'malformed_lock')
    expect(broken?.data).toMatchObject({ field: 'x', value: '-1', step: bot.locks[1].globalStep })
    expect(String(broken?.data.raw)).toContain('"x":-1')
  } finally {
    jest.useRealTimers()
  }
})

test('a player whose seat was removed after a technical forfeit can join the room again', () => {
  jest.useFakeTimers()
  try {
    const store = new MatchLogStore({ dir, now })
    const { server, host, guest, bot, sendLock, code } = playRoom(store)

    // While the match runs, the room is closed to newcomers — that rule stays.
    const watcher = new FakeSocket()
    server.handleConnection(watcher)
    watcher.emitMessage({ type: ClientMsgType.JoinRoom, payload: { code, name: 'Зритель' } })
    expect(watcher.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.BadPhase)

    // Burn the match down to a technical forfeit: the seat is removed and the socket terminated.
    bot.play(2)
    sendLock(bot.locks[0])
    sendLock({ ...bot.locks[1], globalStep: bot.locks[1].globalStep + 2 })
    clock += MP_CONFIG.resyncGraceMs + 1
    jest.advanceTimersByTime(MP_CONFIG.resyncGraceMs + 1)
    expect(guest.lastOf(ServerMsgType.MatchOver).payload.detail).toBe('invalid_move')

    // PRA4 dead end: the loser pressed «В комнату», lost the ticket, then tried to enter by code and
    // was refused because the room stood in `over`. A free seat in a finished room must be joinable —
    // and pressing «Готов» there reopens the lobby for everyone.
    const back = new FakeSocket()
    server.handleConnection(back)
    back.emitMessage({ type: ClientMsgType.JoinRoom, payload: { code, name: 'Проигравший' } })
    const created = back.lastOf(ServerMsgType.RoomCreated)
    expect(created).toBeTruthy()
    expect(created.payload.room.phase).toBe('over')
    expect(created.payload.room.players.map((p: { name: string }) => p.name)).toEqual(['Хост', 'Проигравший'])

    back.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
    expect(host.lastOf(ServerMsgType.RoomSnapshot).payload.room.phase).toBe('lobby')
  } finally {
    jest.useRealTimers()
  }
})
