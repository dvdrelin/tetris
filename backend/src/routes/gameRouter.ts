import { Router, Request, Response } from 'express'
import { ScoreService } from '../services/scoreService'
import { RateLimiter } from '../middleware/rate-limit'

function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Hard bounds: this API is public, so every numeric field is range-checked before it
// reaches the store (an unbounded score or limit is a storage/memory vector).
// D2: scoreMax used to be 1 000 000, which a real (if skilled) session can legitimately exceed;
// the ceiling now guards only against absurd values, while the frequency limit (D1) does the
// actual abuse control.
export const LIMITS = {
  playerNameMax: 32,
  scoreMax: 10_000_000,
  levelMax: 999,
  linesClearedMax: 1000,
  queryLimitMax: 100,
}

function toBoundedInt(value: unknown, min: number, max: number): number | null {
  const n = toInt(value)
  if (n === null || !Number.isInteger(n) || n < min || n > max) return null
  return n
}

/**
 * The router is built by a factory so callers (and tests) can inject their own
 * ScoreService instead of sharing one module-level instance. `scoreLimiter` is optional:
 * when it is absent the route behaves exactly as before (useful for unit tests that POST a lot).
 */
export interface GameRouterOptions {
  scoreLimiter?: RateLimiter;
}

/**
 * The app runs behind nginx-proxy, so `req.ip` is only meaningful when Express is told to trust
 * one proxy hop (`app.set('trust proxy', ...)` in index.ts). Without that the limiter would key
 * every player by the proxy container's address and throttle the whole site as one client.
 */
function clientKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export const createGameRouter = (
  scoreService: ScoreService = new ScoreService(),
  options: GameRouterOptions = {},
): Router => {
  const router = Router()
  const { scoreLimiter } = options

  // Save score
  router.post('/score', (req: Request, res: Response) => {
    if (scoreLimiter) {
      const verdict = scoreLimiter.check(clientKey(req))
      if (!verdict.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))
        res.setHeader('Retry-After', String(retryAfterSec))
        res.setHeader('X-RateLimit-Limit', String(scoreLimiter.limit))
        res.setHeader('X-RateLimit-Remaining', '0')
        res.status(429).json({ error: 'too many score submissions', retryAfter: retryAfterSec })
        return
      }
      res.setHeader('X-RateLimit-Limit', String(scoreLimiter.limit))
      res.setHeader('X-RateLimit-Remaining', String(verdict.remaining))
    }

    const body = req.body || {}
    const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : ''
    if (playerName.length === 0 || playerName.length > LIMITS.playerNameMax) {
      res.status(400).json({ error: `playerName must be a non-empty string of at most ${LIMITS.playerNameMax} characters` })
      return
    }

    const score = toBoundedInt(body.score, 0, LIMITS.scoreMax)
    if (score === null) {
      res.status(400).json({ error: `score must be an integer between 0 and ${LIMITS.scoreMax}` })
      return
    }

    // An omitted field falls back to its default; a supplied but out-of-range value is rejected.
    const mode = body.mode === undefined ? 0 : toInt(body.mode)
    if (mode !== 0 && mode !== 1) {
      res.status(400).json({ error: 'mode must be 0 (Arcade) or 1 (Hardcore)' })
      return
    }

    const level = body.level === undefined ? 1 : toBoundedInt(body.level, 1, LIMITS.levelMax)
    if (level === null) {
      res.status(400).json({ error: `level must be an integer between 1 and ${LIMITS.levelMax}` })
      return
    }

    const linesCleared = body.linesCleared === undefined ? 0 : toBoundedInt(body.linesCleared, 0, LIMITS.linesClearedMax)
    if (linesCleared === null) {
      res.status(400).json({ error: `linesCleared must be an integer between 0 and ${LIMITS.linesClearedMax}` })
      return
    }

    scoreService.saveScore(playerName, score, mode, level, linesCleared)
    res.json({ success: true })
  })

  // Get top scores
  router.get('/scores', (req: Request, res: Response) => {
    const mode = toInt(req.query.mode) ?? -1
    const requested = toInt(req.query.limit)
    // An absent limit uses the default; an out-of-range one is clamped, never trusted.
    const limit = requested === null ? 10 : Math.min(Math.max(requested, 1), LIMITS.queryLimitMax)
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

  return router
}
