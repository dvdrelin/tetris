/**
 * mp:replay — play a recorded MP match again, offline, on the real server code.
 *
 *   npm run mp:replay -- <file> [options]
 *
 * <file> is either the JSONL log (GET /api/mp/matches/:file) or the replay bundle
 * (GET /api/mp/matches/:file/replay). The tool rebuilds a `MatchState` with the recorded seed and
 * the recorded players, feeds every verified lock in log order, and compares the fresh verdict
 * with the one the live server logged. Where they disagree is exactly the bug you are looking for:
 * a bag that dealt differently, a garbage row the replay never saw, a clock that raced the sweep.
 *
 * Options:
 *   --player <id|index>   whose board to render with --ascii
 *   --steps <n>           stop after n locks
 *   --ascii <n>           print that player's board after every n-th lock
 *   --heights             print stack height / certified lines per lock
 *   --all                 also feed locks the live server *rejected* (they are in the log too)
 *
 * Exit code 0 = the replay agrees with every logged verdict, 1 = it diverges, 2 = bad input.
 */
import { readFileSync } from 'fs'
import { MatchState } from '../services/matchState'
import type { PieceLockPayload } from '@neon-tetris/shared'
import { readBundleFromText, type ReplayBundle, type ReplayLock } from '../services/matchLog'

interface Options {
  file: string
  player: string
  steps: number
  ascii: number
  heights: boolean
  all: boolean
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = { file: '', player: '', steps: Number.POSITIVE_INFINITY, ascii: 0, heights: false, all: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--player') opts.player = argv[++i] ?? ''
    else if (arg === '--steps') opts.steps = Number(argv[++i])
    else if (arg === '--ascii') opts.ascii = Number(argv[++i])
    else if (arg === '--heights') opts.heights = true
    else if (arg === '--all') opts.all = true
    else if (!opts.file) opts.file = arg
    else return null
  }
  return opts.file ? opts : null
}

function renderBoard(state: MatchState, playerId: string): string {
  const grid = state.debugBoardSnapshot(playerId)
  if (!grid) return '(no such player)'
  const rows = [...grid].reverse() // draw top row first
  const lines: string[] = []
  for (let i = 0; i < rows.length; i++) {
    lines.push(`|${rows[i].map((v) => (v === 0 ? '.' : String(v))).join('')}| y=${rows.length - 1 - i}`)
  }
  lines.push('+' + '-'.repeat(rows[0].length) + '+')
  return lines.join('\n')
}

function stackHeight(state: MatchState, playerId: string): number {
  const grid = state.debugBoardSnapshot(playerId)
  if (!grid) return 0
  for (let y = 0; y < grid.length; y++) {
    if (grid[y].some((v) => v !== 0)) return grid.length - y
  }
  return 0
}

function main(): number {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts) {
    console.error('usage: npm run mp:replay -- <match file> [--player id|index] [--steps n] [--ascii n] [--heights] [--all]')
    return 2
  }
  let bundle: ReplayBundle | null
  try {
    bundle = readBundleFromText(readFileSync(opts.file, 'utf-8'))
  } catch (err) {
    console.error(`cannot read ${opts.file}:`, (err as Error).message)
    return 2
  }
  if (!bundle) {
    console.error('the file has no match_start record — is it a match log from /api/mp/matches?')
    return 2
  }

  const byIndex = new Map<string, string>()
  for (const p of bundle.players) {
    byIndex.set(String(p.playerIndex), p.playerId)
    byIndex.set(p.playerId, p.playerId)
  }
  const watchId = opts.player ? byIndex.get(opts.player) ?? '' : ''
  if (opts.player && !watchId) {
    console.error(`player "${opts.player}" is not in this match (${bundle.players.map((p) => `${p.playerIndex}:${p.playerId.slice(0, 8)}`).join(', ')})`)
    return 2
  }

  let fakeNow = bundle.startedAt
  const state = new MatchState(bundle.players.map((p) => p.playerId), bundle.seed, () => fakeNow)

  console.log(`room ${bundle.code}  seed ${bundle.seed}  started ${new Date(bundle.startedAt).toISOString()}`)
  console.log(`players: ${bundle.players.map((p) => `#${p.playerIndex} ${p.name} (${p.playerId.slice(0, 8)})`).join(' | ')}`)
  console.log(`locks ${bundle.locks.length}, rejected reports ${bundle.verdicts.length}, garbage deliveries ${bundle.garbage.length}, ends ${bundle.ends.length}`)
  console.log('')

  const feed: Array<ReplayLock & { rejectedByLiveServer?: string }> = bundle.locks.map((l) => ({ ...l }))
  if (opts.all) for (const v of bundle.verdicts) feed.push({ ...(v.lock as ReplayLock), playerId: v.playerId, rejectedByLiveServer: v.violation })
  feed.sort((a, b) => a.t - b.t)

  let divergence = 0
  let processed = 0
  for (const lock of feed) {
    if (processed >= opts.steps) break
    // Reuse the recorded wall-clock gaps: MatchState schedules garbage on a clock, so the replay
    // keeps the same rhythm (that is what makes "did the sweep beat the lock?" reproducible).
    fakeNow = Math.max(fakeNow, lock.t)
    // The live server hands scheduled garbage out on its own 250 ms sweep (`sweepGarbage` →
    // `takeDueArrivals`), and `applyReportedGarbage` only absorbs rows that were *handed out*.
    // Without this step the replay board never receives them, so any lock resting on an incoming
    // garbage row turns into a bogus "floating" rejection — a PRA4 replay blamed the players for it.
    for (const p of bundle.players) state.takeDueArrivals(p.playerId, fakeNow)
    const payload = {
      globalStep: lock.globalStep,
      pieceType: lock.pieceType,
      x: lock.x,
      y: lock.y,
      rotation: lock.rotation,
      linesCleared: lock.linesCleared,
      garbageRows: lock.garbageRows ?? 0,
    } as PieceLockPayload
    const fresh = state.applyLock(lock.playerId, payload)
    processed += 1
    const tag = `#${String(processed).padStart(3, ' ')} step ${String(lock.globalStep).padStart(4, ' ')} ${lock.playerId.slice(0, 8)} ${lock.pieceType} r${lock.rotation} x=${lock.x} y=${lock.y} lines=${lock.linesCleared} gRows=${lock.garbageRows ?? 0}`
    if (!fresh.accepted) {
      divergence += 1
      console.log(`${tag}  REJECTED by the replay: ${fresh.violation}`)
      console.log(`   the live server logged it as ${lock.rejectedByLiveServer ? `rejected (${lock.rejectedByLiveServer})` : 'accepted'}`)
      if (opts.ascii) console.log(renderBoard(state, watchId || lock.playerId))
      break
    }
    const applied = fresh.appliedGarbage.reduce((n, g) => n + g.length, 0)
    const extra = opts.heights ? `  height=${stackHeight(state, lock.playerId)} lines=${state.certifiedLines(lock.playerId)}` : ''
    console.log(`${tag}  ok${applied ? `  (+${applied} garbage rows absorbed)` : ''}${extra}`)
    if (opts.ascii && processed % opts.ascii === 0) console.log(renderBoard(state, watchId || lock.playerId))
  }

  console.log('')
  if (divergence) {
    console.log(`DIVERGED after ${processed} locks: the fresh replay rejected a lock the live match accepted.`)
    console.log('Compare the board above with the client report — this is where the two views split.')
    return 1
  }
  console.log(`replay agrees with the live server over ${processed} locks`)
  for (const end of bundle.ends) console.log(`end: ${end.reason}${end.detail ? `/${end.detail}` : ''} winner=${end.winnerId?.slice(0, 8) ?? 'none'}`)
  const nonLockEvents = bundle.events.filter((e) => e.event !== 'match_start')
  if (nonLockEvents.length) {
    console.log('\ntimeline:')
    for (const e of nonLockEvents) {
      const offset = ((e.t - bundle.startedAt) / 1000).toFixed(1).padStart(7, ' ')
      console.log(`  +${offset}s ${e.event}${e.playerId ? ` ${e.playerId.slice(0, 8)}` : ''}${e.data !== undefined ? ` ${JSON.stringify(e.data)}` : ''}`)
    }
  }
  return 0
}

process.exitCode = main()
