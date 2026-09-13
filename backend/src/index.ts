import express from 'express'
import { createServer as createHttpServer } from 'http'
import { WebSocketServer } from 'ws'
import { join } from 'path'
import { ScoreService } from './services/scoreService'
import { GameServer } from './servers/gameServer'
import { createGameRouter } from './routes/gameRouter'

const app = express()
const httpServer = createHttpServer(app)
const PORT = process.env.PORT || 3000

app.use(express.json())

// Game API routes (must come BEFORE catch-all)
app.use('/api', createGameRouter())

// Serve frontend static files in production
const FRONTEND_DIST = join(__dirname, '..', '..', 'frontend', 'dist')
app.use(express.static(FRONTEND_DIST))

// Catch-all: serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(join(FRONTEND_DIST, 'index.html'))
})

// WebSocket server
const wss = new WebSocketServer({ noServer: true })
const gameServer = new GameServer(wss)

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
