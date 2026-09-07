<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useGameStore } from '../stores/gameStore'
import { CELL_COLORS } from '../stores/gameStore'
import { PieceType } from '../shared/domain/types'

// Piece shapes for preview
const PREVIEW_SHAPES: Record<PieceType, number[][]> = {
  [PieceType.I]: [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
  [PieceType.O]: [[1,1], [1,1]],
  [PieceType.T]: [[0,1,0], [1,1,1], [0,0,0]],
  [PieceType.S]: [[0,1,1], [1,1,0], [0,0,0]],
  [PieceType.Z]: [[1,1,0], [0,1,1], [0,0,0]],
  [PieceType.J]: [[1,0,0], [1,1,1], [0,0,0]],
  [PieceType.L]: [[0,0,1], [1,1,1], [0,0,0]],
}

export default defineComponent({
  name: 'HudView',
  setup() {
    const gameStore = useGameStore()

    function formatNumber(num: number): string {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
      return num.toString()
    }

    function renderNextPiece(previewCanvas: HTMLCanvasElement | null, nextPieceType: string) {
      if (!previewCanvas) return
      const ctx = previewCanvas.getContext('2d')
      if (!ctx) return

      const shape = PREVIEW_SHAPES[nextPieceType as PieceType] || PREVIEW_SHAPES[PieceType.I]
      const cellSize = 18

      previewCanvas.width = shape[0].length * cellSize + 4
      previewCanvas.height = shape.length * cellSize + 4

      // Clear
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height)

      // Draw piece
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) {
            const x = c * cellSize + 2
            const y = r * cellSize + 2
            const color = CELL_COLORS[nextPieceType as unknown as number] || CELL_COLORS[1]

            ctx.fillStyle = color.backgroundColor
            ctx.shadowColor = color.boxShadow
            ctx.shadowBlur = 5
            ctx.fillRect(x, y, cellSize - 2, cellSize - 2)
            ctx.shadowBlur = 0

            // Inner highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
            ctx.fillRect(x + 1, y + 1, cellSize - 3, (cellSize - 3) / 2)
          }
        }
      }
    }

    function handlePause() {
      gameStore.togglePause()
    }

    function handleResume() {
      gameStore.resumeGame()
    }

    return {
      gameStore,
      formatNumber,
      renderNextPiece,
      handlePause,
      handleResume,
    }
  },
  render() {
    return `
      <div class="hud">
        <div class="hud-section">
          <div class="hud-title">СЧЁТ</div>
          <div class="hud-value" :style="{ color: this.gameStore.gameState.score > 10000 ? '#ff00ff' : '#00f5ff' }">
            {{ this.formatNumber(this.gameStore.gameState.score) }}
          </div>
        </div>
        <div class="hud-section">
          <div class="hud-title">УРОВЕНЬ</div>
          <div class="hud-value">{{ this.gameStore.gameState.level }}</div>
        </div>
        <div class="hud-section">
          <div class="hud-title">ЛИНИИ</div>
          <div class="hud-value">{{ this.gameStore.gameState.linesCleared }}</div>
        </div>
        <div class="hud-section">
          <div class="hud-title">КОМБО</div>
          <div class="hud-value" :style="{ color: this.gameStore.gameState.combo > 1 ? '#ffe600' : '#888' }">
            x{{ this.gameStore.gameState.combo }}
          </div>
        </div>
        <div class="hud-section next-piece-section">
          <div class="hud-title">СЛЕДУЮЩИЙ</div>
          <canvas ref="nextPieceCanvas" class="next-piece-canvas"></canvas>
        </div>
        <div class="hud-section controls-section">
          <div class="hud-title">УПРАВЛЕНИЕ</div>
          <div class="control-item"><span class="key">← →</span> Движение</div>
          <div class="control-item"><span class="key">↑</span> Вращение</div>
          <div class="control-item"><span class="key">↓</span> Soft Drop</div>
          <div class="control-item"><span class="key">SPACE</span> Hard Drop</div>
          <div class="control-item"><span class="key">P</span> Пауза</div>
        </div>
        <div class="hud-section pause-btn-section">
          <button v-if="this.gameStore.gameState.isRunning && !this.gameStore.gameState.isGameOver" class="pause-btn" @click="this.handlePause()">
            ⏸
          </button>
          <button v-if="this.gameStore.gameState.isPaused" class="pause-btn resume-btn" @click="this.handleResume()">
            ▶
          </button>
        </div>
      </div>
    `
  },
  mounted() {
    const canvas = this.$refs.nextPieceCanvas as HTMLCanvasElement
    this.$nextTick(() => {
      this.renderNextPiece(canvas, this.gameStore.gameState.nextPieceType)
    })
  },
  watch: {
    gameState() {
      const canvas = this.$refs.nextPieceCanvas as HTMLCanvasElement
      this.$nextTick(() => {
        this.renderNextPiece(canvas, this.gameStore.gameState.nextPieceType)
      })
    }
  },
})
</script>

<style scoped>
.hud {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: rgba(26, 26, 46, 0.6);
  border: 1px solid rgba(0, 245, 255, 0.2);
  border-radius: 12px;
  width: 200px;
}

.hud-section {
  padding: 12px;
  background: rgba(10, 10, 26, 0.6);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.hud-title {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 8px;
}

.hud-value {
  font-size: 28px;
  font-weight: 900;
  color: #00f5ff;
  text-shadow: 0 0 10px rgba(0, 245, 255, 0.5);
}

.next-piece-section {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.next-piece-canvas {
  background: #1a1a2e;
  border-radius: 8px;
}

.controls-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #aaa;
}

.key {
  background: rgba(0, 245, 255, 0.1);
  border: 1px solid rgba(0, 245, 255, 0.3);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #00f5ff;
  min-width: 40px;
  text-align: center;
}

.pause-btn {
  background: rgba(0, 245, 255, 0.1);
  border: 2px solid #00f5ff;
  border-radius: 8px;
  width: 100%;
  padding: 12px;
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pause-btn:hover {
  background: rgba(0, 245, 255, 0.2);
  box-shadow: 0 0 15px rgba(0, 245, 255, 0.3);
}

.resume-btn {
  border-color: #00ff88;
  background: rgba(0, 255, 136, 0.1);
}

.resume-btn:hover {
  background: rgba(0, 255, 136, 0.2);
  box-shadow: 0 0 15px rgba(0, 255, 136, 0.3);
}
</style>
