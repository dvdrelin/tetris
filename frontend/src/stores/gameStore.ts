import { defineStore } from 'pinia'
import { ref } from 'vue'
import { GameEngine } from '../shared/engine/game-engine'
import { Cell, CellState, GameMode, GameConfig, GameState, Particle } from '../shared/domain/types'
import { CommandType } from '../shared/cqrs/commands'
import { QUERY_TYPE_MAP } from '../shared/cqrs/queries'
import { GAME_CONFIG } from '../shared/config/game-config'

const CELL_SIZE = 24
const BOARD_WIDTH = GAME_CONFIG.boardWidth
const BOARD_HEIGHT = GAME_CONFIG.boardHeight

export interface GameStateDTO {
  board: number[][]
  boardWidth: number
  boardHeight: number
  currentPiece: { type: string; shape: number[][]; colors: number[][] } | null
  currentPos: { x: number; y: number } | null
  currentRotation: { index: number } | null
  nextPieceType: string
  score: number
  level: number
  linesCleared: number
  combo: number
  isRunning: boolean
  isPaused: boolean
  isGameOver: boolean
  mode: GameMode
  ghostY: number
}

export interface CellDTO {
  value: number
  locked: boolean
}

export interface CellStyle {
  backgroundColor: string
  borderColor: string
  boxShadow: string
  color: string
}

export const CELL_COLORS: Record<number, CellStyle> = {
  0: { backgroundColor: '#1a1a2e', borderColor: '#2a2a3e', boxShadow: 'none', color: '#333' },
  1: { backgroundColor: '#00f5ff', borderColor: '#00d4ff', boxShadow: '0 0 10px #00f5ff, inset 0 0 4px rgba(255,255,255,0.3)', color: '#fff' },
  2: { backgroundColor: '#ffe600', borderColor: '#ffd700', boxShadow: '0 0 10px #ffe600, inset 0 0 4px rgba(255,255,255,0.3)', color: '#333' },
  3: { backgroundColor: '#ff00ff', borderColor: '#ff1493', boxShadow: '0 0 10px #ff00ff, inset 0 0 4px rgba(255,255,255,0.3)', color: '#fff' },
  4: { backgroundColor: '#00ff88', borderColor: '#00cc66', boxShadow: '0 0 10px #00ff88, inset 0 0 4px rgba(255,255,255,0.3)', color: '#fff' },
  5: { backgroundColor: '#ff4444', borderColor: '#cc0000', boxShadow: '0 0 10px #ff4444, inset 0 0 4px rgba(255,255,255,0.3)', color: '#fff' },
  6: { backgroundColor: '#4444ff', borderColor: '#0000cc', boxShadow: '0 0 10px #4444ff, inset 0 0 4px rgba(255,255,255,0.3)', color: '#fff' },
  7: { backgroundColor: '#ff8800', borderColor: '#cc6600', boxShadow: '0 0 10px #ff8800, inset 0 0 4px rgba(255,255,255,0.3)', color: '#fff' },
}

export interface KeyHandler {
  keyDown?: (e: KeyboardEvent) => void
  keyUp?: (e: KeyboardEvent) => void
}

export const useGameStore = defineStore('game', () => {
  const gameState = ref<GameStateDTO>({
    board: Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0)),
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    currentPiece: null,
    currentPos: null,
    currentRotation: null,
    nextPieceType: 'I',
    score: 0,
    level: 1,
    linesCleared: 0,
    combo: 0,
    isRunning: false,
    isPaused: false,
    isGameOver: false,
    mode: GameMode.Arcade,
    ghostY: -1,
  })

  const particles = ref<Particle[]>([])
  let engineInstance: GameEngine | null = null
  let tickInterval: number | null = null
  let animFrame: number | null = null
  let lastTime: number = 0

  function init() {
    engineInstance = new GameEngine({
      onStateChange: () => { updateState() },
      onLineClear: (count, combo) => {
        spawnParticles(count, combo)
      },
      onGameOver: (score) => {
        console.log('Game Over! Score:', score)
      },
    })
  }

  function getEngine(): GameEngine | null {
    return engineInstance
  }

  function startGame(mode: GameMode) {
    if (!engineInstance) return
    engineInstance.handleCommand({ type: CommandType.StartGame, payload: { mode } })
    updateState()
  }

  function updateState() {
    if (!engineInstance) return
    const state = engineInstance.getGameState()
    const ghostY = getGhostY(state)

    gameState.value = {
      board: state.board.map(row => row.map(cell => cell.value)),
      boardWidth: state.boardWidth,
      boardHeight: state.boardHeight,
      currentPiece: state.currentPiece ? {
        type: state.currentPiece.type,
        shape: state.currentPiece.shape,
        colors: state.currentPiece.colors,
      } : null,
      currentPos: state.currentPos,
      currentRotation: state.currentRotation,
      nextPieceType: state.nextPieceType,
      score: state.score,
      level: state.level,
      linesCleared: state.linesCleared,
      combo: state.combo,
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      isGameOver: state.isGameOver,
      mode: state.mode,
      ghostY,
    }
  }

  function getGhostY(state: GameState): number {
    if (!state.currentPiece || !state.currentPos) return -1

    let ghostY = state.currentPos.y
    const piece = state.currentPiece

    while (true) {
      let canGo = false
      for (let r = 0; r < piece.shape.length; r++) {
        for (let c = 0; c < piece.shape[r].length; c++) {
          if (piece.shape[r][c]) {
            const boardX = state.currentPos!.x + c
            const boardY = ghostY + r + 1
            if (boardY >= state.boardHeight || boardX < 0 || boardX >= state.boardWidth) { canGo = false; break }
            if (boardY >= 0 && state.board[boardY]?.[boardX]?.value !== 0) { canGo = false; break }
            canGo = true
          }
        }
        if (!canGo) break
      }
      if (canGo) ghostY++
      else break
    }
    return ghostY - piece.shape.length
  }

  function handleCommand(cmd: any) {
    if (!engineInstance) return
    engineInstance.handleCommand(cmd)
    updateState()
  }

  function handleKey(e: KeyboardEvent): void {
    if (!engineInstance) return

    if (engineInstance.isGameOver() && e.key === 'Enter') {
      engineInstance.handleCommand({ type: CommandType.StartGame, payload: { mode: engineInstance.getMode() } })
      return
    }

    if (!engineInstance.isRunning() || engineInstance.isPaused()) return

    switch (e.key) {
      case 'ArrowLeft':
      case 'a': handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } }); break
      case 'ArrowRight':
      case 'd': handleCommand({ type: CommandType.MovePiece, payload: { direction: 'right' } }); break
      case 'ArrowDown':
      case 's': handleCommand({ type: CommandType.SoftDrop }); break
      case ' ': handleCommand({ type: CommandType.HardDrop }); break
      case 'x':
      case 'z':
      case 'c':
      case 'w': handleCommand({ type: CommandType.MovePiece, payload: { direction: 'rotateCW' } }); break
      case 'q': handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } }); break
      case 'p':
      case 'Escape':
        togglePause()
        break
    }
  }

  function spawnParticles(lines: number, combo: number) {
    const count = lines * 20
    for (let i = 0; i < count; i++) {
      particles.value.push({
        x: Math.random() * BOARD_WIDTH * 24,
        y: Math.random() * BOARD_HEIGHT * 24,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        life: 1,
        maxLife: 1,
        color: `hsl(${Math.random() * 360}, 100%, 60%)`,
        size: 2 + Math.random() * 4,
      } as Particle)
    }
  }

  function updateParticles(dt: number) {
    particles.value = particles.value.filter(p => {
      p.x += p.vx * dt * 60
      p.y += p.vy * dt * 60
      p.life -= dt * 2
      return p.life > 0
    })
  }

  function getCellColor(value: number): string {
    return CELL_COLORS[value]?.backgroundColor || '#1a1a2e'
  }

  function getCellShadow(value: number): string {
    return CELL_COLORS[value]?.boxShadow || 'none'
  }

  function getCellBorder(value: number): string {
    return CELL_COLORS[value]?.borderColor || '#2a2a3e'
  }

  function getCellText(value: number): string {
    return CELL_COLORS[value]?.color || '#fff'
  }

  function togglePause() {
    if (!engineInstance || !engineInstance.isRunning()) return
    if (engineInstance.isPaused()) {
      engineInstance.handleCommand({ type: 'ResumeGame' })
    } else {
      engineInstance.handleCommand({ type: 'PauseGame' })
    }
    updateState()
  }

  function resumeGame() {
    if (!engineInstance) return
    engineInstance.handleCommand({ type: 'ResumeGame' })
    updateState()
  }

  return {
    gameState,
    particles,
    init,
    startGame,
    handleCommand,
    handleKey,
    getCellColor,
    getCellShadow,
    getCellBorder,
    getCellText,
    togglePause,
    resumeGame,
    updateState,
    getEngine,
    updateParticles,
    spawnParticles,
    getGhostY,
  }
})
