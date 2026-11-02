/**
 * MP match logs (block D debugging).
 *
 * Every match gets one append-only JSONL file under `backend/data/mp-matches/`: one line per
 * server-observed event (roster, seed, locks with the verdict the replay produced, garbage
 * scheduled/delivered, socket drops and rejoins, the final verdict). That is the record needed
 * to answer the questions a live match always raises — "was there really a page reload?", "why
 * did the server reject this lock?", "whose board diverged first?" — instead of guessing.
 *
 * The file format is deliberately the same vocabulary as the wire protocol, so a log can be fed
 * straight back into a real `MatchState` (see src/tools/mpReplay.ts) and replayed offline.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { BOOT_ID } from '../config/runtime'

export interface MatchLogPlayer {
  playerId: string
  name: string
  playerIndex: number
  /** Frontend build that took this seat (deploy stamp), when the client reported one. */
  client?: string
}

export interface MatchStartRecord {
  code: string
  seed: number
  startTime: number
  players: MatchLogPlayer[]
  /** Snapshot of the rules that produced this match (MP_CONFIG/MP_BALANCE/board/version). */
  config?: unknown
}

/**
 * Bump when a line's meaning changes, so `mp:replay` can say "this file predates X" instead of
 * silently mis-reading it. Additive fields do not need a bump.
 */
export const MATCH_LOG_SCHEMA = 3

export interface MatchLogLine {
  t: number
  room: string
  event: string
  playerId?: string
  data?: unknown
  // Written on every line by the store (not by the call sites), so any line can be read on its own:
  /** One id per match file — survives rematches of the same room. */
  mid?: string
  /** Seat number the `playerId` belongs to, when the store knows the roster. */
  seat?: number
  /** Milliseconds since the previous line of this match. */
  dt?: number
  /** Which backend process wrote it (`BOOT_ID`): spots restarts between/inside matches. */
  boot?: string
  /** Only on the `match_start` line: the log format version. */
  schema?: number
}

export interface MatchLogIndexEntry {
  file: string
  code: string
  seed: number
  startTime: number
  startedAt: number
  startedAtIso: string
  players: MatchLogPlayer[]
  events: number
  bytes: number
  closed: boolean
  verdict?: { reason: string; detail?: string; winnerId: string | null }
  matchId?: string
  boot?: string
}

/** The compact, replay-ready form of one match: everything a fresh MatchState needs, plus verdicts. */
export interface ReplayLock {
  playerId: string
  t: number
  globalStep: number
  pieceType: string
  x: number
  y: number
  rotation: number
  linesCleared: number
  garbageRows: number
}

export interface ReplayGarbage {
  targetId: string
  applyAt: number
  groups: number[][][]
}

export interface ReplayVerdict {
  playerId: string
  t: number
  violation: string
  lock: unknown
}

export interface ReplayBundle {
  code: string
  seed: number
  startTime: number
  startedAt: number
  players: MatchLogPlayer[]
  locks: ReplayLock[]
  garbage: ReplayGarbage[]
  /** Rows the server actually generated per attack (with the attacker line that produced them). */
  scheduled: ReplayScheduled[]
  /** Rows that never reached a client (counteract / immunity / pending cap): they still consumed RNG. */
  cancelled: ReplayCancelled[]
  /** Board fingerprints the server wrote next to its verdicts — the replay compares against these. */
  digests: ReplayDigest[]
  verdicts: ReplayVerdict[]
  ends: { reason: string; detail?: string; winnerId: string | null; t: number }[]
  events: { t: number; event: string; playerId?: string; data?: unknown }[]
}

export interface ReplayScheduled {
  attackerId: string
  victimId: string
  applyAt: number
  rows: number[][]
}

export interface ReplayCancelled {
  playerId: string
  by: string
  count: number
}

export interface ReplayDigest {
  playerId: string
  step: number
  digest: string
  snapshot?: string
  origin: 'lock' | 'malformed' | 'resync'
}

export interface MatchLogOptions {
  dir?: string
  /** Идентичность процесса для строк лога; по умолчанию — BOOT_ID этого запуска. */
  bootId?: string
  /** Oldest files are deleted past this count (a match file is a few tens of KB). */
  maxFiles?: number
  enabled?: boolean
  now?: () => number
}

const DEFAULT_DIR = join(__dirname, '..', '..', 'data', 'mp-matches')

/** File names are user-visible input on the read endpoints: keep them strictly to what we write. */
export function isSafeLogFileName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-[A-Z0-9]{4}-\d{13}\.jsonl$/.test(name)
}

function fileStamp(ts: number): string {
  const d = new Date(ts)
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return `${iso}`
}

/** The 13-digit epoch milliseconds embedded in a log file name (before `.jsonl`). */
function startedAtFromFile(file: string): number {
  const m = /-(\d{13})\.jsonl$/.exec(file)
  return m ? Number(m[1]) : 0
}

/**
 * Turns one match's log lines into the replay form. Exported because the CLI tool
 * (src/tools/mpReplay.ts) builds bundles straight from a downloaded file.
 */
/** Для таймлайна: ряды мусорки показывать количеством, сами ряды лежат в `bundle.scheduled`. */
function compactGarbageData(d: { victimId?: string; applyAt?: number; rows?: number[][] } | undefined): unknown {
  if (!d) return undefined
  return { victimId: d.victimId, applyAt: d.applyAt, rows: Array.isArray(d.rows) ? d.rows.length : 0 }
}

export function bundleFromLines(lines: MatchLogLine[]): ReplayBundle | null {
  if (!lines.length) return null
  const start = lines.find((l) => l.event === 'match_start')
  if (!start) return null
  const data = (start.data ?? {}) as { seed?: number; startTime?: number; players?: MatchLogPlayer[] }
  const bundle: ReplayBundle = {
    code: lines[0].room,
    seed: typeof data.seed === 'number' ? data.seed : 0,
    startTime: typeof data.startTime === 'number' ? data.startTime : 0,
    startedAt: start.t,
    players: Array.isArray(data.players) ? data.players : [],
    locks: [],
    garbage: [],
    scheduled: [],
    cancelled: [],
    digests: [],
    verdicts: [],
    ends: [],
    events: [],
  }
  for (const line of lines) {
    const { event, playerId, t } = line
    if (event === 'piece_lock') {
      const rec = line.data as { lock?: ReplayLock; accepted?: boolean; violation?: string; digest?: string; snapshot?: string } | undefined
      const lock = rec?.lock
      if (!lock) continue
      if (rec && rec.accepted === false) {
        bundle.verdicts.push({ playerId: playerId ?? '', t, violation: rec.violation ?? '', lock })
      } else {
        bundle.locks.push({ ...lock, playerId: playerId ?? '', t })
      }
      if (rec?.digest) {
        bundle.digests.push({
          playerId: playerId ?? '',
          step: lock.globalStep,
          digest: rec.digest,
          ...(rec.snapshot ? { snapshot: rec.snapshot } : {}),
          origin: 'lock',
        })
      }
    } else if (event === 'garbage_scheduled') {
      const d = line.data as { victimId?: string; applyAt?: number; rows?: number[][] } | undefined
      if (d?.victimId && Array.isArray(d.rows)) {
        bundle.scheduled.push({ attackerId: playerId ?? '', victimId: d.victimId, applyAt: d.applyAt ?? 0, rows: d.rows })
      }
      bundle.events.push({ t, event, playerId, data: compactGarbageData(d) })
    } else if (event === 'garbage_cancelled') {
      const d = line.data as { by?: string; count?: number } | undefined
      bundle.cancelled.push({ playerId: playerId ?? '', by: String(d?.by ?? ''), count: Number(d?.count ?? 0) })
      bundle.events.push({ t, event, playerId, data: d })
    } else if (event === 'malformed_lock') {
      const d = line.data as { step?: number; digest?: string; snapshot?: string } | undefined
      if (d?.digest) {
        bundle.digests.push({
          playerId: playerId ?? '',
          step: Number(d.step ?? -1),
          digest: d.digest,
          ...(d.snapshot ? { snapshot: d.snapshot } : {}),
          origin: 'malformed',
        })
      }
      bundle.events.push({ t, event, playerId, data: d })
    } else if (event === 'resync_requested') {
      const d = line.data as { expectedStep?: number; digest?: string } | undefined
      if (d?.digest) {
        bundle.digests.push({
          playerId: playerId ?? '',
          step: Number(d.expectedStep ?? -1),
          digest: d.digest,
          origin: 'resync',
        })
      }
      bundle.events.push({ t, event, playerId, data: d })
    } else if (event === 'garbage_delivered') {
      const d = line.data as { arrivals?: { applyAt: number; rows: number[][] }[]; groups?: number[][][] } | undefined
      if (Array.isArray(d?.arrivals)) {
        for (const a of d.arrivals) bundle.garbage.push({ targetId: playerId ?? '', applyAt: a.applyAt, groups: [a.rows] })
      } else if (Array.isArray(d?.groups)) {
        bundle.garbage.push({ targetId: playerId ?? '', applyAt: 0, groups: d.groups })
      }
    } else if (event === 'match_over') {
      const d = line.data as { reason?: string; detail?: string; winnerId?: string | null } | undefined
      bundle.ends.push({ reason: d?.reason ?? '', detail: d?.detail, winnerId: d?.winnerId ?? null, t })
    } else if (event !== 'match_start') {
      bundle.events.push({ t, event, playerId, data: line.data })
    }
  }
  return bundle
}

/**
 * Accepts whatever the log endpoints hand out: the JSONL body, `{file, lines}` JSON, or the
 * `{file, …bundle}` replay JSON.
 */
export function readBundleFromText(text: string): ReplayBundle | null {
  const trimmed = text.trim()
  const whole = (() => {
    try {
      return JSON.parse(trimmed) as ReplayBundle & { lines?: MatchLogLine[] }
    } catch {
      return null // not one JSON value: it is a JSONL body, parse it line by line below
    }
  })()
  if (whole) {
    if (Array.isArray(whole.lines)) return bundleFromLines(whole.lines)
    if (Array.isArray(whole.locks)) return whole
    return null
  }
  const lines: MatchLogLine[] = []
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue
    try {
      lines.push(JSON.parse(line) as MatchLogLine)
    } catch { /* a torn line is skipped */ }
  }
  return bundleFromLines(lines)
}

export class MatchLogStore {
  private readonly dir: string
  private readonly maxFiles: number
  private readonly enabled: boolean
  private readonly now: () => number
  /** matchKey (`code:startedAt`) -> index entry, in insertion order. */
  private readonly index = new Map<string, MatchLogIndexEntry>()
  /** The match currently open for a room code (a rematch opens a new file). */
  private readonly openByRoom = new Map<string, string>()
  /** Highest match stamp used so far, so file names never collide. */
  private lastStamp = 0
  /** Идентичность процесса: пишется в каждую строку, чтобы «матчи с разных перезапусков» были видны. */
  private bootId: string
  /** Время последней записанной строки на файл — ради `dt` (интервалы читаются глазами плохо). */
  private lastLineT = new Map<string, number>()

  constructor(options: MatchLogOptions = {}) {
    this.dir = options.dir ?? DEFAULT_DIR
    this.maxFiles = options.maxFiles ?? 300
    this.enabled = options.enabled ?? true
    this.now = options.now ?? (() => Date.now())
    this.bootId = options.bootId ?? BOOT_ID
    if (this.enabled) this.scan()
  }

  get directory(): string {
    return this.dir
  }

  // ====== writing ======

  startMatch(record: MatchStartRecord): string {
    if (!this.enabled) return ''
    // Two matches can start inside the same millisecond (a rematch, or two rooms at once), and the
    // file name *is* the identity of a match — so the stamp is forced strictly increasing.
    const startedAt = Math.max(this.now(), this.lastStamp + 1)
    this.lastStamp = startedAt
    const key = `${record.code}:${startedAt}`
    const file = `${fileStamp(startedAt)}-${record.code}-${String(startedAt).padStart(13, '0')}.jsonl`
    const entry: MatchLogIndexEntry = {
      file,
      code: record.code,
      seed: record.seed,
      startTime: record.startTime,
      startedAt,
      startedAtIso: new Date(startedAt).toISOString(),
      players: record.players,
      events: 0,
      bytes: 0,
      closed: false,
      matchId: randomUUID().slice(0, 8),
      boot: this.bootId,
    }
    this.index.set(key, entry)
    this.openByRoom.set(record.code, key)
    this.ensureDir()
    this.append(file, {
      t: startedAt,
      room: record.code,
      event: 'match_start',
      schema: MATCH_LOG_SCHEMA,
      data: { seed: record.seed, startTime: record.startTime, players: record.players, config: record.config ?? null },
    }, entry)
    this.prune()
    return key
  }

  /**
   * One observed event for the match that is open for `code` (a no-op when logging is off).
   * Events still land after the match is marked closed: in the anticheat path the socket drop and
   * the grace expiry happen *after* match_over, and they are exactly the lines that explain it.
   */
  event(code: string, event: string, playerId?: string, data?: unknown): void {
    if (!this.enabled) return
    const key = this.openByRoom.get(code)
    if (!key) return
    const entry = this.index.get(key)
    if (!entry) return
    this.append(entry.file, { t: this.now(), room: code, event, playerId, data }, entry)
  }

  close(code: string, verdict?: { reason: string; detail?: string; winnerId: string | null }): void {
    if (!this.enabled) return
    const key = this.openByRoom.get(code)
    if (!key) return
    const entry = this.index.get(key)
    if (!entry) return
    if (verdict) entry.verdict = verdict
    // The closure is written, not just remembered: after a restart the index is rebuilt from files,
    // and "did this match end cleanly or was the server killed mid-match" matters when reading it.
    this.append(entry.file, { t: this.now(), room: code, event: 'match_closed', data: verdict ?? {} }, entry)
    entry.closed = true
    // openByRoom stays: the lines that explain an ending (socket drop, grace expiry) arrive after
    // it. A rematch for the same room opens a new file and replaces the pointer.
  }

  /** Forget the current file for a room without writing anything (room deleted). */
  forget(code: string): void {
    this.openByRoom.delete(code)
  }

  // ====== reading (for the API and the CLI tool) ======

  list(): MatchLogIndexEntry[] {
    return [...this.index.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  readLines(file: string): MatchLogLine[] {
    if (!isSafeLogFileName(file)) return []
    const path = join(this.dir, file)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as MatchLogLine
        } catch {
          return null // a torn last line (a crash mid-append) is skipped, not fatal
        }
      })
      .filter((line): line is MatchLogLine => line !== null)
  }

  readBundle(file: string): ReplayBundle | null {
    return bundleFromLines(this.readLines(file))
  }

  // ====== internals ======

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private append(file: string, line: MatchLogLine, entry?: MatchLogIndexEntry): void {
    try {
      this.ensureDir()
      const target = entry ?? this.findEntryByFile(file)
      // Каждая строка читается сама по себе: какой матч, какое место, сколько прошло времени,
      // какой процесс это записал. Без этого лог из нескольких матчей одной комнаты превращается
      // в «разберитесь сами».
      const stamped: MatchLogLine = { ...line }
      if (target?.matchId) stamped.mid = target.matchId
      if (target?.boot) stamped.boot = target.boot
      if (line.playerId && target?.players?.length) {
        const seat = target.players.find((p) => p.playerId === line.playerId)?.playerIndex
        if (seat !== undefined) stamped.seat = seat
      }
      const prev = this.lastLineT.get(file)
      if (prev !== undefined) stamped.dt = Math.max(0, line.t - prev)
      this.lastLineT.set(file, line.t)
      const text = `${JSON.stringify(stamped)}\n`
      appendFileSync(join(this.dir, file), text)
      if (target) {
        target.events += 1
        target.bytes += text.length
      }
    } catch (err) {
      // A log must never take the match down: the game is the product, the log is the diagnostic.
      console.warn('[mp] match log write failed:', (err as Error).message)
    }
  }

  private findEntryByFile(file: string): MatchLogIndexEntry | undefined {
    for (const entry of this.index.values()) if (entry.file === file) return entry
    return undefined
  }

  /** Rebuild the index from disk so the API answers after a restart. */
  private scan(): void {
    if (!existsSync(this.dir)) return
    let files: string[]
    try {
      files = readdirSync(this.dir).filter(isSafeLogFileName)
    } catch (err) {
      console.warn('[mp] match log scan failed:', (err as Error).message)
      return
    }
    for (const file of files) {
      const lines = this.readLines(file)
      const start = lines.find((l) => l.event === 'match_start')
      if (!start) continue
      const over = lines.find((l) => l.event === 'match_over')
      const closed = lines.find((l) => l.event === 'match_closed')
      const data = (start.data ?? {}) as { seed?: number; startTime?: number; players?: MatchLogPlayer[] }
      const endData = ((closed?.data ?? over?.data ?? {}) as { reason?: string; detail?: string; winnerId?: string | null })
      const verdict = closed || over
        ? { reason: String(endData.reason ?? ''), detail: endData.detail, winnerId: endData.winnerId ?? null }
        : undefined
      // `2026-11-02-AB12-<13-digit epoch ms>.jsonl`
      const startedAt = startedAtFromFile(file)
      if (startedAt > this.lastStamp) this.lastStamp = startedAt
      this.index.set(`${start.room}:${startedAt}`, {
        file,
        code: start.room,
        seed: typeof data.seed === 'number' ? data.seed : 0,
        startTime: typeof data.startTime === 'number' ? data.startTime : 0,
        startedAt,
        startedAtIso: new Date(startedAt).toISOString(),
        players: Array.isArray(data.players) ? data.players : [],
        events: lines.length,
        bytes: statSync(join(this.dir, file)).size,
        closed: Boolean(closed || over),
        verdict,
        matchId: typeof start.mid === 'string' ? start.mid : undefined,
        boot: typeof start.boot === 'string' ? start.boot : undefined,
      })
    }
  }

  private prune(): void {
    const files = [...this.index.values()].sort((a, b) => a.startedAt - b.startedAt)
    while (files.length > this.maxFiles) {
      const oldest = files.shift()
      if (!oldest) break
      try {
        rmSync(join(this.dir, oldest.file))
        this.index.delete(`${oldest.code}:${oldest.startedAt}`)
      } catch { /* already gone */ }
    }
  }
}
