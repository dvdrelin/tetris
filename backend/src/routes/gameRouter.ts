import { Router } from 'express'
import { ScoreService } from '../services/scoreService'

const router = Router()
const scoreService = new ScoreService()

// Save score
router.post('/score', (req: any, res: any) => {
  const { playerName, score, mode, level, linesCleared } = req.body
  if (!playerName || score === undefined) {
    res.status(400).json({ error: 'playerName and score are required' })
    return
  }

  scoreService.saveScore(playerName, score, mode || 0, level || 1, linesCleared || 0)
  res.json({ success: true })
})

// Get top scores
router.get('/scores', (req: any, res: any) => {
  const mode = req.query.mode ? parseInt(req.query.mode as string) : -1
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 10

  const scores = scoreService.getTopScores(mode, limit)
  res.json({ scores })
})

// Get leaderboard
router.get('/leaderboard', (req: any, res: any) => {
  const mode = req.query.mode ? parseInt(req.query.mode as string) : -1

  const leaderboard = scoreService.getLeaderboard(mode)
  res.json({ leaderboard })
})

// Get player stats
router.get('/player/:name', (req: any, res: any) => {
  const name = req.params.name
  const stats = scoreService.getPlayerStats(name)
  const scores = scoreService.getPlayerScores(name, 10)
  res.json({ name, stats, scores })
})

export const createGameRouter = (): Router => router
