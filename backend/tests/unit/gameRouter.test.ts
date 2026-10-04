import express from 'express'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// NOTE: @types/supertest is not installed in this workspace, so the import is untyped.
import request from 'supertest'
import { ScoreService } from '../../src/services/scoreService'
import { createGameRouter } from '../../src/routes/gameRouter'

describe('gameRouter validation', () => {
  let dir: string
  let service: ScoreService
  let app: express.Express

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'neon-tetris-scores-'))
    // The data directory does not exist yet: ScoreService must create it itself.
    service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    app = express()
    app.use(express.json())
    app.use('/api', createGameRouter(service))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('the scores directory is created on demand (no uncaught ENOENT)', () => {
    expect(existsSync(join(dir, 'data'))).toBe(true)
  })

  test('a valid score is accepted and readable back', async () => {
    const res = await request(app)
      .post('/api/score')
      .send({ playerName: 'Alice', score: 1200, mode: 0, level: 3, linesCleared: 4 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const list = await request(app).get('/api/scores')
    expect(list.status).toBe(200)
    expect(list.body.scores[0]).toMatchObject({ player_name: 'Alice', score: 1200, mode: 0 })
  })

  test('missing or empty playerName is rejected', async () => {
    const res = await request(app).post('/api/score').send({ score: 10 })
    expect(res.status).toBe(400)
  })

  test('an over-long playerName is rejected', async () => {
    const res = await request(app).post('/api/score').send({ playerName: 'x'.repeat(33), score: 10 })
    expect(res.status).toBe(400)
  })

  test('negative, fractional, non-numeric and absurd scores are rejected', async () => {
    for (const score of [-5, 1.5, 'abc', 1_000_001, null]) {
      const res = await request(app).post('/api/score').send({ playerName: 'Bob', score })
      expect(res.status).toBe(400)
    }
  })

  test('an unknown mode is rejected', async () => {
    const res = await request(app).post('/api/score').send({ playerName: 'Bob', score: 10, mode: 7 })
    expect(res.status).toBe(400)
  })

  test('out-of-range level and linesCleared are rejected', async () => {
    const a = await request(app).post('/api/score').send({ playerName: 'Bob', score: 10, level: 1000 })
    expect(a.status).toBe(400)
    const b = await request(app).post('/api/score').send({ playerName: 'Bob', score: 10, linesCleared: -1 })
    expect(b.status).toBe(400)
  })

  test('mode filter works', async () => {
    await request(app).post('/api/score').send({ playerName: 'Carol', score: 900, mode: 1 })
    const res = await request(app).get('/api/scores?mode=1')
    expect(res.body.scores.every((s: any) => s.mode === 1)).toBe(true)
    expect(res.body.scores[0]).toMatchObject({ player_name: 'Carol' })
  })

  test('limit is clamped to [1, 100] instead of being trusted', async () => {
    for (let i = 1; i <= 12; i++) {
      await request(app).post('/api/score').send({ playerName: `P${i}`, score: i, mode: 0 })
    }
    const huge = await request(app).get('/api/scores?limit=100000')
    expect(huge.body.scores.length).toBeLessThanOrEqual(100)
    const zero = await request(app).get('/api/scores?limit=0')
    expect(zero.body.scores.length).toBe(1)
    const five = await request(app).get('/api/scores?limit=5')
    expect(five.body.scores.length).toBe(5)
  })

  test('omitted optional fields fall back to defaults', async () => {
    const res = await request(app).post('/api/score').send({ playerName: 'Dave', score: 42 })
    expect(res.status).toBe(200)
    const list = await request(app).get('/api/scores?limit=100')
    const dave = list.body.scores.find((s: any) => s.player_name === 'Dave')
    expect(dave).toMatchObject({ score: 42, mode: 0, level: 1, lines_cleared: 0 })
  })

  test('leaderboard aggregates per player', async () => {
    const res = await request(app).get('/api/leaderboard')
    expect(res.status).toBe(200)
    const alice = res.body.leaderboard.find((e: any) => e.player === 'Alice')
    expect(alice).toMatchObject({ games: 1, highScore: 1200, totalScore: 1200 })
  })

  test('player stats endpoint answers for unknown players without crashing', async () => {
    const res = await request(app).get('/api/player/nobody')
    expect(res.status).toBe(200)
    expect(res.body.stats).toEqual({ games: 0, highScore: 0, totalScore: 0, averageScore: 0 })
  })
})
