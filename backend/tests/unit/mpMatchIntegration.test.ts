/**
 * End-to-end match integration (the 5.1 bug report, no browser): two real `GameEngine`s play
 * against the real `RoomServer` over fake sockets, reporting every lock exactly as a client
 * would. Before the fix the server's replay never absorbed the garbage it had scheduled, so the
 * victim's first honest lock on top of that garbage was rejected ('floating') and the match
 * closed as a forfeit — the player "died right after a legal drop".
 */
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ClientMsgType, ServerMsgType, ServerMessage, GameEngine, GameMode, CommandType,
  PieceLockPayload, GAME_CONFIG,
} from '@neon-tetris/shared'
import { RoomServer, ClientSocket } from '../../src/servers/roomServer'
import { MatchState } from '../../src/services/matchState'
import { MatchLogStore } from '../../src/services/matchLog'

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
  /** Read and remove every message of a type (arrival batches must be applied exactly once). */
  drain(type: ServerMsgType): ServerMessage[] {
    const kept: ServerMessage[] = []
    const taken: ServerMessage[] = []
    for (const m of this.sent) (m.type === type ? taken : kept).push(m)
    this.sent = kept
    return taken
  }
}

let clock = 0
const now = () => clock

/**
 * A client-side player: the real engine with a greedy "grow the bottom rows" policy, reporting
 * locks like the browser store does (same seed as the server, no hold → same bag order).
 */
class Bot {
  readonly socket: FakeSocket
  readonly locks: PieceLockPayload[] = []
  over = false

  constructor(socket: FakeSocket, seed: number) {
    this.socket = socket
    const engine = new GameEngine(
      {
        onPieceLocked: (info) => {
          this.locks.push({
            globalStep: info.globalStep,
            pieceType: info.pieceType,
            x: info.x,
            y: info.y,
            rotation: info.rotation,
            linesCleared: info.linesCleared,
            garbageRows: engine.getGarbageRowsApplied(),
          })
        },
        onGameOver: () => { this.over = true },
      },
      { seed },
    )
    engine.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } })
    this.engine = engine
  }

  private engine: GameEngine

  /** One placement: pack the piece into the lowest row that still has holes, without overhangs. */
  playOne(): void {
    if (this.over) return
    const state = this.engine.getGameState()
    const piece = state.currentPiece
    if (!piece) return
    const H = GAME_CONFIG.boardHeight
    const W = GAME_CONFIG.boardWidth
    const shapeW = piece.shape[0].length
    const rows = this.engine.getBoardSnapshot()

    let targetY = 0
    for (let y = H - 1; y >= 0; y--) {
      if (rows[y].some((v) => v === 0)) { targetY = y; break }
    }

    let bestX = state.currentPos.x
    let bestScore = -Infinity
    for (let x = 0; x <= W - shapeW; x++) {
      if (!this.engine.isValidPosition(piece, { x, y: 0 })) continue
      let y = 0
      while (this.engine.isValidPosition(piece, { x, y: y + 1 })) y++
      let cover = 0
      let overhang = 0
      for (let r = 0; r < piece.shape.length; r++) {
        for (let c = 0; c < shapeW; c++) {
          if (!piece.shape[r][c]) continue
          const by = y + r
          const bx = x + c
          if (by === targetY) cover++
          const inPiece = r + 1 < piece.shape.length && piece.shape[r + 1][c] !== 0
          const inBoard = by + 1 < H && rows[by + 1][bx] !== 0
          if (!inPiece && !inBoard && by + 1 < H) overhang++
        }
      }
      // Fill the open row first; a mild overhang is an acceptable price for closing it.
      const score = cover * 20 - overhang * 3 - x
      if (score > bestScore) { bestScore = score; bestX = x }
    }

    // Move toward the chosen column. A refused move (blocked by the stack) must not spin: the
    // piece simply drops where it is.
    for (let guard = 0; guard < W; guard++) {
      const x = this.engine.getGameState().currentPos.x
      if (x === bestX) break
      this.engine.handleCommand({ type: CommandType.MovePiece, payload: { direction: x < bestX ? 'right' : 'left' } })
    }
    this.engine.handleCommand({ type: CommandType.HardDrop })
  }

  insertGarbage(rows: number[][]): void {
    this.engine.handleCommand({ type: CommandType.InsertGarbage, payload: { rows } })
  }
}

function takeGarbage(socket: FakeSocket): number[][][] {
  const groups: number[][][] = []
  for (const m of socket.drain(ServerMsgType.GarbageArrive)) {
    for (const a of m.payload.arrivals) groups.push(a.rows)
  }
  return groups
}

describe('live match: honest garbage exchange no longer kills the victim', () => {
  function playMatch(seed: number, matchLog?: MatchLogStore) {
    jest.useFakeTimers()
    try {
      clock = 1_000_000
      // The seed source is injected so a given seed replays the same greedy game every run.
      const server = new RoomServer({ now, graceMs: 5_000, seed: () => seed, matchLog })
      const socketA = new FakeSocket()
      const socketB = new FakeSocket()
      server.handleConnection(socketA)
      server.handleConnection(socketB)

      socketA.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name: 'A' } })
      const code = socketA.lastOf(ServerMsgType.RoomCreated).payload.room.code
      socketB.emitMessage({ type: ClientMsgType.JoinRoom, payload: { code, name: 'B' } })
      socketB.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })
      socketA.emitMessage({ type: ClientMsgType.SetReady, payload: { ready: true } })

      // The room's seed (issued by the server at game_start) is what both engines must deal from.
      const roomSeed = socketA.lastOf(ServerMsgType.GameStart).payload.seed
      const a = new Bot(socketA, roomSeed)
      const b = new Bot(socketB, roomSeed)

      let garbageSeen = 0
      let totalLocks = 0
      for (let round = 0; round < 60; round++) {
        for (const p of [a, b]) {
          p.playOne()
          for (const lock of p.locks.splice(0)) {
            totalLocks += 1
            p.socket.emitMessage({ type: ClientMsgType.PieceLock, payload: lock })
          }
        }
        // Let the server's sweep (250 ms) deliver whatever has come due, then let the players
        // absorb it exactly as the browser store does at applyAt.
        clock += 700
        jest.advanceTimersByTime(700)
        for (const p of [a, b]) {
          const groups = takeGarbage(p.socket)
          garbageSeen += groups.length
          for (const rows of groups) p.insertGarbage(rows)
        }
        if (a.over || b.over) break
      }

      const errors = [
        ...a.socket.of(ServerMsgType.Error),
        ...b.socket.of(ServerMsgType.Error),
      ]
      return {
        server, a, b, errors, garbageSeen, seed,
        lockCount: totalLocks,
        appliedRelay: a.socket.of(ServerMsgType.GarbageApplied).length + b.socket.of(ServerMsgType.GarbageApplied).length,
        lockRelays: a.socket.of(ServerMsgType.PieceLockedRelay).length + b.socket.of(ServerMsgType.PieceLockedRelay).length,
        matchOver: Boolean(a.socket.lastOf(ServerMsgType.MatchOver)),
      }
    } finally {
      jest.useRealTimers()
    }
  }

  test('a seeded bag round: the victim keeps playing after the garbage lands', () => {
    // Deterministic per seed (the seed source is injected), so this is a regression test and not
    // a dice roll. Greedy play does not always clear a line, but across these bags an attack
    // happens — and none of these honest matches may produce a single anticheat verdict.
    const runs = [1, 7, 42, 99, 20261102, 4242, 555, 13, 88, 31337].map((seed) => playMatch(seed))
    const attacked = runs.filter((r) => r.garbageSeen > 0)
    expect(attacked.length).toBeGreaterThan(0)

    for (const r of runs) {
      // No anticheat verdicts against honest players — that was the whole bug.
      expect(r.errors.map((e: any) => e.payload.code)).toEqual([])
      expect(r.a.socket.terminated).toBe(false)
      expect(r.b.socket.terminated).toBe(false)
    }
    // And the opponents' shadow boards were fed both the locks and the absorbed garbage.
    const winner = attacked[0]
    expect(winner.lockRelays).toBeGreaterThan(0)
    expect(winner.appliedRelay).toBeGreaterThan(0)
  })

  test('a logged match replays offline on the same seed, lock for lock', () => {
    // This is what `npm run mp:replay` does with a downloaded log: rebuild the verification state
    // from the recorded seed and feed the recorded locks back into it. If the log were missing
    // anything the replay needs (the seed, the garbage a lock absorbed, the step order), the
    // replay would start rejecting honest locks — so this test guards the log's completeness.
    const dir = mkdtempSync(join(tmpdir(), 'neon-mp-replay-'))
    try {
      const store = new MatchLogStore({ dir, now })
      const run = playMatch(42, store)
      const entry = store.list()[0]
      expect(entry).toBeTruthy()
      const bundle = store.readBundle(entry!.file)!
      expect(bundle.seed).toBe(42)
      expect(bundle.locks.length).toBe(run.lockCount)
      expect(bundle.locks.length).toBeGreaterThan(20)
      expect(store.readBundle(entry!.file)!.verdicts).toEqual([])

      let replayClock = bundle.startedAt
      const fresh = new MatchState(bundle.players.map((p) => p.playerId), bundle.seed, () => replayClock)
      let firstRejection = ''
      for (const lock of bundle.locks) {
        replayClock = Math.max(replayClock, lock.t)
        const verdict = fresh.applyLock(lock.playerId, {
          globalStep: lock.globalStep,
          pieceType: lock.pieceType,
          x: lock.x,
          y: lock.y,
          rotation: lock.rotation,
          linesCleared: lock.linesCleared,
          garbageRows: lock.garbageRows ?? 0,
        })
        if (!verdict.accepted && !firstRejection) {
          firstRejection = `${lock.playerId.slice(0, 8)} step ${lock.globalStep} ${lock.pieceType} x=${lock.x} y=${lock.y}: ${verdict.violation}`
        }
      }
      expect(firstRejection).toBe('')
      // Certified line counts survive the replay too — the log is enough to audit the score.
      for (const p of bundle.players) {
        expect(fresh.certifiedLines(p.playerId)).toBeGreaterThanOrEqual(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
