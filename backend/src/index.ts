import express from 'express'
import { createServer as createHttpServer } from 'http'
import { WebSocketServer, WebSocket as WsSocket } from 'ws'
import { join } from 'path'
import { ScoreService } from './services/scoreService'
import { RoomServer } from './servers/roomServer'
import { createGameRouter } from './routes/gameRouter'
import { createHealthRouter } from './routes/healthRouter'
import { createMpLogRouter } from './routes/mpLogRouter'
import { RateLimiter } from './middleware/rate-limit'
import { MP_CONFIG } from './config/mpConfig'
import { MatchLogStore } from './services/matchLog'

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
// MP block B: maxPayload caps one inbound frame — protocol messages are small, 16 KiB kills
// frame-level flooding before any JSON is parsed.
const wss = new WebSocketServer({ noServer: true, maxPayload: MP_CONFIG.maxPayloadBytes })
// Match-by-match MP diagnostics (JSONL in backend/data/mp-matches, which deploy.sh preserves and
// the container mounts). Read them back over GET /api/mp/matches (needs MP_ADMIN_TOKEN) and replay
// any of them offline with `npm run mp:replay`.
const matchLog = new MatchLogStore({ enabled: MP_CONFIG.logsEnabled, maxFiles: MP_CONFIG.logMaxFiles })
const roomServer = new RoomServer({ matchLog })

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
    rooms: () => ({ rooms: roomServer.roomCount, players: roomServer.connectedPlayerCount }),
    scoreRateLimit: () => ({ max: scoreLimiter.limit, windowMs: scoreLimiter.window, trackedKeys: scoreLimiter.size }),
  }),
)

// Game API routes (must come BEFORE catch-all)
app.use('/api', createGameRouter(scoreService, { scoreLimiter }))

// MP match-log API (read-only, MP_ADMIN_TOKEN-protected; 503 when no token is configured).
app.use('/api/mp', createMpLogRouter(matchLog, { adminToken: MP_CONFIG.logAdminToken }))

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

// The `ws` heartbeat bookkeeping lives on the socket itself (README pattern): a per-connection
// flag flipped by pings, cleared by each interval ping and set again by each arriving pong.
type AliveSocket = WsSocket & { isAlive: boolean }

wss.on('connection', (client) => {
  const ws = client as AliveSocket
  roomServer.handleConnection(ws)
  // Transport heartbeat (the `ws` README pattern): ping every 30 s, terminate whoever stops
  // answering pongs. Browsers answer protocol pings automatically, and this also keeps the
  // nginx-proxy idle timer (60 s) fed on an otherwise silent room connection.
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })
})

const heartbeat = setInterval(() => {
  wss.clients.forEach((client) => {
    const ws = client as AliveSocket
    if (ws.isAlive === false) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, MP_CONFIG.transportPingMs)

wss.on('close', () => clearInterval(heartbeat))

httpServer.listen(PORT, () => {
  console.log(`Neon Tetris server running on port ${PORT}`)
})
