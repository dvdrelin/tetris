import express from 'express'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// NOTE: @types/supertest is not installed in this workspace, so the import is untyped.
import request from 'supertest'
import { ScoreService } from '../../src/services/scoreService'
import { createGameRouter } from '../../src/routes/gameRouter'
import { createHealthRouter } from '../../src/routes/healthRouter'

const PROBE_FILE = '.health-probe'

/** A minimal stand-in for frontend/dist: index.html + one hashed asset. */
function makeDist(root: string, extraAssets = 1): string {
  const dist = join(root, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!DOCTYPE html><html><body>spa</body></html>')
  for (let i = 0; i < extraAssets; i++) {
    writeFileSync(join(dist, 'assets', `index-hash${i}.js`), 'console.log(1)')
  }
  return dist
}

interface AppOptions {
  scoreService: ScoreService
  distPath: string
  clients?: () => number
  version?: string
  /** Mirror production: static + SPA catch-all mounted after the API routes. */
  withSpaCatchAll?: boolean
}

function buildApp(options: AppOptions): express.Express {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/health',
    createHealthRouter({
      scoreService: options.scoreService,
      distPath: options.distPath,
      clients: options.clients ?? (() => 0),
      version: options.version,
    }),
  )
  app.use('/api', createGameRouter(options.scoreService))
  if (options.withSpaCatchAll) {
    app.use(express.static(options.distPath))
    app.get('*', (_req, res) => res.sendFile(join(options.distPath, 'index.html')))
  }
  return app
}

describe('GET /api/health', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'neon-tetris-health-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('healthy store answers 200 with status ok and a writable db', async () => {
    const dbPath = join(dir, 'data', 'scores.json')
    const service = new ScoreService({ dbPath })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.timestamp).toBe('string')
    expect(typeof res.body.uptimeSec).toBe('number')
    expect(res.body.checks.db.ok).toBe(true)
    expect(res.body.checks.db.writable).toBe(true)
    // A fresh install has no scores yet: that is ok, not degraded.
    expect(res.body.checks.db.count).toBe(0)
    expect(res.body.checks.db.bytes).toBe(0)
    expect(res.body.checks.db.mtimeMs).toBeNull()
    expect(res.body.checks.static.ok).toBe(true)
    expect(res.body.checks.static.assetCount).toBe(1)
    expect(res.body.checks.websocket.ok).toBe(true)
    expect(res.body.checks.websocket.path).toBe('/ws')
    expect(res.body.checks.runtime.ok).toBe(true)
    expect(res.body.checks.api.ok).toBe(true)
  })

  test('the write probe uses a separate file and is always removed', async () => {
    const dataDir = join(dir, 'data')
    const service = new ScoreService({ dbPath: join(dataDir, 'scores.json') })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(existsSync(join(dataDir, PROBE_FILE))).toBe(false)
  })

  test('db check reports the real record count, size and mtime', async () => {
    const dbPath = join(dir, 'data', 'scores.json')
    const service = new ScoreService({ dbPath })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

    await request(app).post('/api/score').send({ playerName: 'Alice', score: 1200, mode: 0, level: 3, linesCleared: 4 })
    await request(app).post('/api/score').send({ playerName: 'Bob', score: 700, mode: 1 })

    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.checks.db.count).toBe(2)
    expect(res.body.checks.db.bytes).toBeGreaterThan(0)
    expect(typeof res.body.checks.db.mtimeMs).toBe('number')
    expect(res.body.checks.api.scoreRecords).toBe(2)
    expect(res.body.checks.api.leaderboardEntries).toBe(2)
  })

  test('health never mutates scores.json (bytes and mtime stay identical)', async () => {
    const dbPath = join(dir, 'data', 'scores.json')
    const service = new ScoreService({ dbPath })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

    await request(app).post('/api/score').send({ playerName: 'Alice', score: 100 })
    const before = statSync(dbPath)

    await request(app).get('/api/health')
    await request(app).get('/api/health')

    const after = statSync(dbPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    expect(readFileSync(dbPath, 'utf-8')).toContain('Alice')
  })

  test('degraded db: data directory cannot be created (mkdir fails) -> 503', async () => {
    // The service is created while data/sub is a real directory, then that directory is
    // replaced by a regular file: the next health() must fail on mkdirSync, not crash.
    const service = new ScoreService({ dbPath: join(dir, 'data', 'sub', 'scores.json') })
    rmSync(join(dir, 'data'), { recursive: true, force: true })
    writeFileSync(join(dir, 'data'), 'this is a file, not a directory')

    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.checks.db.ok).toBe(false)
    expect(res.body.checks.db.writable).toBe(false)
    expect(String(res.body.checks.db.error)).toContain('ENOTDIR')
    // The other checks still report, and the answer is still JSON.
    expect(res.body.checks.static.ok).toBe(true)
  })

  test('degraded db: scores.json is not valid JSON -> 503', async () => {
    const dbPath = join(dir, 'data', 'scores.json')
    const service = new ScoreService({ dbPath })
    writeFileSync(dbPath, '{ this is not a JSON array ]')

    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(503)
    expect(res.body.checks.db.ok).toBe(false)
  })

  test('degraded static: missing dist directory -> 503', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const app = buildApp({ scoreService: service, distPath: join(dir, 'no-such-dist') })

    const res = await request(app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body.checks.static.ok).toBe(false)
    expect(res.body.checks.static.indexHtml).toBe('missing')
    expect(res.body.checks.static.assetCount).toBe(0)
    expect(res.body.checks.db.ok).toBe(true)
  })

  test('degraded static: index.html present but assets/ is empty -> 503', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const dist = makeDist(dir, 0)

    const app = buildApp({ scoreService: service, distPath: dist })
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(503)
    expect(res.body.checks.static.ok).toBe(false)
    expect(res.body.checks.static.indexHtml).toBe('present')
    expect(res.body.checks.static.assetCount).toBe(0)
  })

  test('degraded websocket: a throwing client provider degrades the report -> 503', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const app = buildApp({
      scoreService: service,
      distPath: makeDist(dir),
      clients: () => {
        throw new Error('wss is gone')
      },
    })

    const res = await request(app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body.checks.websocket.ok).toBe(false)
    expect(String(res.body.checks.websocket.error)).toContain('wss is gone')
  })

  test('websocket check reports live client count', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir), clients: () => 3 })

    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.checks.websocket.clients).toBe(3)
  })

  test('runtime check reports node version, uptime and memory; version comes from package.json', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

    const res = await request(app).get('/api/health')
    expect(res.body.version).toBe('1.0.0')
    expect(res.body.checks.runtime.node).toBe(process.version)
    expect(res.body.checks.runtime.uptimeSec).toBeGreaterThanOrEqual(0)
    expect(res.body.checks.runtime.rssBytes).toBeGreaterThan(0)
    expect(typeof res.body.checks.runtime.env).toBe('string')
  })

  test('version comes from APP_VERSION when the build arg is set (deploy.sh format 1.<YYMMDD>.<sha>)', async () => {
    process.env.APP_VERSION = '1.261004.abc1234'
    try {
      const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
      const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
      expect(res.body.version).toBe('1.261004.abc1234')
    } finally {
      delete process.env.APP_VERSION
    }
  })

  test('empty APP_VERSION (docker-compose passes ${APP_VERSION:-}) falls back to package.json', async () => {
    process.env.APP_VERSION = ''
    try {
      const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
      const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
      expect(res.body.version).toBe('1.0.0')
    } finally {
      delete process.env.APP_VERSION
    }
  })

  test('the report contains no absolute paths and no secrets', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const app = buildApp({ scoreService: service, distPath: makeDist(dir) })

    const res = await request(app).get('/api/health')
    const body = JSON.stringify(res.body)
    expect(body).not.toContain(dir)
    expect(body).not.toContain('scores.json')
    expect(body).not.toContain('DEFAULT_EMAIL')
  })

  test('regression: /api/health is JSON, not the SPA HTML, even with static + catch-all mounted', async () => {
    const service = new ScoreService({ dbPath: join(dir, 'data', 'scores.json') })
    const dist = makeDist(dir)
    const app = buildApp({ scoreService: service, distPath: dist, withSpaCatchAll: true })

    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.text.trim().startsWith('<')).toBe(false)
    expect(res.body.status).toBe('ok')

    // A degraded health answer must be JSON as well.
    const broken = buildApp({
      scoreService: new ScoreService({ dbPath: join(dir, 'data2', 'scores.json') }),
      distPath: join(dir, 'missing-dist'),
      withSpaCatchAll: true,
    })
    const degraded = await request(broken).get('/api/health')
    expect(degraded.status).toBe(503)
    expect(degraded.headers['content-type']).toMatch(/application\/json/)
    expect(degraded.text.trim().startsWith('<')).toBe(false)
    expect(degraded.body.status).toBe('degraded')

    // The SPA catch-all itself still works.
    const page = await request(app).get('/some/spa/route')
    expect(page.status).toBe(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)
  })
})
