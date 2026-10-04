import express from 'express'
import { createServer as createHttpServer } from 'http'
import { WebSocketServer } from 'ws'
import { join } from 'path'
import { ScoreService } from './services/scoreService'
import { GameServer } from './servers/gameServer'
import { createGameRouter } from './routes/gameRouter'
import { createHealthRouter } from './routes/healthRouter'

const app = express()
const httpServer = createHttpServer(app)
const PORT = process.env.PORT || 3000

app.use(express.json())

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
  }),
)

// Game API routes (must come BEFORE catch-all)
app.use('/api', createGameRouter(scoreService))

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
