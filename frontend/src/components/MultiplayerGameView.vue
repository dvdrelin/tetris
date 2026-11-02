<script lang="ts">
// MP block C — the versus screen: own board (canvas, same renderer as single-player, seeded
// engine) + opponent shadow boards (DOM grids rebuilt from relayed locks) + aligned countdown
// from the server's startTime, surrender and the match-over results overlay.
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue'
import { useMultiplayerStore } from '../stores/multiplayerStore'
import { render, RenderState } from '../engine/renderer'
import { InputController } from '@neon-tetris/shared/input/input-controller'
import { InputAction, actionToCommand } from '@neon-tetris/shared/input/input-actions'
import { GAME_CONFIG } from '@neon-tetris/shared/config/game-config'

const CELL = 24
const BOARD_W = GAME_CONFIG.boardWidth
const BOARD_H = GAME_CONFIG.boardHeight
const OPP_CELL = 9

export default defineComponent({
  name: 'MultiplayerGameView',
  emits: ['room'],
  setup(_, { emit }) {
    const mp = useMultiplayerStore()
    const ownCanvas = ref<HTMLCanvasElement | null>(null)
    const countdown = ref<number | null>(null)

    const opponents = computed(() =>
      (mp.room?.players ?? [])
        .filter((p) => p.id !== mp.myId)
        .map((p) => ({ player: p, shadow: mp.shadows[p.id] ?? null })),
    )

    // ----- input (no pause in a live match; the rules clock is shared) -----
    function fireAction(action: InputAction) {
      if (action === 'pause') return
      mp.mpHandleCommand(actionToCommand(action))
    }
    const input = new InputController({ fire: fireAction })

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mp.matchOverInfo) emit('room')
        return
      }
      if (input.handleKeyDown(e)) e.preventDefault()
    }
    function handleKeyup(e: KeyboardEvent) {
      input.handleKeyUp(e)
    }
    function releaseHeldKeys() {
      input.releaseAll()
    }

    // ----- render/tick loop for the own board -----
    function renderOwn() {
      const canvas = ownCanvas.value
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const s = mp.mpGameState
      const rs: RenderState = {
        board: s.board,
        currentPiece: s.currentPiece,
        currentPos: s.currentPos,
        ghostY: s.ghostY,
        isPaused: false, // a live match never pauses locally
        isGameOver: s.isGameOver,
        overReason: s.overReason,
        score: s.score,
      }
      render(ctx, rs, canvas.width, canvas.height)
    }

    let animFrame: number | null = null
    let lastTime = 0

    function loop(timestamp: number) {
      if (!lastTime) lastTime = timestamp
      const dtMs = timestamp - lastTime
      lastTime = timestamp

      if (mp.match && !mp.matchOverInfo) {
        if (!mp.mpGameState.isRunning && !mp.mpGameState.isGameOver) {
          const wait = Math.ceil((mp.match.startTime - mp.serverNow()) / 1000)
          countdown.value = Math.max(0, wait)
        } else {
          countdown.value = null
        }
        input.update()
        if (mp.mpGameState.isRunning && !mp.mpGameState.isGameOver) {
          mp.mpTick(dtMs)
        }
      }
      renderOwn()
      animFrame = requestAnimationFrame(loop)
    }

    function surrenderClick() {
      if (window.confirm('Сдаться? Соперник победит.')) mp.surrender()
    }

    onMounted(() => {
      const canvas = ownCanvas.value
      if (canvas) {
        canvas.width = BOARD_W * CELL
        canvas.height = BOARD_H * CELL
      }
      document.addEventListener('keydown', handleKeydown)
      document.addEventListener('keyup', handleKeyup)
      window.addEventListener('blur', releaseHeldKeys)
      animFrame = requestAnimationFrame(loop)
    })

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('keyup', handleKeyup)
      window.removeEventListener('blur', releaseHeldKeys)
      if (animFrame !== null) cancelAnimationFrame(animFrame)
      input.releaseAll()
    })

    return { mp, ownCanvas, countdown, opponents, surrenderClick, emit, GAME_CONFIG, OPP_CELL }
  },
})
</script>

<template>
  <div class="mp-game" data-testid="mp-game">
    <div class="opponents">
      <div v-for="{ player, shadow } in opponents" :key="player.id" class="op-panel"
           :data-testid="'mp-op-' + player.id.slice(0, 8)">
        <div class="op-name">
          {{ player.name }}
          <span v-if="!player.connected" class="op-off">нет связи</span>
        </div>
        <div v-if="shadow" class="op-grid" :style="{ gridTemplateColumns: `repeat(${GAME_CONFIG.boardWidth}, ${OPP_CELL}px)` }">
          <template v-for="(row, y) in shadow.board" :key="y">
            <div v-for="(v, x) in row" :key="x" class="op-cell"
                 :style="{ width: OPP_CELL + 'px', height: OPP_CELL + 'px', background: v ? mp.cellColor(v).backgroundColor : 'rgba(26,26,46,0.9)' }" />
          </template>
        </div>
        <div v-else class="op-empty">стакан соперника появится здесь</div>
        <div class="op-meta" v-if="shadow">линии: {{ shadow.linesCleared }} · далее: {{ shadow.nextType ?? '—' }}</div>
      </div>
    </div>

    <div class="own-wrap">
      <canvas ref="ownCanvas" class="own-canvas" />
      <div v-if="countdown !== null" class="mp-countdown" data-testid="mp-countdown">{{ countdown }}</div>
      <div v-if="mp.matchOverInfo" class="mp-over" data-testid="mp-over">
        <div class="over-title">МАТЧ ОКОНЧЕН</div>
        <div v-for="r in mp.matchOverInfo.results" :key="r.playerId" class="over-row">
          <span class="over-place">#{{ r.placement }}</span> {{ r.name }}
          <span class="over-lines">{{ r.lines }} лин.</span>
        </div>
        <button class="mp-btn" data-testid="mp-to-room" @click="emit('room')">В комнату</button>
      </div>
    </div>

    <div class="side">
      <div class="room-code-mini">{{ mp.room?.code }}</div>
      <div class="stat"><span>Счёт</span><b>{{ mp.mpGameState.score }}</b></div>
      <div class="stat"><span>Линии</span><b>{{ mp.mpGameState.linesCleared }}</b></div>
      <div class="stat"><span>Уровень</span><b>{{ mp.mpGameState.level }}</b></div>
      <button v-if="!mp.matchOverInfo" class="mp-btn mp-btn-surrender" data-testid="mp-surrender" @click="surrenderClick">
        Сдаться
      </button>
    </div>
  </div>
</template>

<style scoped>
.mp-game {
  display: flex;
  gap: 18px;
  align-items: center;
  height: 100vh;
  color: #cfe8ff;
}
.opponents { display: flex; flex-direction: column; gap: 14px; }
.op-panel {
  border: 2px solid #ff00ff;
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 0 14px rgba(255, 0, 255, 0.25);
  width: 106px; /* 10 cells * 9 px + padding/border */
}
.op-name { font-weight: 700; margin-bottom: 6px; }
.op-off { color: #ff8888; font-size: 11px; margin-left: 6px; }
.op-grid { display: grid; gap: 0; }
.op-cell { border-radius: 1px; }
.op-empty { font-size: 11px; color: #8aa; padding: 10px 2px; }
.op-meta { font-size: 11px; color: #8aa; margin-top: 6px; }
.own-wrap { position: relative; }
.own-canvas {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  border: 2px solid #00f5ff;
  border-radius: 8px;
  box-shadow: 0 0 20px rgba(0, 245, 255, 0.3);
}
.mp-countdown {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 96px;
  font-weight: 900;
  color: #ffe600;
  text-shadow: 0 0 24px rgba(255, 230, 0, 0.7);
  background: rgba(10, 10, 26, 0.55);
  border-radius: 8px;
}
.mp-over {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 26, 0.92);
  border-radius: 8px;
  z-index: 5;
}
.over-title { font-size: 22px; font-weight: 900; letter-spacing: 4px; color: #ffe600; }
.over-row { display: flex; gap: 10px; }
.over-place { color: #ffe600; font-weight: 700; }
.over-lines { color: #8aa; margin-left: 6px; }
.side { display: flex; flex-direction: column; gap: 10px; min-width: 150px; }
.room-code-mini { text-align: center; letter-spacing: 4px; color: #ffe600; font-weight: 900; margin-bottom: 6px; }
.stat { display: flex; justify-content: space-between; border: 1px solid rgba(0, 245, 255, 0.25); border-radius: 6px; padding: 6px 10px; }
.stat span { color: #8aa; }
.mp-btn {
  background: rgba(0, 245, 255, 0.12);
  border: 2px solid #00f5ff;
  border-radius: 8px;
  color: #00f5ff;
  font-weight: 700;
  padding: 10px 14px;
  cursor: pointer;
}
.mp-btn-surrender { border-color: #ff4444; color: #ff8888; background: rgba(255, 68, 68, 0.08); }
@media (max-width: 900px) {
  .mp-game { flex-direction: column; height: auto; padding: 40px 8px; }
}
</style>
