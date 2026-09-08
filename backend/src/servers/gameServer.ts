import { WebSocket, WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'

export interface PlayerInfo {
  id: string
  name: string
  mode: number
  score: number
  level: number
  lines: number
  connectedAt: number
}

export interface GameState {
  board: number[][]
  currentPiece: number[] | null
  currentPos: { x: number; y: number } | null
  nextPieceType: string
  score: number
  level: number
  linesCleared: number
  combo: number
  isRunning: boolean
  isPaused: boolean
  isGameOver: boolean
  mode: number
}

export type Message = {
  type: string
  payload?: any
}

export class GameServer {
  private wss: WebSocketServer
  private players: Map<string, PlayerInfo> = new Map()
  private gameStates: Map<string, GameState> = new Map()
  private wsToPlayer: Map<WebSocket, string> = new Map()

  constructor(wss: WebSocketServer) {
    this.wss = wss
  }

  handleConnection(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: Message
      try {
        msg = JSON.parse(raw.toString())
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }))
        return
      }

      switch (msg.type) {
        case 'join':
          this.handleJoin(ws, msg)
          break
        case 'action':
          this.handleAction(ws, msg)
          break
        case 'leave':
          this.handleLeave(ws)
          break
        default:
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Unknown message type' } }))
      }
    })

    ws.on('close', () => {
      this.handleLeave(ws)
    })

    ws.on('error', (err) => {
      console.error('WebSocket error:', err)
    })
  }

  private handleJoin(ws: WebSocket, msg: Message): void {
    const { name, mode } = msg.payload || {}
    if (!name) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Player name required' } }))
      return
    }

    const playerId = randomUUID()
    const playerInfo: PlayerInfo = {
      id: playerId,
      name,
      mode: mode || 0,
      score: 0,
      level: 1,
      lines: 0,
      connectedAt: Date.now(),
    }

    this.players.set(playerId, playerInfo)
    this.wsToPlayer.set(ws, playerId)

    const gameState: GameState = {
      board: this.generateBoard(10, 20),
      currentPiece: null,
      currentPos: null,
      nextPieceType: 'I',
      score: 0,
      level: 1,
      linesCleared: 0,
      combo: 0,
      isRunning: false,
      isPaused: false,
      isGameOver: false,
      mode: mode || 0,
    }

    this.gameStates.set(playerId, gameState)

    ws.send(JSON.stringify({
      type: 'joined',
      payload: {
        playerId,
        playerInfo,
        gameState,
      },
    }))

    // Notify others
    this.broadcast('playerJoined', { playerId, name })
  }

  private handleAction(ws: WebSocket, msg: Message): void {
    const playerId = this.wsToPlayer.get(ws)
    if (!playerId) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Not connected to a game' } }))
      return
    }
    // Server-side action processing is not implemented yet. The mapping above
    // guarantees that when it is, actions are scoped to the correct player
    // (previously every action silently affected an arbitrary/first player).
  }

  private handleLeave(ws: WebSocket): void {
    const playerId = this.wsToPlayer.get(ws)
    if (playerId) {
      this.players.delete(playerId)
      this.gameStates.delete(playerId)
      this.wsToPlayer.delete(ws)
    }
  }

  private broadcast(type: string, payload?: any): void {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, payload }))
      }
    })
  }

  private generateBoard(width: number, height: number): number[][] {
    return Array.from({ length: height }, () => Array(width).fill(0))
  }
}
