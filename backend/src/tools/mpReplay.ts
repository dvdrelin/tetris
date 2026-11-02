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
import type { PieceLockPayload, GarbageArrival } from '@neon-tetris/shared'
import { GAME_CONFIG } from '@neon-tetris/shared'
import { readBundleFromText, type ReplayBundle, type ReplayLock } from '../services/matchLog'

interface Options {
  file: string
  player: string
  steps: number
  ascii: number
  heights: boolean
  all: boolean
  /** Один экран выводов вместо ленты локов: где разошлось, кто потерял отчёт, как был канал. */
  diagnose: boolean
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = { file: '', player: '', steps: Number.POSITIVE_INFINITY, ascii: 0, heights: false, all: false, diagnose: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--player') opts.player = argv[++i] ?? ''
    else if (arg === '--steps') opts.steps = Number(argv[++i])
    else if (arg === '--ascii') opts.ascii = Number(argv[++i])
    else if (arg === '--heights') opts.heights = true
    else if (arg === '--all') opts.all = true
    else if (arg === '--diagnose') opts.diagnose = true
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
  // Мусорные ряды: сервер пишет и то, что он их *создал* (`garbage_scheduled`), и то, что он их
  // *съел* counteract'ом/иммунитетом/капом (`garbage_cancelled`). В свежих логах ряды берются
  // записанные, а не перегенерированные нашим RNG — расхождение «дырка в другом столбце» перестаёт
  // быть причиной ложных «overlap/floating». В старых логах рядов создания нет, остаётся сравнение
  // с выданными и честное предупреждение.
  const recordedGroups = new Map<string, number[][][]>()
  const haveScheduled = (bundle.scheduled?.length ?? 0) > 0
  if (haveScheduled) {
    for (const s of bundle.scheduled ?? []) {
      const list = recordedGroups.get(s.victimId) ?? []
      list.push(s.rows)
      recordedGroups.set(s.victimId, list)
    }
  } else {
    for (const g of bundle.garbage) {
      const list = recordedGroups.get(g.targetId) ?? []
      list.push(...g.groups)
      recordedGroups.set(g.targetId, list)
    }
  }
  let rowsDiffer = false
  const checkRows = (playerId: string, due: GarbageArrival[]) => {
    const list = recordedGroups.get(playerId)
    if (!list) return
    for (const arrival of due) {
      const expected = list.shift()
      if (!expected) continue
      if (JSON.stringify(expected) !== JSON.stringify(arrival.rows)) {
        if (!rowsDiffer) console.log(`   ⚠ содержимое мусорных рядов в реплее отличается от записанного матчем (${haveScheduled ? 'ряды записаны, значит разошёлся сам порядок/объём' : 'в логе нет garbage_scheduled — ряды перегенерированы нашим RNG'}): вердикты дальше этой строки — только ориентировочные`)
        rowsDiffer = true
      }
    }
  }
  // Отпечатки досок, которые сервер писал рядом со своими вердиктами: по ним первое расхождение
  // находится за O(1) глаз, а не чтением локов.
  const loggedDigests = new Map<string, { digest: string; snapshot?: string; origin: string }>()
  for (const d of bundle.digests ?? []) {
    loggedDigests.set(`${d.playerId}:${d.step}`, { digest: d.digest, ...(d.snapshot ? { snapshot: d.snapshot } : {}), origin: d.origin })
  }
  let digestsChecked = 0
  let firstDigestMismatch: string | null = null
  for (const lock of feed) {
    if (processed >= opts.steps) break
    // Reuse the recorded wall-clock gaps: MatchState schedules garbage on a clock, so the replay
    // keeps the same rhythm (that is what makes "did the sweep beat the lock?" reproducible).
    fakeNow = Math.max(fakeNow, lock.t)
    // The live server hands scheduled garbage out on its own 250 ms sweep (`sweepGarbage` →
    // `takeDueArrivals`), and `applyReportedGarbage` only absorbs rows that were *handed out*.
    // Without this step the replay board never receives them, so any lock resting on an incoming
    // garbage row turns into a bogus "floating" rejection — a PRA4 replay blamed the players for it.
    for (const p of bundle.players) {
      const { delivered } = state.takeDueArrivals(p.playerId, fakeNow)
      if (delivered.length) checkRows(p.playerId, delivered)
    }
    const payload = {
      globalStep: lock.globalStep,
      pieceType: lock.pieceType,
      x: lock.x,
      y: lock.y,
      rotation: lock.rotation,
      linesCleared: lock.linesCleared,
      garbageRows: lock.garbageRows ?? 0,
      // Флаг пустого слота хола: без него зеркало колоды реплея разъезжается с матчем уже на первом
      // холе, и реплей начинает отвергать законные отчёты (ложное «расхождение»).
      ...(lock.holdExtra ? { holdExtra: true } : {}),
    } as PieceLockPayload
    const fresh = state.applyLock(lock.playerId, payload)
    processed += 1
    const traceTag = lock.trace
      ? `  spawn=${lock.trace.spawn.x},${lock.trace.spawn.y} mv=${lock.trace.moves} rot=[${lock.trace.rotations.map((r) => `${r.from}→${r.to}${r.kick ? `k${r.kick}` : ''}`).join(' ')}]${lock.trace.more ? ` +${lock.trace.more}` : ''}`
      : ''
    const tag = `#${String(processed).padStart(3, ' ')} step ${String(lock.globalStep).padStart(4, ' ')} ${lock.playerId.slice(0, 8)} ${lock.pieceType} r${lock.rotation} x=${lock.x} y=${lock.y} lines=${lock.linesCleared} gRows=${lock.garbageRows ?? 0}${lock.holdExtra ? ' hold' : ''}${traceTag}`
    if (!fresh.accepted) {
      divergence += 1
      console.log(`${tag}  REJECTED by the replay: ${fresh.violation}`)
      console.log(`   the live server logged it as ${lock.rejectedByLiveServer ? `rejected (${lock.rejectedByLiveServer})` : 'accepted'}`)
      if (opts.ascii) console.log(renderBoard(state, watchId || lock.playerId))
      break
    }
    const applied = fresh.appliedGarbage.reduce((n, g) => n + g.length, 0)
    const extra = opts.heights ? `  height=${stackHeight(state, lock.playerId)} lines=${state.certifiedLines(lock.playerId)}` : ''
    if (!opts.diagnose) console.log(`${tag}  ok${applied ? `  (+${applied} garbage rows absorbed)` : ''}${extra}`)
    const want = loggedDigests.get(`${lock.playerId}:${lock.globalStep}`)
    if (want && !firstDigestMismatch) {
      digestsChecked += 1
      const mine = state.boardDigest(lock.playerId)
      if (mine !== want.digest) {
        firstDigestMismatch = `шаг ${lock.globalStep} (${lock.playerId.slice(0, 8)}): сервер ${want.digest}, реплей ${mine} (${want.origin})`
        console.log(`   ⚠ отпечаток доски разошёлся: ${firstDigestMismatch}`)
        if (want.snapshot) console.log(diffBoard(want.snapshot, state.boardSnapshot(lock.playerId)))
      }
    }
    if (opts.ascii && processed % opts.ascii === 0) console.log(renderBoard(state, watchId || lock.playerId))
  }

  console.log('')
  if (digestsChecked) {
    console.log(firstDigestMismatch
      ? `отпечатки досок: первое расхождение — ${firstDigestMismatch} (сверено ${digestsChecked} кадров)`
      : `отпечатки досок: ${digestsChecked} кадров, все совпали — реплей воспроизвёл доски матча`)
  } else if ((bundle.digests?.length ?? 0) === 0) {
    console.log('отпечатков досок в этом логе нет (лог старше schema 3) — расхождение ищется по локам')
  }
  if (bundle.cancelled?.length) {
    const by = new Map<string, number>()
    for (const c of bundle.cancelled) by.set(c.by, (by.get(c.by) ?? 0) + c.count)
    console.log(`мусорки не дошло до клиентов: ${[...by].map(([k, v]) => `${k} ${v} р.`).join(', ')}`)
  }
  if (typeof bundle.rngCalls === 'number') {
    const mine = state.rngUsage
    console.log(bundle.rngCalls === mine
      ? `расход RNG: ${mine} значений — совпал с матчем`
      : `⚠ расход RNG: сервер ${bundle.rngCalls}, реплей ${mine} — поток генератора разошёлся, значит содержимое мусорки в реплее не то, что видел матч (это не вина игроков)`)
  }
  if (bundle.redacted) {
    console.log('⚠ этот лог был взят у ИДУЩЕГО матча: seed и содержимое мусорных рядов скрыты (лог живого матча = подглядывание в чужую игру). Точный реплей — только после конца матча.')
  }
  if (opts.diagnose) console.log('\n' + diagnose(bundle, { processed, digestsChecked, firstDigestMismatch, rowsDiffer }))
  if (divergence) {
    console.log(`DIVERGED after ${processed} locks: the fresh replay rejected a lock the live match accepted.`)
    console.log('Compare the board above with the client report — this is where the two views split.')
    return 1
  }
  console.log(`replay agrees with the live server over ${processed} locks`)
  for (const end of bundle.ends) console.log(`end: ${end.reason}${end.detail ? `/${end.detail}` : ''} winner=${end.winnerId?.slice(0, 8) ?? 'none'}`)
  const nonLockEvents = bundle.events.filter((e) => e.event !== 'match_start')
  if (nonLockEvents.length && !opts.diagnose) {
    console.log('\ntimeline:')
    for (const e of nonLockEvents) {
      const offset = ((e.t - bundle.startedAt) / 1000).toFixed(1).padStart(7, ' ')
      console.log(`  +${offset}s ${e.event}${e.playerId ? ` ${e.playerId.slice(0, 8)}` : ''}${e.data !== undefined ? ` ${JSON.stringify(e.data)}` : ''}`)
    }
  }
  return 0
}

/**
 * Один экран вместо ленты локов: кто чем дышал, целы ли шаги, что случилось с мусоркой и каналом,
 * где первое расхождение. Именно это нужно, чтобы начать разбор матча с гипотезы, а не с чтения 40
 * строк глазами.
 */
function diagnose(
  bundle: ReplayBundle,
  facts: { processed: number; digestsChecked: number; firstDigestMismatch: string | null; rowsDiffer: boolean },
): string {
  const ev = bundle.events
  const at = (t: number) => `+${((t - bundle.startedAt) / 1000).toFixed(1)}s`
  const name = (id?: string | null): string => {
    if (!id) return '?'
    const p = bundle.players.find((x) => x.playerId === id)
    return p ? `${p.name}#${p.playerIndex}` : id.slice(0, 8)
  }
  const L: string[] = ['—— диагноз ——']
  L.push(`состав: ${bundle.players.map((p) => `${p.name}#${p.playerIndex} [${p.client ?? 'билд не сообщался'}]`).join(' | ')}`)

  // Шаги: пропуск своего шага = потерянный отчёт, а не читерство.
  for (const p of bundle.players) {
    const steps = bundle.locks.filter((l) => l.playerId === p.playerId).map((l) => l.globalStep).sort((a, b) => a - b)
    const max = steps.length ? steps[steps.length - 1] : 0
    const holes: number[] = []
    for (let s = 1; s <= max; s++) if (!steps.includes(s)) holes.push(s)
    L.push(`шаги ${p.name}: локов ${steps.length}, последний шаг ${max}${holes.length ? `, ПРОПУСКИ: ${holes.join(',')}` : ', пропусков нет'}`)
  }

  const resync = ev.filter((e) => e.event.startsWith('resync'))
  L.push(resync.length
    ? `ресинхрон: ${resync.map((e) => `${at(e.t)} ${e.event.replace('resync_', '')} ${name(e.playerId)}`).join('; ')}`
    : 'ресинхрон: эпизодов не было')

  const violations = ev.filter((e) => e.event === 'protocol_violation')
  if (violations.length) {
    L.push(`нарушения протокола: ${violations.map((e) => `${at(e.t)} ${name(e.playerId)} ${(e.data as { code?: string })?.code ?? ''}`).join('; ')}`)
  }
  const malformed = ev.filter((e) => e.event === 'malformed_lock')
  if (malformed.length) {
    L.push(`неразбираемых отчётов: ${malformed.map((e) => `${at(e.t)} ${name(e.playerId)} ${JSON.stringify((e.data as { field?: string; value?: string }) ?? {})}`).join('; ')}`)
  }
  const hold = ev.filter((e) => e.event === 'hold_desync')
  if (hold.length) L.push(`⚠ зеркало хола расходилось ${hold.length} раз(а): ${hold.map((e) => `${at(e.t)} ${name(e.playerId)} ${JSON.stringify(e.data)}`).join('; ')}`)

  const schedRows = (bundle.scheduled ?? []).reduce((n, s) => n + s.rows.length, 0)
  const delivRows = (bundle.garbage ?? []).reduce((n, g) => n + g.groups.reduce((m, gr) => m + gr.length, 0), 0)
  const cancelled = new Map<string, number>()
  for (const c of bundle.cancelled ?? []) cancelled.set(c.by, (cancelled.get(c.by) ?? 0) + c.count)
  L.push(`мусорка: сгенерировано ${schedRows} р., выдано ${delivRows} р.` + (cancelled.size ? `, не дошло: ${[...cancelled].map(([k, v]) => `${k} ${v}`).join(', ')}` : ''))

  const closes = ev.filter((e) => e.event === 'socket_closed')
  for (const c of closes) {
    const d = (c.data ?? {}) as { transport?: { pingsSent?: number; pingsLost?: number; lastPongRttMs?: number | null }; phase?: string }
    L.push(`разрыв ${at(c.t)} ${name(c.playerId)}: фаза ${d.phase ?? '?'}, транспорт ${JSON.stringify(d.transport ?? null)}`)
  }
  const rtts = bundle.locks
    .map((l) => (l.diag as { rttMs?: number } | undefined)?.rttMs)
    .filter((x): x is number => typeof x === 'number')
  if (rtts.length) {
    const sorted = [...rtts].sort((a, b) => a - b)
    L.push(`RTT клиента: медиана ${sorted[Math.floor(sorted.length / 2)]} мс, максимум ${sorted[sorted.length - 1]} мс (${rtts.length} отчётов)`)
  }

  L.push(facts.firstDigestMismatch
    ? `⚠ первое расхождение досок: ${facts.firstDigestMismatch} (сверено ${facts.digestsChecked} кадров)`
    : facts.digestsChecked
      ? `доски: ${facts.digestsChecked} отпечатков, все совпали`
      : 'доски: отпечатков в логе нет (лог старше schema 3)')
  if (facts.rowsDiffer) L.push('⚠ содержимое мусорных рядов в реплее разошлось с матчем — вердикты после этого ориентировочные')
  if (typeof bundle.rngCalls === 'number') {
    L.push(`расход RNG матча: ${bundle.rngCalls}`)
  }
  L.push(`прогнано реплеем: ${facts.processed} локов`)
  L.push(`итог: ${bundle.ends.map((e) => `${e.reason}${e.detail ? `/${e.detail}` : ''}, победитель ${e.winnerId ? name(e.winnerId) : 'нет'}`).join('; ') || 'матч не завершён в логе'}`)
  return L.join('\n')
}

/**
 * Печатает только те ряды, где записанная сервером доска и доска реплея различаются. Снимок —
 * это 1 бит на клетку (row-major, base64), 2 байта на ряд при ширине 10.
 */
function diffBoard(loggedSnapshot: string, replaySnapshot: string): string {
  const decode = (b64: string): string[] => {
    const buf = Buffer.from(b64, 'base64')
    const rows: string[] = []
    const bytesPerRow = Math.ceil(GAME_CONFIG.boardWidth / 8)
    for (let y = 0; y < GAME_CONFIG.boardHeight; y++) {
      let line = ''
      for (let x = 0; x < GAME_CONFIG.boardWidth; x++) {
        const byte = buf[y * bytesPerRow + Math.floor(x / 8)] ?? 0
        line += byte & (1 << (x % 8)) ? '#' : '.'
      }
      rows.push(line)
    }
    return rows
  }
  const a = decode(loggedSnapshot)
  const b = decode(replaySnapshot)
  const out: string[] = ['   ряд: сервер / реплей']
  for (let y = 0; y < a.length; y++) {
    if (a[y] === b[y]) continue
    out.push(`   ${String(y).padStart(3, ' ')}  ${a[y]}   ${b[y]}`)
  }
  return out.join('\n')
}

process.exitCode = main()
