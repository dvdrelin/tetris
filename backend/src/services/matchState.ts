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
import { MP_CONFIG } from '../config/mpConfig'

const BOARD_W = GAME_CONFIG.boardWidth
const BOARD_H = GAME_CONFIG.boardHeight

/** Rows a line clear actually created against a victim. Logged so a replay can *verify* row
 *  contents instead of regenerating them from its own RNG stream (that divergence used to read as
 *  "the player lied" — see the 5QBH post-mortem). */
export interface GarbageScheduled {
  victimId: string
  rows: number[][]
  applyAt: number
}

/** Rows that were requested or scheduled but will never reach the client: eaten by counteract,
 *  dropped by perfect-clear immunity, or cut off by the pending cap. They still consumed the RNG
 *  stream, which is exactly what makes a replay's garbage rows drift if they are not logged. */
export interface GarbageCancelled {
  victimId: string
  by: 'counteract' | 'immunity' | 'cap'
  count: number
  rows?: number[][]
}

export type LockVerdict =
  | {
      accepted: true
      cleared: number
      perfect: boolean
      sentTo: { playerId: string; lines: number; applyAt: number }[]
      /** Row groups this player absorbed at this very report (for the opponents' shadow boards). */
      appliedGarbage: number[][][]
      scheduled: GarbageScheduled[]
      cancelled: GarbageCancelled[]
    }
  | {
      accepted: false
      violation: string
      /**
       * Forward step gap (client is ahead by a few of its own locks): not a cheat verdict yet,
       * just a lost/dropped report. The room server asks the client to retransmit the missing
       * steps and only forfeits if that does not arrive (`MP_CONFIG.resyncGraceMs`).
       */
      gap?: { expectedStep: number; gotStep: number }
    }

interface SimPlayer {
  board: BoardManager
  factory: PieceFactoryProvider
  step: number
  spawned: PieceType | null
  held: PieceType | null
  combo: number
  /** Scheduled but not yet handed to the client: counteract and PC-immunity may still drop these. */
  pending: GarbageArrival[]
  /** Handed to the client (delivered or claimed on rejoin) but not yet absorbed by the replay board. */
  delivered: GarbageArrival[]
  /** Garbage rows already present on the replay board — the mirror of the client's own counter. */
  appliedRows: number
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
        delivered: [],
        appliedRows: 0,
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
    sp.delivered.push(...all) // the client inserts them, so the replay board must absorb them too
    return all
  }

  /**
   * Pull every arrival whose applyAt has come: perfect-clear immunity drops them outright
   * (config immunity_duration_ms), everything else is delivered and dequeued. The dropped ones are
   * reported too — they were generated by the RNG, and a replay that does not know about them
   * drifts into bogus "overlap/floating" verdicts later in the match.
   */
  takeDueArrivals(playerId: string, now: number): { delivered: GarbageArrival[]; cancelled: GarbageCancelled[] } {
    const sp = this.sims.get(playerId)
    if (!sp) return { delivered: [], cancelled: [] }
    const due: GarbageArrival[] = []
    const cancelled: GarbageCancelled[] = []
    sp.pending = sp.pending.filter((a) => {
      if (a.applyAt > now) return true
      if (now - sp.lastPerfectAt < MP_BALANCE.perfectClearImmunityMs) {
        cancelled.push({ victimId: playerId, by: 'immunity', count: a.rows.length, rows: a.rows })
        return false // absorbed by the post-perfect-clear immunity
      }
      due.push(a)
      return false
    })
    // Delivered means "the client will insert these" — the replay board absorbs them only when
    // the client's next reports say it did (see applyReportedGarbage).
    sp.delivered.push(...due)
    return { delivered: due, cancelled }
  }

  /**
   * Geometry-only fingerprint of a player's replay board (occupancy + certified lines + absorbed
   * garbage rows + step). Colors are deliberately excluded: two boards that differ only in garbage
   * cell colors are the same board for every rule the replay enforces, and an RNG drift in colors
   * must not look like a divergence.
   */
  boardDigest(playerId: string): string {
    const sp = this.sims.get(playerId)
    if (!sp) return '-'
    let h = 0x811c9dc5 >>> 0
    const feed = (n: number): void => {
      h ^= n & 0xff
      h = Math.imul(h, 0x01000193) >>> 0
    }
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) feed(sp.board.getCell(x, y).value !== 0 ? 1 : 0)
    }
    feed(sp.linesCleared)
    feed(sp.appliedRows)
    feed(sp.step)
    return h.toString(16).padStart(8, '0')
  }

  /** The board itself, packed 1 bit per cell (row-major), as base64 — ~25 bytes for a 10×20 field. */
  boardSnapshot(playerId: string): string {
    const sp = this.sims.get(playerId)
    if (!sp) return ''
    const bytes: number[] = []
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x += 8) {
        let byte = 0
        for (let i = 0; i < 8 && x + i < BOARD_W; i++) {
          if (sp.board.getCell(x + i, y).value !== 0) byte |= 1 << i
        }
        bytes.push(byte)
      }
    }
    return Buffer.from(bytes).toString('base64')
  }

  certifiedLines(playerId: string): number | null {
    return this.sims.get(playerId)?.linesCleared ?? null
  }

  /** How many locks this player has through the replay so far (the next expected step is +1). */
  stepsFor(playerId: string): number {
    return this.sims.get(playerId)?.step ?? 0
  }

  /** Read view of one replay board (top→bottom cell values) — diagnostics and tests only. */
  debugBoardSnapshot(playerId: string): number[][] | null {
    return this.sims.get(playerId)?.board.getSnapshot() ?? null
  }

  /** Test-only board setup (see the constructor's `verify` flag). Not used by production code. */
  debugInjectBoard(playerId: string, grid: number[][]): void {
    const sp = this.sims.get(playerId)
    if (!sp) return
    sp.board.reset()
    sp.delivered = []
    sp.appliedRows = 0
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
    const expectedStep = sp.step + 1
    if (lock.globalStep !== expectedStep) {
      const forward = lock.globalStep - expectedStep
      // A small forward gap is a *lost report*, not a cheat (the live EX8H case: step 12 never
      // arrived, step 13 did). Flag it so the room server can ask for a retransmission; a
      // duplicate/backward step or an implausibly large jump stays a hard violation.
      const soft = forward > 0 && forward <= MP_CONFIG.resyncMaxGap
      return {
        accepted: false,
        violation: `step ${lock.globalStep} != ${expectedStep}`,
        ...(soft ? { gap: { expectedStep, gotStep: lock.globalStep } } : {}),
      }
    }

    const shape = PIECE_SHAPES[lock.pieceType]?.[lock.rotation]
    if (!shape) return { accepted: false, violation: 'rotation' }

    // Garbage first: the report says how many rows the player has actually absorbed, and the
    // replay board must carry exactly those before support/overlap/line counts are judged.
    // Skipping this is what used to kill honest players — a piece resting on incoming garbage
    // looked 'floating' to a replay board that never received the rows.
    const appliedGarbage = this.applyReportedGarbage(sp, lock.garbageRows)

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
      return { accepted: true, cleared: 0, perfect: false, sentTo: [], appliedGarbage, scheduled: [], cancelled: [] }
    }

    sp.combo += 1
    const perfect = this.isBoardEmpty(sp)
    if (perfect) sp.lastPerfectAt = this.now()

    // Counteract first: self-cleared lines eat the oldest incoming garbage (ratio 1.0).
    let credit = cleared * MP_BALANCE.counteractRatio
    const cancelled: GarbageCancelled[] = []
    while (credit > 0 && sp.pending.length > 0) {
      const [oldest, ...rest] = sp.pending
      sp.pending = rest
      cancelled.push({ victimId: playerId, by: 'counteract', count: oldest.rows.length, rows: oldest.rows })
      credit -= oldest.rows.length
    }

    // Attack: base lines × combo multiplier (ceil), + perfect-clear bonus; queued per victim
    // behind the per-player pending cap.
    const base = MP_BALANCE.baseLines[cleared] ?? MP_BALANCE.baseLines[4]
    let lines = Math.ceil(base * MP_BALANCE.comboMultiplier(sp.combo))
    if (perfect) lines += MP_BALANCE.perfectClearBonus
    const applyAt = this.now() + MP_BALANCE.delayFor(cleared, perfect)
    const sentTo: { playerId: string; lines: number; applyAt: number }[] = []
    const scheduled: GarbageScheduled[] = []
    for (const [victimId, victim] of this.sims) {
      if (victimId === playerId) continue
      const room = MP_BALANCE.perPlayerGarbageCap - this.queuedRows(victim)
      const n = Math.min(lines, Math.max(0, room))
      if (n <= 0) {
        cancelled.push({ victimId, by: 'cap', count: lines })
        continue
      }
      const rows = this.makeGarbageRows(n)
      victim.pending.push({ rows, applyAt })
      scheduled.push({ victimId, rows, applyAt })
      sentTo.push({ playerId: victimId, lines: n, applyAt })
      if (n < lines) cancelled.push({ victimId, by: 'cap', count: lines - n })
    }
    return { accepted: true, cleared, perfect, sentTo, appliedGarbage, scheduled, cancelled }
  }

  /**
   * Absorb the garbage the reporting client says its board already holds. The client counts the
   * rows it really inserted (`PieceLockPayload.garbageRows`, engine-side and monotonic per match);
   * the replay may only apply rows it scheduled and handed out itself, in FIFO order. A client
   * claiming more rows than exist simply gets what there is: extra rows would only damage its own
   * board, so this is not a cheat worth ending a match over — unlike a wrong piece or a fake clear.
   */
  private applyReportedGarbage(sp: SimPlayer, claimed: number | undefined): number[][][] {
    const groups: number[][][] = []
    if (!Number.isInteger(claimed)) return groups // an older/absent counter: the board stays as is
    const target = Math.max(sp.appliedRows, claimed as number)
    while (sp.appliedRows < target && sp.delivered.length > 0) {
      const arrival = sp.delivered.shift() as GarbageArrival
      sp.board.insertGarbageRows(arrival.rows)
      sp.appliedRows += arrival.rows.length
      groups.push(arrival.rows)
    }
    return groups
  }

  /** Rows scheduled *or* handed out but not yet on the replay board — what the cap limits. */
  private queuedRows(sp: SimPlayer): number {
    return this.pendingRows(sp) + sp.delivered.reduce((sum, a) => sum + a.rows.length, 0)
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
