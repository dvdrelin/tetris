import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// NOTE: @types/supertest is not installed in this workspace, so the import is untyped.
import request from 'supertest'
import express from 'express'
import { RateLimiter } from '../../src/middleware/rate-limit'
import { ScoreService } from '../../src/services/scoreService'
import { createGameRouter, LIMITS } from '../../src/routes/gameRouter'

describe('RateLimiter (pure)', () => {
  let now = 1_000
  const clock = () => now

  beforeEach(() => { now = 1_000 })

  test('allows `max` hits per window and blocks the next one', () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 3, now: clock })
    expect(rl.check('a')).toEqual({ allowed: true, retryAfterMs: 0, remaining: 2 })
    expect(rl.check('a').remaining).toBe(1)
    expect(rl.check('a').remaining).toBe(0)

    const blocked = rl.check('a')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(1000)
    expect(blocked.remaining).toBe(0)
  })

  test('keys are independent', () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 1, now: clock })
    expect(rl.check('a').allowed).toBe(true)
    expect(rl.check('a').allowed).toBe(false)
    expect(rl.check('b').allowed).toBe(true)
  })

  test('the window slides: a blocked key opens again once the oldest hit expires', () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 2, now: clock })
    rl.check('a'); rl.check('a')
    now += 999
    expect(rl.check('a').allowed).toBe(false)
    now += 1 // the first hit (t=1000) is now 1000 ms old → outside the window
    expect(rl.check('a').allowed).toBe(true)
  })

  test('Retry-After shrinks as the window ages', () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 1, now: clock })
    rl.check('a')
    expect(rl.check('a').retryAfterMs).toBe(1000)
    now += 400
    expect(rl.check('a').retryAfterMs).toBe(600)
  })

  test('stale keys are evicted, so the map cannot grow without bound', () => {
    const rl = new RateLimiter({ windowMs: 100, max: 1, now: clock, maxKeys: 3 })
    for (let i = 0; i < 3; i++) expect(rl.check(`k${i}`).allowed).toBe(true)
    expect(rl.size).toBe(3)

    now += 1000 // everything tracked is now stale
    // max is 1, so this key is allowed exactly once — the second hit of the same key is refused.
    expect(rl.check('fresh').allowed).toBe(true)
    expect(rl.check('fresh').allowed).toBe(false)
    // The stale trio was dropped by the maintenance sweep when 'fresh' was inserted.
    expect(rl.size).toBe(1)
  })

  test('rejects nonsensical configuration', () => {
    expect(() => new RateLimiter({ windowMs: 0, max: 5 })).toThrow(RangeError)
    expect(() => new RateLimiter({ windowMs: 1000, max: 0 })).toThrow(RangeError)
    expect(() => new RateLimiter({ windowMs: 1000, max: 2.5 })).toThrow(RangeError)
  })

  test('limit/window getters report the configured posture', () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 30 })
    expect(rl.limit).toBe(30)
    expect(rl.window).toBe(60_000)
    rl.reset()
    expect(rl.size).toBe(0)
  })
})

describe('POST /api/score rate limit (D1) and score ceiling (D2)', () => {
  let dir: string
  let service: ScoreService

  const buildApp = (limiter?: RateLimiter) => {
    const app = express()
    app.set('trust proxy', 1)
    app.use(express.json())
    app.use('/api', createGameRouter(service, limiter ? { scoreLimiter: limiter } : {}))
    return app
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'neon-tetris-limits-'))
    service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('D2: 10 000 000 is a legal score, 10 000 001 is not', async () => {
    const app = buildApp()
    const ok = await request(app).post('/api/score').send({ playerName: 'Big', score: 10_000_000 })
    expect(ok.status).toBe(200)

    const over = await request(app).post('/api/score').send({ playerName: 'Big', score: 10_000_001 })
    expect(over.status).toBe(400)
    expect(over.body.error).toContain('10000000')

    // The old ceiling (1 000 000) is no longer the boundary: it is accepted now.
    const oldBoundary = await request(app).post('/api/score').send({ playerName: 'Big', score: 1_500_000 })
    expect(oldBoundary.status).toBe(200)
    expect(LIMITS.scoreMax).toBe(10_000_000)
  })

  test('D1: the limiter answers 429 with Retry-After and does not store the score', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 2 })
    const app = buildApp(limiter)

    const before = await request(app).get('/api/scores?limit=100')
    const beforeCount = before.body.scores.filter((s: any) => s.player_name === 'Spam').length

    const first = await request(app).post('/api/score').send({ playerName: 'Spam', score: 1 })
    expect(first.status).toBe(200)
    expect(first.headers['x-ratelimit-limit']).toBe('2')
    expect(first.headers['x-ratelimit-remaining']).toBe('1')

    const second = await request(app).post('/api/score').send({ playerName: 'Spam', score: 2 })
    expect(second.status).toBe(200)
    expect(second.headers['x-ratelimit-remaining']).toBe('0')

    const third = await request(app).post('/api/score').send({ playerName: 'Spam', score: 3 })
    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBeTruthy()
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0)
    expect(third.body.error).toBe('too many score submissions')
    expect(third.body.retryAfter).toBe(Number(third.headers['retry-after']))

    const after = await request(app).get('/api/scores?limit=100')
    const afterCount = after.body.scores.filter((s: any) => s.player_name === 'Spam').length
    expect(afterCount - beforeCount).toBe(2) // the 429 request never reached the store
  })

  test('a different client is not affected by the first one', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 1 })
    const app = buildApp(limiter)

    const a = await request(app).post('/api/score').set('X-Forwarded-For', '203.0.113.1').send({ playerName: 'A1', score: 5 })
    expect(a.status).toBe(200)
    const aBlocked = await request(app).post('/api/score').set('X-Forwarded-For', '203.0.113.1').send({ playerName: 'A2', score: 5 })
    expect(aBlocked.status).toBe(429)

    const b = await request(app).post('/api/score').set('X-Forwarded-For', '203.0.113.2').send({ playerName: 'B1', score: 5 })
    expect(b.status).toBe(200)
  })

  test('the limiter covers only POST /score — reads and health stay unlimited', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 1 })
    const app = buildApp(limiter)

    await request(app).post('/api/score').send({ playerName: 'Read', score: 1 })
    await request(app).post('/api/score').send({ playerName: 'Read', score: 1 }).expect(429)

    for (let i = 0; i < 20; i++) {
      await request(app).get('/api/scores').expect(200)
      await request(app).get('/api/leaderboard').expect(200)
    }
    await request(app).post('/api/score').send({ playerName: 'Read', score: -1 }).expect(429) // the limiter sheds before parsing
  })

  test('under the limit, body validation keeps answering 400 (limiter does not mask it)', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 5 })
    const app = buildApp(limiter)
    await request(app).post('/api/score').send({ playerName: 'Read', score: -1 }).expect(400)
    await request(app).post('/api/score').send({ playerName: '', score: 1 }).expect(400)
  })

  test('without a limiter the route behaves as before (tests can POST freely)', async () => {
    const app = buildApp()
    for (let i = 0; i < 40; i++) {
      const res = await request(app).post('/api/score').send({ playerName: `Bulk${i % 5}`, score: i })
      expect(res.status).toBe(200)
    }
  })
})
