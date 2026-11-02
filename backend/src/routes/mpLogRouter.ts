/**
 * MP match-log API (debugging multiplayer without guessing).
 *
 *   GET /api/mp/matches                      — the index of recorded matches (newest first)
 *   GET /api/mp/matches/:file                — one match log (JSONL as text; ?format=json for an array)
 *   GET /api/mp/matches/:file/replay         — the same match in replay form: seed, verified locks,
 *                                              delivered garbage, verdicts — feed that to
 *                                              `npm run mp:replay -- file.json` and the server's own
 *                                              `MatchState` plays the match again, offline.
 *
 * Logs contain player names and move data, so the whole router is off unless MP_ADMIN_TOKEN is set
 * in the backend environment; requests then need `?token=…` or `Authorization: Bearer …`. With no
 * token configured the endpoints answer 503 — the logs stay on the server, available over SSH.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import type { MatchLogStore } from '../services/matchLog'
import { isSafeLogFileName } from '../services/matchLog'

export interface MpLogRouterOptions {
  /** The shared secret; empty/undefined disables the whole API. */
  adminToken?: string
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function createMpLogRouter(store: MatchLogStore, options: MpLogRouterOptions = {}): Router {
  const router = Router()
  const token = (options.adminToken ?? '').trim()

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!token) {
      res.status(503).json({ error: 'mp_logs_disabled', hint: 'set MP_ADMIN_TOKEN in the backend environment' })
      return
    }
    const given =
      typeof req.query.token === 'string' ? req.query.token : /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
    if (!timingSafeEqual(given, token)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  })

  router.get('/matches', (_req: Request, res: Response) => {
    res.json({ directory: store.directory, matches: store.list() })
  })

  router.get('/matches/:file', (req: Request, res: Response) => {
    const file = req.params.file
    if (!isSafeLogFileName(file)) {
      res.status(400).json({ error: 'bad_file_name', hint: 'use a name from GET /api/mp/matches' })
      return
    }
    const lines = store.readLines(file)
    if (!lines.length) {
      res.status(404).json({ error: 'match_not_found' })
      return
    }
    if (req.query.format === 'json') {
      res.json({ file, lines })
      return
    }
    res.type('text/plain').send(`${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  })

  router.get('/matches/:file/replay', (req: Request, res: Response) => {
    const file = req.params.file
    if (!isSafeLogFileName(file)) {
      res.status(400).json({ error: 'bad_file_name', hint: 'use a name from GET /api/mp/matches' })
      return
    }
    const bundle = store.readBundle(file)
    if (!bundle) {
      res.status(404).json({ error: 'match_not_found' })
      return
    }
    res.json({ file, ...bundle })
  })

  return router
}
