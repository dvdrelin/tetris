import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { GameEngine } from '../shared/engine/game-engine'
import { GameMode, GameOverReason, Particle } from '../shared/domain/types'
import { AnyCommand, CommandType } from '../shared/cqrs/commands'
import { GAME_CONFIG } from '../shared/config/game-config'
import { loadPlayerName, savePlayerName } from '../shared/domain/player-name'

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
  nextQueue: string[]
  holdType: string | null
  canHold: boolean
  score: number
  level: number
  linesCleared: number
  combo: number
  isRunning: boolean
  isPaused: boolean
  isGameOver: boolean
  mode: GameMode
  overReason: GameOverReason | null
  ghostY: number
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

export const useGameStore = defineStore('game', () => {
  const gameState = ref<GameStateDTO>({
    board: Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0)),
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    currentPiece: null,
    currentPos: null,
    currentRotation: null,
    nextQueue: [],
    holdType: null,
    canHold: true,
    score: 0,
    level: 1,
    linesCleared: 0,
    combo: 0,
    isRunning: false,
    isPaused: false,
    isGameOver: false,
    mode: GameMode.Arcade,
    overReason: null,
    ghostY: -1,
  })

  const particles = ref<Particle[]>([])
  // C4: the name is typed by the player (MenuView) and remembered in localStorage.
  const playerName = ref<string>(loadPlayerName())

  // One place to persist the name: every writer (the menu field, tests) goes through the same
  // normalization and the same storage write.
  watch(playerName, (name) => {
    playerName.value = savePlayerName(name)
  })

  let engineInstance: GameEngine | null = null

  function init() {
    engineInstance = new GameEngine({
      onStateChange: () => { updateState() },
      onLineClear: (count, combo) => {
        spawnParticles(count, combo)
      },
      onGameOver: async (score: number) => {
        try {
          const engine = engineInstance
          const res = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playerName: playerName.value,
              score,
              mode: engine?.getMode() ?? 0,
              level: engine?.getLevel() ?? 1,
              linesCleared: engine?.getLinesCleared() ?? 0,
            }),
          })
          // A rejected submission is a degraded outcome, not a crash: the score just did not
          // reach the leaderboard. console.warn (not .error) on purpose — the E2E suite asserts
          // that the console is free of errors, and main.ts collects warnings separately.
          if (!res.ok) {
            const detail = await res.text().catch(() => '')
            console.warn(`Score was not saved: HTTP ${res.status} ${detail}`.trim())
          }
        } catch (e) {
          console.warn('Failed to save score:', e)
        }
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
    // A7: the ghost row is computed by the engine — the only place a collision rule exists.
    // The store just carries the number to the renderer; it must not rescan the board itself.
    const ghostY = engineInstance.getGhostY()

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
      nextQueue: [...state.nextQueue],
      holdType: state.holdType,
      canHold: state.canHold,
      score: state.score,
      level: state.level,
      linesCleared: state.linesCleared,
      combo: state.combo,
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      isGameOver: state.isGameOver,
      mode: state.mode,
      // The engine owns the cause; the store only transports it (same rule as ghostY, A7).
      overReason: engineInstance.getOverReason(),
      ghostY,
    }
  }

  function handleCommand(cmd: AnyCommand) {
    if (!engineInstance) return
    engineInstance.handleCommand(cmd)
    updateState()
  }

  // Keyboard handling moved out of the store (B2): GameView owns one InputController, which maps
  // keys to actions, ignores the OS auto-repeat and runs DAS/ARR. Keeping a second key map here
  // would mean two input paths that can double-fire the same command.

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
      engineInstance.handleCommand({ type: CommandType.ResumeGame })
    } else {
      engineInstance.handleCommand({ type: CommandType.PauseGame })
    }
    updateState()
  }

  // Pause and resume deliberately share one action (C2): the HUD button and the `P` key both
  // toggle, so they can never disagree about the current state.

  // C5: leaving the play (Esc / «Меню») stops the engine without a game-over report, so an
  // abandoned game never reaches the leaderboard.
  function stopGame() {
    if (!engineInstance) return
    engineInstance.stop()
    updateState()
  }

  return {
    gameState,
    particles,
    playerName,
    init,
    startGame,
    handleCommand,
    getCellColor,
    getCellShadow,
    getCellBorder,
    getCellText,
    togglePause,
    stopGame,
    updateState,
    getEngine,
    updateParticles,
    spawnParticles,
  }
})
