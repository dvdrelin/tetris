import { Router, Request, Response } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { ScoreService } from '../services/scoreService'

/**
 * Health check for `GET /api/health`.
 *
 * Rules this router is written against:
 *  - the response is ALWAYS JSON (never the SPA HTML), both on 200 and on 503;
 *  - 200 when every check is ok, 503 when any check is degraded;
 *  - no absolute paths and no secrets in the payload (only counts, sizes, versions);
 *  - every check is wrapped in try/catch: a failing check degrades the report, it never
 *    throws and never takes the endpoint down;
 *  - the endpoint is read-only: it never writes to scores.json (the disk probe uses a
 *    separate file that is removed in a finally block).
 */

export interface HealthCheck {
  ok: boolean
  [detail: string]: unknown
}

export interface HealthReport {
  status: 'ok' | 'degraded'
  timestamp: string
  uptimeSec: number
  version: string
  checks: {
    db: HealthCheck
    static: HealthCheck
    websocket: HealthCheck
    runtime: HealthCheck
    api: HealthCheck
  }
}

export interface HealthRouterOptions {
  /** The same ScoreService the game API uses — health must describe the real store. */
  scoreService: ScoreService
  /** Directory that holds the built SPA (index.html + assets/). */
  distPath: string
  /** Live WebSocket connection count, provided by the caller (wss.clients.size). */
  clients?: () => number
  /** WebSocket upgrade path advertised in the report. */
  wsPath?: string
  /** Overrides the version read from package.json (used by tests). */
  version?: string
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    return code ? `${code}: ${err.message}` : err.message
  }
  return String(err)
}

/**
 * Version of the running backend: APP_VERSION (Docker build arg) wins, otherwise the
 * version field of backend/package.json, otherwise "unknown". Never throws.
 */
function resolveVersion(override?: string): string {
  if (override) return override
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    // backend/src/routes -> backend/package.json; compiled: backend/dist/routes -> backend/package.json
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'))
    if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
  } catch {
    // package.json is not required for the endpoint to answer.
  }
  return 'unknown'
}

export const createHealthRouter = (options: HealthRouterOptions): Router => {
  const router = Router()
  const { scoreService, distPath } = options
  const wsPath = options.wsPath ?? '/ws'
  const version = resolveVersion(options.version)

  const checkDb = (): HealthCheck => scoreService.health()

  const checkStatic = (): HealthCheck => {
    try {
      const indexHtml = join(distPath, 'index.html')
      const assetsDir = join(distPath, 'assets')
      const indexPresent = existsSync(indexHtml) && statSync(indexHtml).isFile()
      const assets =
        existsSync(assetsDir) && statSync(assetsDir).isDirectory()
          ? readdirSync(assetsDir).filter((name) => statSync(join(assetsDir, name)).isFile())
          : []
      const ok = indexPresent && assets.length > 0
      return {
        ok,
        indexHtml: indexPresent ? 'present' : 'missing',
        assetCount: assets.length,
        ...(ok ? {} : { error: 'built SPA is missing (index.html and at least one assets/ file are required)' }),
      }
    } catch (err) {
      return { ok: false, indexHtml: 'missing', assetCount: 0, error: errorMessage(err) }
    }
  }

  const checkWebsocket = (): HealthCheck => {
    try {
      if (!options.clients) return { ok: false, clients: 0, path: wsPath, error: 'no WebSocket server attached' }
      const open = options.clients()
      return { ok: Number.isFinite(open) && open >= 0, clients: open, path: wsPath }
    } catch (err) {
      return { ok: false, clients: 0, path: wsPath, error: errorMessage(err) }
    }
  }

  const checkRuntime = (): HealthCheck => {
    try {
      const memory = process.memoryUsage()
      return {
        ok: true,
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        rssBytes: memory.rss,
        env: process.env.NODE_ENV ?? 'development',
        port: process.env.PORT ?? '3000',
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  // Self-check of the API surface through the very same service the REST routes use,
  // without doing an HTTP request to ourselves.
  const checkApi = (): HealthCheck => {
    try {
      const scores = scoreService.getTopScores(-1, 10)
      const leaderboard = scoreService.getLeaderboard(-1)
      const ok = Array.isArray(scores) && Array.isArray(leaderboard)
      return {
        ok,
        routes: ['/api/scores', '/api/leaderboard'],
        scoreRecords: Array.isArray(scores) ? scores.length : 0,
        leaderboardEntries: Array.isArray(leaderboard) ? leaderboard.length : 0,
        ...(ok ? {} : { error: 'score queries did not return arrays' }),
      }
    } catch (err) {
      return { ok: false, routes: ['/api/scores', '/api/leaderboard'], scoreRecords: 0, leaderboardEntries: 0, error: errorMessage(err) }
    }
  }

  router.get('/', (_req: Request, res: Response) => {
    let report: HealthReport
    try {
      const checks = {
        db: checkDb(),
        static: checkStatic(),
        websocket: checkWebsocket(),
        runtime: checkRuntime(),
        api: checkApi(),
      }
      const degraded = Object.values(checks).some((check) => !check.ok)
      report = {
        status: degraded ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        version,
        checks,
      }
      res.status(degraded ? 503 : 200).json(report)
    } catch (err) {
      // Even a bug inside a check must produce JSON, not the SPA catch-all HTML.
      res.status(503).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        version,
        checks: { error: errorMessage(err) },
      })
    }
  })

  return router
}
