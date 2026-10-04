import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'fs'
import { dirname, join } from 'path'

export interface ScoreServiceOptions {
  dbPath?: string
}

const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data', 'scores.json')

// The directory that must exist for the scores file to be writable.
function getDBDir(dbPath: string): string {
  return dirname(dbPath)
}

function loadScores(dbPath: string): ScoreEntry[] {
  const dir = getDBDir(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(dbPath)) {
    // A fresh install simply has no scores yet: not an error.
    return []
  }
  try {
    const data = readFileSync(dbPath, 'utf-8')
    const parsed = JSON.parse(data)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('ScoreService: failed to load scores.json:', err)
    return []
  }
}

function saveScores(dbPath: string, scores: ScoreEntry[]): void {
  const dir = getDBDir(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tmpPath = `${dbPath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(scores, null, 2))
  renameSync(tmpPath, dbPath)
}

export interface ScoreEntry {
  id: string
  player_name: string
  score: number
  mode: number
  level: number
  lines_cleared: number
  created_at: string
}

export interface LeaderboardEntry {
  player: string
  totalScore: number
  games: number
  highScore: number
}

/** Result of the read-only self-check of the scores store (see ScoreService.health). */
export type DbHealthCheck = {
  ok: boolean
  writable: boolean
  count: number
  bytes: number
  mtimeMs: number | null
  error?: string
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    return code ? `${code}: ${err.message}` : err.message
  }
  return String(err)
}

export class ScoreService {
  private scores: ScoreEntry[]
  private readonly dbPath: string

  constructor(options?: ScoreServiceOptions) {
    this.dbPath = options?.dbPath ?? DEFAULT_DB_PATH
    this.scores = loadScores(this.dbPath)
  }

  saveScore(playerName: string, score: number, mode: number, level: number, linesCleared: number): void {
    this.scores.push({
      id: crypto.randomUUID(),
      player_name: playerName,
      score,
      mode,
      level,
      lines_cleared: linesCleared,
      created_at: new Date().toISOString(),
    })
    saveScores(this.dbPath, this.scores)
  }

  getTopScores(mode: number = -1, limit: number = 10): ScoreEntry[] {
    let scores = mode >= 0 ? this.scores.filter(s => s.mode === mode) : this.scores
    return scores.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  getLeaderboard(mode: number = -1): LeaderboardEntry[] {
    let scores = mode >= 0 ? this.scores.filter(s => s.mode === mode) : this.scores
    const map = new Map<string, LeaderboardEntry>()
    for (const s of scores) {
      const entry = map.get(s.player_name)
      if (entry) {
        entry.totalScore += s.score
        entry.games++
        if (s.score > entry.highScore) entry.highScore = s.score
      } else {
        map.set(s.player_name, { player: s.player_name, totalScore: s.score, games: 1, highScore: s.score })
      }
    }

    return Array.from(map.values()).sort((a, b) => b.highScore - a.highScore)
  }

  getPlayerStats(playerName: string) {
    const p = this.scores.filter(s => s.player_name === playerName)
    if (p.length === 0) return { games: 0, highScore: 0, totalScore: 0, averageScore: 0 }

    const total = p.reduce((a, b) => a + b.score, 0)
    return {
      games: p.length,
      highScore: Math.max(...p.map(s => s.score)),
      totalScore: total,
      averageScore: Math.floor(total / p.length),
    }
  }

  getPlayerScores(playerName: string, limit: number = 10): ScoreEntry[] {
    return this.scores
      .filter(s => s.player_name === playerName)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Read-only self-check of the store, used by GET /api/health.
   *
   * It verifies that the data directory exists (creating it if the app was just started),
   * that scores.json parses as an array (a missing file is a fresh install, not an error),
   * and that the directory is actually writable. Writability is probed with a separate
   * file (`.health-probe` next to scores.json) which is always removed in a finally block:
   * health() never writes scores.json and never changes its mtime.
   */
  health(): DbHealthCheck {
    const dir = getDBDir(this.dbPath)
    const probePath = join(dir, '.health-probe')

    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      let count = 0
      let bytes = 0
      let mtimeMs: number | null = null

      if (existsSync(this.dbPath)) {
        const raw = readFileSync(this.dbPath, 'utf-8')
        bytes = Buffer.byteLength(raw)
        mtimeMs = statSync(this.dbPath).mtimeMs
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) {
          return { ok: false, writable: false, count: 0, bytes, mtimeMs, error: 'scores.json is not a JSON array' }
        }
        count = parsed.length
      }

      let writable = false
      try {
        const token = `health-probe ${Date.now()}`
        writeFileSync(probePath, token)
        writable = readFileSync(probePath, 'utf-8') === token
      } finally {
        try {
          rmSync(probePath, { force: true })
        } catch {
          // Best effort: a leftover probe file must not change the health verdict.
        }
      }

      return {
        ok: writable,
        writable,
        count,
        bytes,
        mtimeMs,
        ...(writable ? {} : { error: 'scores directory is not writable' }),
      }
    } catch (err) {
      return { ok: false, writable: false, count: 0, bytes: 0, mtimeMs: null, error: describeError(err) }
    }
  }
}
