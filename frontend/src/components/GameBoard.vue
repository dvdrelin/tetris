<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted, watch } from 'vue'
import { useGameStore } from '../stores/gameStore'
import { GAME_CONFIG } from '../shared/config/game-config'

const CELL_SIZE = 24
const BOARD_WIDTH = GAME_CONFIG.boardWidth
const BOARD_HEIGHT = GAME_CONFIG.boardHeight
const BOARD_PIXELS_W = BOARD_WIDTH * CELL_SIZE
const BOARD_PIXELS_H = BOARD_HEIGHT * CELL_SIZE

export default defineComponent({
  name: 'GameBoard',
  setup() {
    const canvasRef = ref<HTMLCanvasElement | null>(null)
    const gameStore = useGameStore()

    function render() {
      const canvas = canvasRef.value
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.fillStyle = '#0a0a1a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const state = gameStore.gameState
      const board = state.board
      const currentPiece = state.currentPiece
      const currentPos = state.currentPos
      const ghostY = state.ghostY

      // Draw grid background
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.lineWidth = 1
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
        }
      }

      // Draw placed cells
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const cell = board[y]?.[x]
          if (cell > 0) {
            const cellStyle = getCellStyle(cell)
            ctx.fillStyle = cellStyle.backgroundColor
            ctx.shadowColor = cellStyle.boxShadow
            ctx.shadowBlur = 5
            ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2)
            ctx.shadowBlur = 0

            // Inner highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
            ctx.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, (CELL_SIZE - 4) / 2)
          }
        }
      }

      // Draw ghost piece
      if (currentPiece && ghostY >= 0) {
        ctx.globalAlpha = 0.3
        for (let r = 0; r < currentPiece.shape.length; r++) {
          for (let c = 0; c < currentPiece.shape[r].length; c++) {
            if (currentPiece.shape[r][c]) {
              const x = (currentPos.x + c) * CELL_SIZE
              const y = (ghostY + r) * CELL_SIZE
              const color = getCellStyle(currentPiece.colors[r][c])
              ctx.strokeStyle = color.backgroundColor
              ctx.lineWidth = 2
              ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
            }
          }
        }
        ctx.globalAlpha = 1
      }

      // Draw current piece
      if (currentPiece) {
        for (let r = 0; r < currentPiece.shape.length; r++) {
          for (let c = 0; c < currentPiece.shape[r].length; c++) {
            if (currentPiece.shape[r][c]) {
              const x = (currentPos.x + c) * CELL_SIZE
              const y = (currentPos.y + r) * CELL_SIZE
              const cellColor = currentPiece.colors[r][c]
              const cellStyle = getCellStyle(cellColor)

              ctx.fillStyle = cellStyle.backgroundColor
              ctx.shadowColor = cellStyle.boxShadow
              ctx.shadowBlur = 8
              ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
              ctx.shadowBlur = 0

              // Inner highlight
              ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
              ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, (CELL_SIZE - 4) / 2)

              // Border glow
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
              ctx.lineWidth = 1
              ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
            }
          }
        }
      }

      // Draw particles
      gameStore.particles.forEach((p) => {
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.life
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      })

      // Draw pause overlay
      if (state.isPaused) {
        ctx.fillStyle = 'rgba(10, 10, 26, 0.8)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#00f5ff'
        ctx.font = 'bold 36px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('ПАУЗА', canvas.width / 2, canvas.height / 2)
        ctx.font = '16px monospace'
        ctx.fillStyle = '#888'
        ctx.fillText('Нажмите P для продолжения', canvas.width / 2, canvas.height / 2 + 40)
      }

      // Draw game over overlay
      if (state.isGameOver) {
        ctx.fillStyle = 'rgba(10, 10, 26, 0.9)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#ff00ff'
        ctx.font = 'bold 32px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20)
        ctx.fillStyle = '#00f5ff'
        ctx.font = '20px monospace'
        ctx.fillText(`Счёт: ${state.score}`, canvas.width / 2, canvas.height / 2 + 20)
        ctx.fillStyle = '#888'
        ctx.font = '16px monospace'
        ctx.fillText('Нажмите ENTER для рестарта', canvas.width / 2, canvas.height / 2 + 50)
      }
    }

    function getCellStyle(value: number): { backgroundColor: string; boxShadow: string; borderColor: string; color: string } {
      const styles: Record<number, { backgroundColor: string; boxShadow: string; borderColor: string; color: string }> = {
        0: { backgroundColor: '#1a1a2e', boxShadow: 'none', borderColor: '#2a2a3e', color: '#fff' },
        1: { backgroundColor: '#00f5ff', boxShadow: '0 0 10px #00f5ff', borderColor: '#00d4ff', color: '#fff' },
        2: { backgroundColor: '#ffe600', boxShadow: '0 0 10px #ffe600', borderColor: '#ffd700', color: '#333' },
        3: { backgroundColor: '#ff00ff', boxShadow: '0 0 10px #ff00ff', borderColor: '#ff1493', color: '#fff' },
        4: { backgroundColor: '#00ff88', boxShadow: '0 0 10px #00ff88', borderColor: '#00cc66', color: '#fff' },
        5: { backgroundColor: '#ff4444', boxShadow: '0 0 10px #ff4444', borderColor: '#cc0000', color: '#fff' },
        6: { backgroundColor: '#4444ff', boxShadow: '0 0 10px #4444ff', borderColor: '#0000cc', color: '#fff' },
        7: { backgroundColor: '#ff8800', boxShadow: '0 0 10px #ff8800', borderColor: '#cc6600', color: '#fff' },
      }
      return styles[value] || styles[0]
    }

    // Game loop
    let lastTime = 0
    let tickAccumulator = 0
    let animFrame: number | null = null
    let tickInterval: number | null = null

    function gameLoop(timestamp: number) {
      if (!lastTime) lastTime = timestamp
      const dt = (timestamp - lastTime) / 1000
      lastTime = timestamp

      // Auto-tick for arcade mode
      const state = gameStore.gameState
      if (state.isRunning && !state.isPaused && !state.isGameOver) {
        const speedConfig = GAME_CONFIG.speedConfig
        const interval = Math.max(speedConfig.minInterval, speedConfig.initialInterval - (state.level - 1) * speedConfig.intervalDecrease)
        tickAccumulator += dt * 1000

        if (tickAccumulator >= interval) {
          tickAccumulator = 0
          gameStore.handleCommand({ type: 'Tick' })
        }
      }

      // Update particles
      gameStore.updateParticles(dt)

      // Render
      render()

      animFrame = requestAnimationFrame(gameLoop)
    }

    function startLoop() {
      lastTime = 0
      tickAccumulator = 0
      animFrame = requestAnimationFrame(gameLoop)
    }

    function stopLoop() {
      if (animFrame) cancelAnimationFrame(animFrame)
      animFrame = null
    }

    // Watch state changes
    watch(() => gameStore.gameState, () => {
      render()
    }, { deep: true })

    onMounted(() => {
      const canvas = canvasRef.value
      if (canvas) {
        canvas.width = BOARD_PIXELS_W
        canvas.height = BOARD_PIXELS_H
      }
      startLoop()
    })

    onUnmounted(() => {
      stopLoop()
    })

    return {
      canvasRef,
    }
  },
})
</script>

<template>
  <div class="board-container">
    <canvas ref="canvasRef" class="board-canvas" />
  </div>
</template>

<style scoped>
.board-container {
  position: relative;
}

.board-canvas {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  border: 2px solid #00f5ff;
  border-radius: 8px;
  box-shadow: 0 0 20px rgba(0, 245, 255, 0.3);
}
</style>
