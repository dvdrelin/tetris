<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../stores/gameStore'
import { render, RenderState } from '../engine/renderer'
import { GAME_CONFIG } from '../shared/config/game-config'

const BOARD_WIDTH = GAME_CONFIG.boardWidth
const BOARD_HEIGHT = GAME_CONFIG.boardHeight
const BOARD_PIXELS_W = BOARD_WIDTH * 24
const BOARD_PIXELS_H = BOARD_HEIGHT * 24

export default defineComponent({
  name: 'GameBoard',
  setup() {
    const canvasRef = ref<HTMLCanvasElement | null>(null)
    const gameStore = useGameStore()

    function renderCanvas() {
      const canvas = canvasRef.value
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const state = gameStore.gameState
      const renderState: RenderState = {
        board: state.board,
        currentPiece: state.currentPiece,
        currentPos: state.currentPos,
        ghostY: state.ghostY,
        isPaused: state.isPaused,
        isGameOver: state.isGameOver,
        score: state.score,
      }

      render(ctx, renderState, canvas.width, canvas.height)

      // Particles (overlay on top)
      gameStore.particles.forEach((p) => {
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.life
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      })
    }

    // Game loop
    let lastTime = 0
    let tickAccumulator = 0
    let animFrame: number | null = null

    function gameLoop(timestamp: number) {
      if (!lastTime) lastTime = timestamp
      const dt = (timestamp - lastTime) / 1000
      lastTime = timestamp

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

      gameStore.updateParticles(dt)
      renderCanvas()

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

    return { canvasRef }
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
