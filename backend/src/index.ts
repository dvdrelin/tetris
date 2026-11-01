import express from 'express'
import { createServer as createHttpServer } from 'http'
import { WebSocketServer } from 'ws'
import { join } from 'path'
import { ScoreService } from './services/scoreService'
import { GameServer } from './servers/gameServer'
import { createGameRouter } from './routes/gameRouter'
import { createHealthRouter } from './routes/healthRouter'
import { RateLimiter } from './middleware/rate-limit'

const app = express()
const httpServer = createHttpServer(app)
const PORT = process.env.PORT || 3000

// Production runs behind nginx-proxy (see nginx-proxy/ + VIRTUAL_HOST), so req.socket.address()
// is the proxy container for everyone. Trusting exactly one hop makes req.ip the real client,
// which the score rate limiter needs; TRUST_PROXY=0 restores the strict behaviour if the app is
// ever exposed directly.
const TRUST_PROXY = process.env.TRUST_PROXY !== '0'
if (TRUST_PROXY) app.set('trust proxy', 1)

app.use(express.json())

// D1: frequency, not authenticity, is what protects the public score endpoint for now
// (a server-side verified result is a multiplayer-era decision). Defaults: 30 submissions
// per minute per IP — far above any honest session (one score per finished game), low enough
// to make scripted spam pointless.
const SCORE_WINDOW_MS = Number(process.env.SCORE_RATE_LIMIT_WINDOW_MS) || 60_000
const SCORE_MAX = Number(process.env.SCORE_RATE_LIMIT_MAX) || 30
const scoreLimiter = new RateLimiter({ windowMs: SCORE_WINDOW_MS, max: SCORE_MAX })

// One ScoreService for the whole process: the game API and the health self-check
// must describe the same store, not two independently created ones.
const scoreService = new ScoreService()

// WebSocket server is created before the routes so /api/health can report live clients.
const wss = new WebSocketServer({ noServer: true })
const gameServer = new GameServer(wss)

// Built SPA directory (production image: /app/frontend/dist).
const FRONTEND_DIST = join(__dirname, '..', '..', 'frontend', 'dist')

// Health check: must be mounted BEFORE express.static and the SPA catch-all,
// otherwise GET /api/health is answered with index.html instead of JSON.
app.use(
  '/api/health',
  createHealthRouter({
    scoreService,
    distPath: FRONTEND_DIST,
    clients: () => wss.clients.size,
    scoreRateLimit: () => ({ max: scoreLimiter.limit, windowMs: scoreLimiter.window, trackedKeys: scoreLimiter.size }),
  }),
)

// Game API routes (must come BEFORE catch-all)
app.use('/api', createGameRouter(scoreService, { scoreLimiter }))

// Serve frontend static files in production
app.use(express.static(FRONTEND_DIST))

// Catch-all: serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(join(FRONTEND_DIST, 'index.html'))
})

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', 'http://localhost')
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws)
    })
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws) => {
  gameServer.handleConnection(ws)
})

httpServer.listen(PORT, () => {
  console.log(`Neon Tetris server running on port ${PORT}`)
})
