/**
 * MP block D — the server-side match simulation ("the replay"). The server owns the same
 * seeded 7-bag the clients deal from, so every reported `piece_lock` is checked against the
 * server's own board before it counts: piece identity (bag/spawn/hold), bounds, overlap,
 * support, and the cleared-line count. Accepted locks drive the battle pipeline: combo
 * multipliers, perfect-clear bonuses/immunity, counteract and the delayed garbage queue —
 * all numbers from `config/mpBalance.ts` (mirrors design.game/02_GAME_CONFIG.json).
 *
 * Hold tracking needs no client flag: a lock is legal when the locked piece equals either
 * the step's spawned piece or the piece the server believes sits in this player's hold slot
 * (an even number of hold presses nets out to "spawned", an odd number to "held" — exactly
 * what the client did, whatever the timing).
 */
import {
  BoardManager, GAME_CONFIG, PieceFactoryProvider, PieceLockPayload, PieceType,
  PIECE_SHAPES, buildPiece, GarbageArrival,
} from '@neon-tetris/shared'
import { MP_BALANCE } from '../config/mpBalance'

const BOARD_W = GAME_CONFIG.boardWidth
const BOARD_H = GAME_CONFIG.boardHeight

export type LockVerdict =
  | {
      accepted: true
      cleared: number
      perfect: boolean
      sentTo: { playerId: string; lines: number; applyAt: number }[]
    }
  | { accepted: false; violation: string }

interface SimPlayer {
  board: BoardManager
  factory: PieceFactoryProvider
  step: number
  spawned: PieceType | null
  held: PieceType | null
  combo: number
  pending: GarbageArrival[]
  lastPerfectAt: number
  /** Certified clears observed by the server itself — feeds MatchResult.lines. */
  linesCleared: number
}

export class MatchState {
  private sims = new Map<string, SimPlayer>()
  private readonly now: () => number
  private readonly rng: () => number
  private readonly verify: boolean

  /**
   * `verify:false` exists for tests that set boards up directly (debugInjectBoard) instead of
   * replaying a full human-quality bag sequence; bounds/support/line-count checks always run.
   */
  constructor(
    playerIds: string[],
    seed: number,
    now: () => number,
    rng: () => number = Math.random,
    verify = true,
  ) {
    this.now = now
    this.rng = rng
    this.verify = verify
    for (const id of playerIds) {
      const factory = new PieceFactoryProvider({ seed })
      this.sims.set(id, {
        board: new BoardManager(BOARD_W, BOARD_H),
        factory,
        step: 0,
        spawned: factory.nextPieceType(), // the first spawn happens at game start
        held: null,
        combo: 0,
        pending: [],
        lastPerfectAt: Number.NEGATIVE_INFINITY,
        linesCleared: 0,
      })
    }
  }

  /** All garbage currently scheduled against a player (a mid-match rejoin resyncs from this). */
  pendingFor(playerId: string): GarbageArrival[] {
    const sp = this.sims.get(playerId)
    return sp ? [...sp.pending] : []
  }

  /**
   * Dequeue every arrival for a player (mid-match rejoin: the client reschedules them all,
   * past applyAt means "insert now"). Immunity is deliberately not applied here — these rows
   * were scheduled before the outage and must not silently vanish.
   */
  claimAllArrivals(playerId: string): GarbageArrival[] {
    const sp = this.sims.get(playerId)
    if (!sp) return []
    const all = sp.pending
    sp.pending = []
    return all
  }

  /**
   * Pull every arrival whose applyAt has come: perfect-clear immunity drops them outright
   * (config immunity_duration_ms), everything else is delivered and dequeued.
   */
  takeDueArrivals(playerId: string, now: number): GarbageArrival[] {
    const sp = this.sims.get(playerId)
    if (!sp) return []
    const due: GarbageArrival[] = []
    sp.pending = sp.pending.filter((a) => {
      if (a.applyAt > now) return true
      if (now - sp.lastPerfectAt < MP_BALANCE.perfectClearImmunityMs) {
        return false // absorbed by the post-perfect-clear immunity
      }
      due.push(a)
      return false
    })
    return due
  }

  certifiedLines(playerId: string): number | null {
    return this.sims.get(playerId)?.linesCleared ?? null
  }

  /** Test-only board setup (see the constructor's `verify` flag). Not used by production code. */
  debugInjectBoard(playerId: string, grid: number[][]): void {
    const sp = this.sims.get(playerId)
    if (!sp) return
    sp.board.reset()
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        const v = grid[y]?.[x] ?? 0
        if (v !== 0) sp.board.setCell(x, y, v, true)
      }
    }
  }

  /**
   * Verify and apply one reported lock. Strict step order is required: a rejoining client
   * retransmits whatever it sent while the socket was down, so gaps are the reporter's bug
   * (or cheating) — never a reason to trust the board less.
   */
  applyLock(playerId: string, lock: PieceLockPayload): LockVerdict {
    const sp = this.sims.get(playerId)
    if (!sp) return { accepted: false, violation: 'player' }
    if (lock.globalStep !== sp.step + 1) return { accepted: false, violation: `step ${lock.globalStep} != ${sp.step + 1}` }

    const shape = PIECE_SHAPES[lock.pieceType]?.[lock.rotation]
    if (!shape) return { accepted: false, violation: 'rotation' }

    // Piece identity, mirroring the engine's bag/hold bookkeeping:
    //  - a hold press on an EMPTY slot makes the engine pull one extra bag piece; the client
    //    reports that via holdExtra and we consume the extra pull here the same way;
    //  - the locked piece must then be the current hand (spawned) or the remembered held
    //    piece (an odd number of slot swaps); swaps with a filled slot consume no pulls.
    if (this.verify) {
      if (lock.holdExtra) {
        sp.held = sp.spawned
        sp.spawned = sp.factory.nextPieceType()
      }
      if (lock.pieceType === sp.spawned) {
        // legal: the queue's piece (possibly with an even number of hold presses netted out)
      } else if (sp.held !== null && lock.pieceType === sp.held) {
        sp.held = sp.spawned // the queued/spawned piece lands in the hold slot instead
      } else {
        return { accepted: false, violation: `piece ${lock.pieceType} (spawned ${sp.spawned}, held ${sp.held})` }
      }
    }

    // Bounds + overlap on the server's own board.
    const cells: { x: number; y: number }[] = []
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue
        const x = lock.x + c
        const y = lock.y + r
        if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) return { accepted: false, violation: 'oob' }
        if (sp.board.getCell(x, y).value !== 0) return { accepted: false, violation: 'overlap' }
        cells.push({ x, y })
      }
    }

    // Support: at least one cell under the piece must be floor/solid (no mid-air freezes).
    const supported = cells.some((cell) => {
      const below = sp.board.getCell(cell.x, cell.y + 1)
      return cell.y + 1 >= BOARD_H || below.value !== 0
    })
    if (!supported) return { accepted: false, violation: 'floating' }

    // Apply on the server board; the clear count must match the report exactly.
    sp.board.setCells(buildPiece(lock.pieceType, shape), { x: lock.x, y: lock.y })
    const cleared = sp.board.clearLines()
    if (cleared !== lock.linesCleared) {
      return { accepted: false, violation: `lines ${lock.linesCleared} != ${cleared}` }
    }

    sp.step += 1
    sp.linesCleared += cleared
    if (this.verify) sp.spawned = sp.factory.nextPieceType()

    if (cleared === 0) {
      sp.combo = 0
      return { accepted: true, cleared: 0, perfect: false, sentTo: [] }
    }

    sp.combo += 1
    const perfect = this.isBoardEmpty(sp)
    if (perfect) sp.lastPerfectAt = this.now()

    // Counteract first: self-cleared lines eat the oldest incoming garbage (ratio 1.0).
    let credit = cleared * MP_BALANCE.counteractRatio
    while (credit > 0 && sp.pending.length > 0) {
      const [oldest, ...rest] = sp.pending
      sp.pending = rest
      credit -= oldest.rows.length
    }

    // Attack: base lines × combo multiplier (ceil), + perfect-clear bonus; queued per victim
    // behind the per-player pending cap.
    const base = MP_BALANCE.baseLines[cleared] ?? MP_BALANCE.baseLines[4]
    let lines = Math.ceil(base * MP_BALANCE.comboMultiplier(sp.combo))
    if (perfect) lines += MP_BALANCE.perfectClearBonus
    const applyAt = this.now() + MP_BALANCE.delayFor(cleared, perfect)
    const sentTo: { playerId: string; lines: number; applyAt: number }[] = []
    for (const [victimId, victim] of this.sims) {
      if (victimId === playerId) continue
      const room = MP_BALANCE.perPlayerGarbageCap - this.pendingRows(victim)
      const n = Math.min(lines, Math.max(0, room))
      if (n <= 0) continue
      victim.pending.push({ rows: this.makeGarbageRows(n), applyAt })
      sentTo.push({ playerId: victimId, lines: n, applyAt })
    }
    return { accepted: true, cleared, perfect, sentTo }
  }

  private pendingRows(sp: SimPlayer): number {
    return sp.pending.reduce((sum, a) => sum + a.rows.length, 0)
  }

  private isBoardEmpty(sp: SimPlayer): boolean {
    return sp.board.getSnapshot().every((row) => row.every((v) => v === 0))
  }

  /** `n` garbage rows (bottom-to-top), one random hole each, random garbage colors. */
  private makeGarbageRows(n: number): number[][] {
    const rows: number[][] = []
    for (let i = 0; i < n; i++) {
      const hole = Math.floor(this.rng() * BOARD_W)
      const row: number[] = []
      for (let x = 0; x < BOARD_W; x++) {
        row.push(x === hole ? 0 : 1 + Math.floor(this.rng() * 7))
      }
      rows.push(row)
    }
    return rows
  }
}
