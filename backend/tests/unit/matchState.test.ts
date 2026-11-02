// MP block D — MatchState: the server-side replay. Attack tables (02_GAME_CONFIG.json),
// combo multipliers with ceil, perfect-clear bonus + immunity, counteract, the per-player
// garbage cap, and the anti-desync verification (bag identity incl. hold, bounds, support,
// honest clear counts, strict step order).
import { PieceFactoryProvider, GAME_CONFIG } from '@neon-tetris/shared'
import { MatchState } from '../../src/services/matchState'

const W = GAME_CONFIG.boardWidth
const H = GAME_CONFIG.boardHeight

let clock = 1000
const now = () => clock
const fixedRng = () => 0.5 // hole at column 5, garbage color 4 — deterministic rows

function makeState(verify = false, seed = 12345): MatchState {
  clock = 1000
  return new MatchState(['A', 'B'], seed, now, fixedRng, verify)
}

function emptyGrid(): number[][] {
  return Array.from({ length: H }, () => Array(W).fill(0))
}

/** Fill the given bottom rows in columns [0, untilCol). */
function fillBottomRows(grid: number[][], rowCount: number, untilCol: number): number[][] {
  for (let i = 0; i < rowCount; i++) {
    for (let x = 0; x < untilCol; x++) grid[H - 1 - i][x] = 1
  }
  return grid
}

const lock = (step: number, pieceType: any, x: number, y: number, rotation: number, linesCleared: number, extra?: object) => ({
  globalStep: step, pieceType, x, y, rotation, linesCleared, ...extra,
})

function pendingRowCount(state: MatchState, playerId: string): number {
  return state.pendingFor(playerId).reduce((s, a) => s + a.rows.length, 0)
}

describe('attack pipeline (verify disabled, boards set up directly)', () => {
  test('tetris sends 7 garbage rows after a 900 ms queue delay, each with one hole', () => {
    const state = makeState()
    const grid = fillBottomRows(emptyGrid(), 4, 9)
    grid[15][0] = 1 // a survivor above the cleared rows: this tetris is not a perfect clear
    state.debugInjectBoard('A', grid)
    const verdict = state.applyLock('A', lock(1, 'I', 7, 16, 1, 4))
    expect(verdict.accepted).toBe(true)
    if (!verdict.accepted) return
    expect(verdict.cleared).toBe(4)
    expect(verdict.sentTo).toEqual([{ playerId: 'B', lines: 7, applyAt: 1900 }])
    // Что реально сгенерировано — в том же вердикте: лог пишет эти ряды, и реплей по им сверяет
    // содержимое мусорки, вместо того чтобы перегенерировать своё.
    expect(verdict.scheduled).toHaveLength(1)
    expect(verdict.scheduled[0].victimId).toBe('B')
    expect(verdict.scheduled[0].applyAt).toBe(1900)
    expect(verdict.cancelled).toEqual([])

    expect(pendingRowCount(state, 'B')).toBe(7)
    expect(state.takeDueArrivals('B', 1899).delivered).toHaveLength(0)
    const due = state.takeDueArrivals('B', 1900).delivered
    expect(due).toHaveLength(1)
    expect(due[0].rows).toHaveLength(7)
    expect(due[0].rows).toEqual(verdict.scheduled[0].rows) // handout matches what was scheduled
    for (const row of due[0].rows) {
      expect(row).toHaveLength(W)
      expect(row[5]).toBe(0) // the fixed rng put every hole at column 5
      expect(row.filter((v: number) => v !== 0)).toHaveLength(W - 1)
    }
    // Delivered arrivals leave the queue.
    expect(pendingRowCount(state, 'B')).toBe(0)
  })

  test('combo multiplier applies from the second clear with ceil rounding', () => {
    const state = makeState()
    // First single: base 1 × 1.0 → 1 row.
    state.debugInjectBoard('A', fillBottomRows(emptyGrid(), 1, 7))
    expect(state.applyLock('A', lock(1, 'L', 7, 18, 0, 1)).accepted).toBe(true)
    expect(pendingRowCount(state, 'B')).toBe(1)
    // Second single: 1 × 1.25 = 1.25 → ceil → 2 rows (queue delay 400 for singles).
    state.debugInjectBoard('A', fillBottomRows(emptyGrid(), 1, 7))
    const v2 = state.applyLock('A', lock(2, 'L', 7, 18, 0, 1))
    expect(v2.accepted).toBe(true)
    if (!v2.accepted) return
    expect(v2.sentTo[0].lines).toBe(2)
    expect(pendingRowCount(state, 'B')).toBe(3)
  })

  test('perfect clear adds the +10 bonus, pushes the delay to 1200 ms and grants 1 s immunity', () => {
    const state = makeState()
    // An O-piece completes two full rows and sits entirely inside them — after the double
    // clear the board is empty: a true perfect clear.
    state.debugInjectBoard('A', fillBottomRows(emptyGrid(), 2, 8))
    const v = state.applyLock('A', lock(1, 'O', 8, 18, 0, 2))
    expect(v.accepted).toBe(true)
    if (!v.accepted) return
    expect(v.perfect).toBe(true)
    expect(v.sentTo[0].lines).toBe(12) // ceil(2 base × 1.0) + 10 perfect-clear bonus
    expect(v.sentTo[0].applyAt).toBe(2200) // 1000 + 1200 (perfect delay)

    // B answers with a single at t=1100 → 1 row scheduled for A at 1500.
    clock = 1100
    state.debugInjectBoard('B', fillBottomRows(emptyGrid(), 1, 7))
    expect(state.applyLock('B', lock(1, 'L', 7, 18, 0, 1)).accepted).toBe(true)
    // A's perfect clear at t=1000 covers arrivals landing until 2000 → the 1500 row is absorbed.
    const absorbed = state.takeDueArrivals('A', 1500)
    expect(absorbed.delivered).toHaveLength(0)
    // Иммунитет тоже должен быть виден: эти ряды потратили RNG матча, и реплей без этой строки
    // не понимает, почему его мусорка пошла дальше.
    expect(absorbed.cancelled).toEqual([{ victimId: 'A', by: 'immunity', count: 1, rows: expect.any(Array) }])
    expect(pendingRowCount(state, 'A')).toBe(0)
  })

  test('counteract: a self-clear cancels the oldest incoming garbage (ratio 1, whole arrivals)', () => {
    const state = makeState()
    const grid = fillBottomRows(emptyGrid(), 4, 9)
    grid[15][0] = 1 // not a perfect clear — 7 plain tetris rows
    state.debugInjectBoard('A', grid)
    const first = state.applyLock('A', lock(1, 'I', 7, 16, 1, 4)) // 7 rows against B
    expect(pendingRowCount(state, 'B')).toBe(7)
    clock = 1300
    state.debugInjectBoard('B', fillBottomRows(emptyGrid(), 1, 7))
    const second = state.applyLock('B', lock(1, 'L', 7, 18, 0, 1)) // B clears 1 → cancels the pending arrival
    expect(pendingRowCount(state, 'B')).toBe(0)
    if (!second.accepted) throw new Error('expected the lock to be accepted')
    expect(second.cancelled).toHaveLength(1)
    expect(second.cancelled[0]).toMatchObject({ victimId: 'B', by: 'counteract', count: 7 })
    expect(second.cancelled[0].rows).toEqual(first.accepted ? first.scheduled[0].rows : [])
  })

  test('the per-player pending garbage cap (20 rows) clamps what can be stacked', () => {
    const state = makeState()
    let steps = 1
    for (let i = 0; i < 15; i++) {
      state.debugInjectBoard('A', fillBottomRows(emptyGrid(), 1, 7))
      const v = state.applyLock('A', lock(steps++, 'L', 7, 18, 0, 1))
      expect(v.accepted).toBe(true)
    }
    expect(pendingRowCount(state, 'B')).toBe(20)
  })
})

describe('piece_lock verification (verify enabled, seeded bag)', () => {
  const SEED = 777
  function bag(n: number) {
    const f = new PieceFactoryProvider({ seed: SEED })
    return Array.from({ length: n }, () => f.nextPieceType())
  }
  const floorY = (type: any) => {
    const shape = (require('@neon-tetris/shared').PIECE_SHAPES as any)[type][0]
    let maxRow = 0
    for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) if (shape[r][c]) maxRow = Math.max(maxRow, r)
    return H - 1 - maxRow
  }

  test('the bag-order piece is accepted; the wrong piece or a step gap is rejected', () => {
    const state = makeState(true, SEED)
    const types = bag(3)
    expect(state.applyLock('A', lock(1, types[0], 0, floorY(types[0]), 0, 0)).accepted).toBe(true)
    // Wrong piece (not spawned, not held).
    const wrong = types[0] === 'O' ? 'I' : 'O'
    expect(state.applyLock('A', lock(2, wrong, 4, floorY(wrong), 0, 0)).accepted).toBe(false)
    // Skipped step.
    const v = state.applyLock('A', lock(5, types[1], 4, floorY(types[1]), 0, 0))
    expect(v.accepted).toBe(false)
    if (!v.accepted) expect(v.violation).toMatch(/step/)
  })

  test('hold on an empty slot needs holdExtra so the mirror consumes the extra pull', () => {
    const state = makeState(true, SEED)
    const types = bag(4)
    // Step 1 with a hold press on the empty slot: the engine handed over types[1] already.
    const v1 = state.applyLock('A', lock(1, types[1], 0, floorY(types[1]), 0, 0, { holdExtra: true }))
    expect(v1.accepted).toBe(true)
    if (!v1.accepted) return
    state.debugInjectBoard('A', emptyGrid()) // fresh canvas per lock; the step counter survives
    // Step 2: the player presses hold again (slot is filled this time, so no extra pull):
    // the hand becomes the originally spawned types[0], remembered in the hold slot.
    const v2 = state.applyLock('A', lock(2, types[0], 0, floorY(types[0]), 0, 0))
    expect(v2.accepted).toBe(true)
    state.debugInjectBoard('A', emptyGrid())
    // Step 3 without any hold: the next bag piece (types[3]) is the hand.
    const v3 = state.applyLock('A', lock(3, types[3], 0, floorY(types[3]), 0, 0))
    expect(v3.accepted).toBe(true)
  })

  test('floating pieces, overlaps and fake clear counts never pass', () => {
    const state = makeState(true, SEED)
    const types = bag(2)
    // Floating: same piece but hovering mid-board over an empty floor.
    const fv = state.applyLock('A', lock(1, types[0], 0, 5, 0, 0))
    expect(fv.accepted).toBe(false)
    if (!fv.accepted) expect(fv.violation).toMatch(/floating/)
    // Honest placement, then a duplicate at the same spot.
    expect(state.applyLock('A', lock(1, types[0], 0, floorY(types[0]), 0, 0)).accepted).toBe(true)
    const dup = state.applyLock('A', lock(2, types[1], 0, floorY(types[1]), 0, 0))
    expect(dup.accepted).toBe(false)
    if (!dup.accepted) expect(dup.violation).toMatch(/overlap|floating/)
    // Fake clear: an honest second-board lock claiming a clear that did not happen.
    const state2 = makeState(true, SEED)
    const fv2 = state2.applyLock('A', lock(1, types[0], 0, floorY(types[0]), 0, 1))
    expect(fv2.accepted).toBe(false)
    if (!fv2.accepted) expect(fv2.violation).toMatch(/lines/)
  })
})

// The bug this section exists for: the replay board used to stay clean while the real boards were
// full of attack rows, so an honest lock resting on garbage read as 'floating' to the server —
// the player died right after a legal drop and the match closed as a forfeit.
describe('garbage state of the replay board (reported garbageRows counter)', () => {
  /** A tetris by A: 7 garbage rows scheduled against B, landing at t=1900. */
  function attack(state: MatchState): void {
    const grid = fillBottomRows(emptyGrid(), 4, 9)
    grid[15][0] = 1 // a survivor above the cleared rows: not a perfect clear
    state.debugInjectBoard('A', grid)
    expect(state.applyLock('A', lock(1, 'I', 7, 16, 1, 4)).accepted).toBe(true)
  }

  test('a lock resting on delivered garbage is accepted once the report says the rows landed', () => {
    const state = makeState()
    attack(state)
    clock = 1900
    expect(state.takeDueArrivals('B', 1900).delivered).toHaveLength(1) // the sweep handed the rows to B

    // B's honest placement: an O resting on the garbage surface (rows 13..19 are garbage with the
    // fixed rng's hole at column 5). Without the counter the server sees an empty board.
    const without = state.applyLock('B', lock(1, 'O', 5, 11, 0, 0))
    expect(without.accepted).toBe(false)
    if (!without.accepted) expect(without.violation).toMatch(/floating/)

    const v = state.applyLock('B', lock(1, 'O', 5, 11, 0, 0, { garbageRows: 7 }))
    expect(v.accepted).toBe(true)
    if (!v.accepted) return
    expect(v.appliedGarbage).toHaveLength(1)
    expect(v.appliedGarbage[0]).toHaveLength(7)

    // The replay board now carries what B's real board carries.
    const board = state.debugBoardSnapshot('B')
    expect(board).not.toBeNull()
    expect(board![19][0]).toBe(4) // garbage row (fixed rng colour 4), hole at column 5
    expect(board![19][5]).toBe(0)
    expect(board![13].every((v2, x) => (x === 5 ? v2 === 0 : v2 === 4))).toBe(true)
    expect(board![11][5]).not.toBe(0) // B's own O sits on top of the garbage
  })

  test('rows that were never handed out cannot be conjured onto the board by a counter', () => {
    const state = makeState()
    attack(state) // scheduled at t=1900, but the sweep never ran
    // B claims to have absorbed 7 rows the server has not delivered: clamped to zero.
    const v = state.applyLock('B', lock(1, 'O', 5, 11, 0, 0, { garbageRows: 7 }))
    expect(v.accepted).toBe(false)
    if (!v.accepted) expect(v.violation).toMatch(/floating/)
    // And the honest path still works once the rows really arrive.
    expect(state.takeDueArrivals('B', 1900).delivered).toHaveLength(1)
    expect(state.applyLock('B', lock(1, 'O', 5, 11, 0, 0, { garbageRows: 7 })).accepted).toBe(true)
  })

  test('a mid-match rejoin hands the pending rows over, and they absorb on the next report', () => {
    const state = makeState()
    attack(state)
    clock = 1900
    // A rejoin claims every still-pending arrival; the client inserts them immediately.
    expect(state.claimAllArrivals('B')).toHaveLength(1)
    expect(state.applyLock('B', lock(1, 'O', 5, 11, 0, 0, { garbageRows: 7 })).accepted).toBe(true)
  })

  test('a counter that overstates the truth absorbs only what exists and stays accepted', () => {
    const state = makeState()
    attack(state)
    clock = 1900
    state.takeDueArrivals('B', 1900)
    // 999 claimed, 7 delivered: the replay applies the 7 (extra rows would only hurt their owner).
    const v = state.applyLock('B', lock(1, 'O', 5, 11, 0, 0, { garbageRows: 999 }))
    expect(v.accepted).toBe(true)
    if (!v.accepted) return
    expect(v.appliedGarbage[0]).toHaveLength(7)
  })
})
