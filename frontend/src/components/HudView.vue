<script lang="ts">
import { defineComponent, computed, onMounted, watch } from 'vue'
import { useGameStore } from '../stores/gameStore'
import { CELL_COLORS } from '../stores/gameStore'
import { PieceType } from '../shared/domain/types'
import { PIECE_SHAPES, PIECE_COLOR_INDEX } from '../shared/domain/pieces'

// A6: the further a queued piece is from the active one, the more transparent it is.
const QUEUE_OPACITY = [1, 0.6, 0.35]
// A used hold slot is dimmed until the next piece spawns.
const HOLD_USED_OPACITY = 0.4

// Every piece fits into a 4x4 box (I is 4 cells wide, the rest 3), so all previews share one size.
const PREVIEW_CELL = 18
const PREVIEW_GRID = 4
const PREVIEW_SIZE = PREVIEW_GRID * PREVIEW_CELL + 4

export default defineComponent({
  name: 'HudView',
  setup() {
    const gameStore = useGameStore()

    function formatNumber(num: number): string {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
      return num.toString()
    }

    // Canvas refs are collected by the template (function refs), because the queue is a v-for list.
    const queueCanvases: HTMLCanvasElement[] = []
    let holdCanvas: HTMLCanvasElement | null = null

    function setQueueCanvas(el: unknown, index: number) {
      if (el instanceof HTMLCanvasElement) queueCanvases[index] = el
    }

    function setHoldCanvas(el: unknown) {
      holdCanvas = el instanceof HTMLCanvasElement ? el : null
    }

    /**
     * Draws one piece preview. Single source of truth for geometry: the canonical rot0 state from
     * PIECE_SHAPES; single source of color: PIECE_COLOR_INDEX, the same mapping the board uses.
     */
    function renderPreview(canvas: HTMLCanvasElement | null, pieceType: string | null) {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      canvas.width = PREVIEW_SIZE
      canvas.height = PREVIEW_SIZE

      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)

      const type = pieceType as PieceType | null
      const shape = type ? PIECE_SHAPES[type]?.[0] : null
      if (!shape) return

      // Center the used cells of the rot0 state inside the fixed preview box.
      let minRow = shape.length, maxRow = -1, minCol = shape[0].length, maxCol = -1
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue
          if (r < minRow) minRow = r
          if (r > maxRow) maxRow = r
          if (c < minCol) minCol = c
          if (c > maxCol) maxCol = c
        }
      }
      if (maxRow < 0) return

      const offsetX = Math.floor((PREVIEW_GRID - (maxCol - minCol + 1)) / 2)
      const offsetY = Math.floor((PREVIEW_GRID - (maxRow - minRow + 1)) / 2)
      const color = CELL_COLORS[PIECE_COLOR_INDEX[type as PieceType]] || CELL_COLORS[1]

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          if (!shape[r][c]) continue
          const x = (offsetX + c - minCol) * PREVIEW_CELL + 2
          const y = (offsetY + r - minRow) * PREVIEW_CELL + 2

          ctx.fillStyle = color.backgroundColor
          ctx.shadowColor = color.backgroundColor
          ctx.shadowBlur = 5
          ctx.fillRect(x, y, PREVIEW_CELL - 2, PREVIEW_CELL - 2)
          ctx.shadowBlur = 0

          // Inner highlight
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
          ctx.fillRect(x + 1, y + 1, PREVIEW_CELL - 3, (PREVIEW_CELL - 3) / 2)
        }
      }
    }

    // One key that changes whenever any preview must be redrawn (queue contents, hold slot,
    // and whether the hold of this piece is already used).
    const previewKey = computed(() =>
      `${gameStore.gameState.nextQueue.join(',')}|${gameStore.gameState.holdType}|${gameStore.gameState.canHold}`
    )

    function renderPreviews() {
      const queue = gameStore.gameState.nextQueue
      for (let i = 0; i < queueCanvases.length; i++) {
        renderPreview(queueCanvases[i], queue[i] ?? null)
      }
      renderPreview(holdCanvas, gameStore.gameState.holdType)
    }

    // flush: 'post' so the v-for canvases exist before they are drawn into.
    onMounted(renderPreviews)
    watch(previewKey, renderPreviews, { flush: 'post' })

    function handlePause() {
      gameStore.togglePause()
    }

    function handleResume() {
      gameStore.resumeGame()
    }

    return {
      gameStore,
      formatNumber,
      handlePause,
      handleResume,
      setQueueCanvas,
      setHoldCanvas,
      queueOpacity: QUEUE_OPACITY,
      holdOpacity: HOLD_USED_OPACITY,
    }
  },
})
</script>

<template>
  <div class="hud">
    <div class="hud-section">
      <div class="hud-title">СЧЁТ</div>
      <div class="hud-value" :style="{ color: gameStore.gameState.score > 10000 ? '#ff00ff' : '#00f5ff' }">
        {{ formatNumber(gameStore.gameState.score) }}
      </div>
    </div>
    <div class="hud-section">
      <div class="hud-title">УРОВЕНЬ</div>
      <div class="hud-value">{{ gameStore.gameState.level }}</div>
    </div>
    <div class="hud-section">
      <div class="hud-title">ЛИНИИ</div>
      <div class="hud-value">{{ gameStore.gameState.linesCleared }}</div>
    </div>
    <div class="hud-section">
      <div class="hud-title">КОМБО</div>
      <div class="hud-value" :style="{ color: gameStore.gameState.combo > 1 ? '#ffe600' : '#888' }">
        x{{ gameStore.gameState.combo }}
      </div>
    </div>
    <div class="hud-section hold-section">
      <div class="hud-title">УДЕРЖАНИЕ</div>
      <canvas
        :ref="setHoldCanvas"
        class="preview-canvas"
        :style="{ opacity: gameStore.gameState.canHold ? 1 : holdOpacity }"
      ></canvas>
    </div>
    <div class="hud-section queue-section">
      <div class="hud-title">СЛЕДУЮЩИЕ</div>
      <div class="queue-list">
        <canvas
          v-for="(pieceType, index) in gameStore.gameState.nextQueue"
          :key="index"
          :ref="(el) => setQueueCanvas(el, index)"
          class="preview-canvas"
          :style="{ opacity: queueOpacity[index] ?? 0.35 }"
        ></canvas>
      </div>
    </div>
    <div class="hud-section controls-section">
      <div class="hud-title">УПРАВЛЕНИЕ</div>
      <div class="control-item"><span class="key">← →</span> Движение</div>
      <div class="control-item"><span class="key">↑</span> Вращение</div>
      <div class="control-item"><span class="key">R</span> Поворот 180°</div>
      <div class="control-item"><span class="key">↓</span> Soft Drop</div>
      <div class="control-item"><span class="key">SPACE</span> Hard Drop</div>
      <div class="control-item"><span class="key">C</span> Удержание</div>
      <div class="control-item"><span class="key">P</span> Пауза</div>
    </div>
    <div class="hud-section pause-btn-section">
      <button v-if="gameStore.gameState.isRunning && !gameStore.gameState.isGameOver" class="pause-btn" @click="handlePause()">
        ⏸
      </button>
      <button v-else-if="gameStore.gameState.isPaused" class="pause-btn resume-btn" @click="handleResume()">
        ▶
      </button>
    </div>
  </div>
</template>

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

.hold-section,
.queue-section {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.preview-canvas {
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

/* Mobile (B3): the HUD becomes a strip under the board instead of a 200px column beside it. */
@media (max-width: 900px) {
  .hud {
    width: 100%;
    max-width: 420px;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px;
  }

  .hud-section {
    flex: 1 1 28%;
    padding: 8px;
  }

  .hud-value {
    font-size: 20px;
  }

  .queue-list {
    flex-direction: row;
  }
}
</style>
