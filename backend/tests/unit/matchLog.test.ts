/**
 * MP match logging: the record that answers "what actually happened in that match" — written as
 * append-only JSONL per match, read back through the log API and replayable offline.
 */
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import express from 'express'
// @types/supertest is not installed in this workspace, so the import is untyped.
import request from 'supertest'
import { ClientMsgType, ServerMsgType, ServerMessage, MpErrorCode, PieceFactoryProvider } from '@neon-tetris/shared'
import { MatchLogStore, bundleFromLines, readBundleFromText, isSafeLogFileName } from '../../src/services/matchLog'
import { createMpLogRouter } from '../../src/routes/mpLogRouter'
import { RoomServer, ClientSocket } from '../../src/servers/roomServer'

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

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'neon-mp-logs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('MatchLogStore', () => {
  test('a match opens a file whose first line carries the seed and the roster', () => {
    const store = new MatchLogStore({ dir })
    store.startMatch({
      code: 'AB12', seed: 4242, startTime: 1000,
      players: [{ playerId: 'p1', name: 'Аня', playerIndex: 0 }, { playerId: 'p2', name: 'Борь', playerIndex: 1 }],
    })
    store.event('AB12', 'piece_lock', 'p1', { lock: { globalStep: 1, pieceType: 'I', x: 3, y: 17, rotation: 0, linesCleared: 0, garbageRows: 0 }, accepted: true })
    store.event('AB12', 'piece_lock', 'p1', { lock: { globalStep: 2, pieceType: 'O', x: 0, y: 18, rotation: 0, linesCleared: 0, garbageRows: 0 }, accepted: false, violation: 'floating' })
    store.event('AB12', 'garbage_delivered', 'p2', { arrivals: [{ applyAt: 900, rows: [[0, 0, 4]] }] })
    store.event('AB12', 'match_over', 'p2', { reason: 'forfeit', detail: 'invalid_move', winnerId: 'p2', results: [] })
    store.close('AB12', { reason: 'forfeit', detail: 'invalid_move', winnerId: 'p2' })

    const [entry] = store.list()
    expect(entry.code).toBe('AB12')
    expect(entry.seed).toBe(4242)
    expect(entry.closed).toBe(true)
    expect(entry.verdict).toEqual({ reason: 'forfeit', detail: 'invalid_move', winnerId: 'p2' })
    expect(entry.events).toBe(6)
    expect(isSafeLogFileName(entry.file)).toBe(true)
    expect(existsSync(join(dir, entry.file))).toBe(true)

    const lines = store.readLines(entry.file)
    expect(lines.map((l) => l.event)).toEqual([
      'match_start',
      'piece_lock',
      'piece_lock',
      'garbage_delivered',
      'match_over',
      'match_closed', // the closure is on disk too: a restart rebuilds `closed` from it
    ])
    expect(lines[0].data).toMatchObject({ seed: 4242, startTime: 1000 })
    expect(lines[0].data).toMatchObject({ players: [{ name: 'Аня' }, { name: 'Борь' }] })

    const bundle = store.readBundle(entry.file)!
    expect(bundle.seed).toBe(4242)
    expect(bundle.locks).toHaveLength(1)
    expect(bundle.locks[0]).toMatchObject({ playerId: 'p1', pieceType: 'I', globalStep: 1 })
    expect(bundle.verdicts).toHaveLength(1)
    expect(bundle.verdicts[0].violation).toBe('floating')
    expect(bundle.garbage).toEqual([{ targetId: 'p2', applyAt: 900, groups: [[[0, 0, 4]]] }])
    expect(bundle.ends).toEqual([{ reason: 'forfeit', detail: 'invalid_move', winnerId: 'p2', t: expect.any(Number) }])
  })

  test('the index is rebuilt from disk (a restart keeps the history readable)', () => {
    const first = new MatchLogStore({ dir })
    first.startMatch({ code: 'QQ22', seed: 7, startTime: 1, players: [{ playerId: 'p1', name: 'A', playerIndex: 0 }] })
    first.event('QQ22', 'surrender', 'p1', { claimedCause: 'button' })
    first.close('QQ22', { reason: 'surrender', detail: 'surrender_button', winnerId: null })

    const reopened = new MatchLogStore({ dir })
    expect(reopened.list()).toHaveLength(1)
    expect(reopened.list()[0]).toMatchObject({ code: 'QQ22', seed: 7, closed: true })
    expect(reopened.list()[0]!.verdict!.detail).toBe('surrender_button')
  })

  test('a rematch opens a new file, and old files are pruned past maxFiles', () => {
    const store = new MatchLogStore({ dir, maxFiles: 2 })
    for (const seed of [1, 2, 3]) {
      store.startMatch({ code: 'RM01', seed, startTime: 0, players: [] })
      store.event('RM01', 'match_over', undefined, { reason: 'survival' })
      store.close('RM01', { reason: 'survival' })
    }
    expect(store.list().map((m) => m.seed)).toEqual([3, 2]) // newest first, the oldest file is gone
  })

  test('a disabled store writes nothing and never breaks the caller', () => {
    const store = new MatchLogStore({ dir, enabled: false })
    store.startMatch({ code: 'XY99', seed: 1, startTime: 0, players: [] })
    store.event('XY99', 'piece_lock', 'p1', { lock: {}, accepted: true })
    expect(store.list()).toEqual([])
    expect(readdirSync(dir)).toEqual([]) // not one file written
  })

  test('file names from outside the allowed shape are refused (no path traversal)', () => {
    const store = new MatchLogStore({ dir })
    for (const bad of ['../../etc/passwd', 'a.jsonl', '', '2026-11-02-ab12-1793575893710.jsonl', '2026-11-02-AB12-123.jsonl']) {
      expect(isSafeLogFileName(bad)).toBe(false)
      expect(store.readLines(bad)).toEqual([])
    }
  })

  test('a torn last line (crash mid-append) is skipped, not fatal', () => {
    const store = new MatchLogStore({ dir })
    store.startMatch({ code: 'TC01', seed: 3, startTime: 0, players: [] })
    const [entry] = store.list()
    const { appendFileSync } = require('fs') as typeof import('fs')
    appendFileSync(join(dir, entry!.file), '{"t":1,"room":"TC01","eve')
    expect(store.readLines(entry!.file).map((l) => l.event)).toEqual(['match_start'])
  })

  test('readBundleFromText accepts the JSONL body, {lines} JSON and the replay JSON', () => {
    const store = new MatchLogStore({ dir })
    store.startMatch({ code: 'FW01', seed: 5, startTime: 0, players: [{ playerId: 'p1', name: 'A', playerIndex: 0 }] })
    store.event('FW01', 'piece_lock', 'p1', { lock: { globalStep: 1, pieceType: 'T', x: 4, y: 18, rotation: 0, linesCleared: 1, garbageRows: 0 }, accepted: true })
    const entry = store.list()[0]!

    const fromText = readBundleFromText(readFileSync(join(dir, entry.file), 'utf-8'))
    expect(fromText!.locks[0]).toMatchObject({ pieceType: 'T', linesCleared: 1 })
    expect(bundleFromLines(store.readLines(entry.file))!.seed).toBe(5)
    expect(readBundleFromText(JSON.stringify({ file: entry.file, ...store.readBundle(entry.file)! }))!.code).toBe('FW01')
    expect(readBundleFromText('{"lines":[]}')).toBeNull()
  })
})

describe('the MP log API', () => {
  function app(token?: string) {
    const store = new MatchLogStore({ dir })
    store.startMatch({ code: 'API1', seed: 11, startTime: 0, players: [{ playerId: 'p1', name: 'A', playerIndex: 0 }] })
    store.event('API1', 'piece_lock', 'p1', { lock: { globalStep: 1, pieceType: 'I', x: 3, y: 17, rotation: 0, linesCleared: 0, garbageRows: 0 }, accepted: true })
    const expressApp = express()
    expressApp.use('/api/mp', createMpLogRouter(store, { adminToken: token }))
    return { expressApp, store }
  }

  test('no token configured → the whole API is closed (503), logs stay SSH-only', async () => {
    const { expressApp } = app()
    const res = await request(expressApp).get('/api/mp/matches')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ error: 'mp_logs_disabled' })
  })

  test('a missing or wrong token is 401', async () => {
    const { expressApp } = app('s3cret')
    expect((await request(expressApp).get('/api/mp/matches')).status).toBe(401)
    expect((await request(expressApp).get('/api/mp/matches?token=nope').set('authorization', 'Bearer nope')).status).toBe(401)
  })

  test('the index, the raw JSONL and the replay bundle are all readable with the token', async () => {
    const { expressApp, store } = app('s3cret')
    const list = await request(expressApp).get('/api/mp/matches?token=s3cret')
    expect(list.status).toBe(200)
    const file = list.body.matches[0].file
    expect(list.body.matches[0]).toMatchObject({ code: 'API1', seed: 11, events: 2 })

    const raw = await request(expressApp).get(`/api/mp/matches/${file}`).set('authorization', 'Bearer s3cret')
    expect(raw.status).toBe(200)
    expect(raw.headers['content-type']).toContain('text/plain')
    expect(raw.text.split('\n').filter(Boolean)).toHaveLength(2)

    const replay = await request(expressApp).get(`/api/mp/matches/${file}/replay?token=s3cret`)
    expect(replay.status).toBe(200)
    expect(replay.body.seed).toBe(11)
    expect(replay.body.locks[0]).toMatchObject({ pieceType: 'I', playerId: 'p1' })

    expect((await request(expressApp).get(`/api/mp/matches/${file}?token=s3cret&format=json`)).body.lines[0].event).toBe('match_start')
    expect((await request(expressApp).get('/api/mp/matches/nope.jsonl?token=s3cret')).status).toBe(400)
    void store
  })
})

describe('a played match leaves the whole story in the log', () => {
  test('locks, the anticheat verdict, the socket drop and the reason all land on disk', () => {
    jest.useFakeTimers()
    try {
      let clock = 1_000_000
      const now = () => clock
      const store = new MatchLogStore({ dir, now })
      const server = new RoomServer({ now, graceMs: 5_000, seed: () => 777, matchLog: store })
      const host = new FakeSocket()
      const guest = new FakeSocket()
      server.handleConnection(host)
      server.handleConnection(guest)
      host.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name: 'Хост' } })
      const code = host.lastOf(ServerMsgType.RoomCreated).payload.room.code
      guest.emitMessage({ type: ClientMsgType.JoinRoom, payload: { code, name: 'Гость' } })
      guest.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
      host.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })

      // A wrong-bag lock: the replay rejects it, the server closes the match and the seat.
      const firstFromBag = new PieceFactoryProvider({ seed: 777 }).nextPieceType()
      const wrongPiece = firstFromBag === 'O' ? 'I' : 'O'
      guest.emitMessage({
        type: ClientMsgType.PieceLock,
        payload: { globalStep: 1, pieceType: wrongPiece, x: 0, y: 18, rotation: 0, linesCleared: 0, garbageRows: 0 },
      })
      expect(guest.lastOf(ServerMsgType.Error).payload.code).toBe(MpErrorCode.InvalidMove)
      clock += 100
      guest.emit('close')
      jest.advanceTimersByTime(5_001)

      const entry = store.list()[0]
      expect(entry.code).toBe(code)
      expect(entry.seed).toBe(777)
      const lines = store.readLines(entry.file)
      const events = lines.map((l) => l.event)
      expect(events.slice(0, 5)).toEqual(['match_start', 'piece_lock', 'match_over', 'match_closed', 'socket_closed'])
      expect(events.filter((e) => e === 'grace_expired').length).toBeGreaterThan(0)
      const lock = lines.find((l) => l.event === 'piece_lock')!
      expect(lock.data).toMatchObject({ accepted: false })
      expect((lock.data as { violation: string }).violation).toMatch(/spawned|held/i)
      expect((lock.data as { lock: { pieceType: string } }).lock.pieceType).toBe(wrongPiece)
      const over = lines.find((l) => l.event === 'match_over')!
      expect(over.data).toMatchObject({ reason: 'forfeit', detail: 'invalid_move' })
      expect(lines.find((l) => l.event === 'socket_closed')!.data).toMatchObject({ phase: 'over' })
      expect(store.readBundle(entry.file)!.verdicts[0].violation).toMatch(/spawned/i)
    } finally {
      jest.useRealTimers()
    }
  })
})
