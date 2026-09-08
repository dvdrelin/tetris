import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'

const DB_DIR = join(__dirname, '..', '..', 'data')
const DB_PATH = join(DB_DIR, 'scores.json')

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true })
}

function loadScores(): ScoreEntry[] {
  try {
    const data = readFileSync(DB_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (err) {
    console.warn('ScoreService: failed to load scores.json:', err)
    return []
  }
}

function saveScores(scores: ScoreEntry[]): void {
  const tmpPath = `${DB_PATH}.tmp`
  writeFileSync(tmpPath, JSON.stringify(scores, null, 2))
  renameSync(tmpPath, DB_PATH)
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

export class ScoreService {
  private scores: ScoreEntry[]

  constructor() {
    this.scores = loadScores()
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
    saveScores(this.scores)
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
}
