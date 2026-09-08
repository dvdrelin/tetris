import { Router, Request, Response } from 'express'
import { ScoreService } from '../services/scoreService'

const router = Router()
const scoreService = new ScoreService()

function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Save score
router.post('/score', (req: Request, res: Response) => {
  const body = req.body || {}
  const playerName = typeof body.playerName === 'string' && body.playerName.trim() !== '' ? body.playerName : null
  const score = typeof body.score === 'number' && Number.isFinite(body.score) ? body.score : null

  if (!playerName || score === null) {
    res.status(400).json({ error: 'playerName and a finite score are required' })
    return
  }

  scoreService.saveScore(playerName, score, typeof body.mode === 'number' ? body.mode : 0, typeof body.level === 'number' ? body.level : 1, typeof body.linesCleared === 'number' ? body.linesCleared : 0)
  res.json({ success: true })
})

// Get top scores
router.get('/scores', (req: Request, res: Response) => {
  const mode = toInt(req.query.mode) ?? -1
  const limit = toInt(req.query.limit) ?? 10
  const scores = scoreService.getTopScores(mode, limit)
  res.json({ scores })
})

// Get leaderboard
router.get('/leaderboard', (req: Request, res: Response) => {
  const mode = toInt(req.query.mode) ?? -1
  const leaderboard = scoreService.getLeaderboard(mode)
  res.json({ leaderboard })
})

// Get player stats
router.get('/player/:name', (req: Request, res: Response) => {
  const name = req.params.name
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'invalid player name' })
    return
  }
  const stats = scoreService.getPlayerStats(name)
  const scores = scoreService.getPlayerScores(name, 10)
  res.json({ name, stats, scores })
})

export const createGameRouter = (): Router => router
