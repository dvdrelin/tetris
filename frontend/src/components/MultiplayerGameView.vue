<script lang="ts">
// MP block C — the versus screen: own board (canvas, same renderer as single-player, seeded
// engine) + opponent shadow boards (DOM grids rebuilt from relayed locks) + aligned countdown
// from the server's startTime, surrender and the match-over results overlay.
import { defineComponent, ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useMultiplayerStore } from '../stores/multiplayerStore'
import { render, RenderState } from '../engine/renderer'
import { InputController } from '@neon-tetris/shared/input/input-controller'
import { InputAction, actionToCommand } from '@neon-tetris/shared/input/input-actions'
import { GAME_CONFIG } from '@neon-tetris/shared/config/game-config'

const CELL = 24
const BOARD_W = GAME_CONFIG.boardWidth
const BOARD_H = GAME_CONFIG.boardHeight
const OPP_CELL = 9

// GDD room.fast_phrase (chat preset layer): one tap says the polite thing mid-tetris. The
// design's fast_phrase_rate_limit_ms=3000 is honoured client-side; the server keeps its own
// general chat cooldown as the outer guard.
const QUICK_PHRASES = ['Удачи!', 'GG', 'Красиво!', 'Ой!']
const QUICK_RATE_LIMIT_MS = 3000

export default defineComponent({
  name: 'MultiplayerGameView',
  emits: ['room'],
  setup(_, { emit }) {
    const mp = useMultiplayerStore()
    const ownCanvas = ref<HTMLCanvasElement | null>(null)
    const countdown = ref<number | null>(null)

    const opponents = computed(() => {
      // The roster is authoritative while the seat exists; a seat that was already removed (a
      // drop that ran out of grace) keeps its glass as long as we hold a picture of it — the
      // panel disappearing mid-match reads as "стака́н соперника пустой".
      const players = mp.room?.players ?? []
      const seen = new Set(players.map((p) => p.id))
      const extras = Object.keys(mp.shadows)
        .filter((id) => id !== mp.myId && !seen.has(id))
        .map((id) => ({ id, name: id.slice(0, 8), connected: false }))
      return [...players, ...extras]
        .filter((p) => p.id !== mp.myId)
        .map((p) => ({ player: p, shadow: mp.shadows[p.id] ?? null }))
    })

    // ----- match narrative (bug class: "nothing told me why the match ended / stopped moving") -----
    // A slowly refreshed clock so the reconnect countdown below actually counts down.
    const nowTick = ref(Date.now())

    const dropCountdown = computed<number | null>(() => {
      const d = mp.dropNotice
      if (!d) return null
      if (d.returnBy === null) return 0
      return Math.max(0, Math.ceil((d.returnBy - nowTick.value) / 1000))
    })

    /** One line that says why the match ended, from *this* player's point of view. */
    const overReasonText = computed(() => {
      const info = mp.matchOverInfo
      if (!info) return ''
      const mine = mp.myOverCause
      // The server says what actually happened (a surrender button, a page reload, a walk-out, a
      // dead socket, the anticheat, a top-out, the clock). Each side reads its own point of view —
      // a shared "сдался или вне игры" is exactly what made players argue about the verdict.
      switch (info.detail) {
        case 'surrender_button':
          return mine === 'button' ? 'Вы сдались' : 'Соперник нажал «Сдаться»'
        case 'reload':
          // The client can only state a fact it observed locally — the board state was gone when we
          // rejoined. Whether the human reloaded or the browser discarded a background tab is the
          // server log's job to tell (socket_closed vs surrender), so the wording stays neutral.
          return mine === 'reload'
            ? 'Состояние нашего стакана пропало: страница закрыта, выгружена браузером или перезагружена — матч потерян технически'
            : 'Состояние стакана соперника пропало (страница закрыта, выгружена браузером или перезагружена) — техническая победа'
        case 'left_room':
          return mine ? 'Вы вышли из комнаты прямо во время матча' : 'Соперник вышел из комнаты прямо во время матча'
        case 'disconnect':
          return 'Соперник потерял связь и не вернулся в матч за отведённое время'
        case 'invalid_move':
          // A report the server could not *parse* is a different animal from a move that failed the
          // replay: the PRA4 post-mortem showed a client-side payload bug being reported to the player
          // as an anticheat rejection. Name the field, and do not call the player a cheater.
          if (mp.lockRejected) {
            return `Сервер не смог разобрать ваш отчёт о ходе ${mp.lockRejected.step}: поле ${mp.lockRejected.field} = ${mp.lockRejected.value}. Матч закрыт из-за рассинхронизации отчётов, это ошибка приложения — сообщите нам код матча`
          }
          return mp.invalidMoveSeen
            ? 'Сервер отклонил ваш ход (он не совпал с его реплеем) — матч закрыт'
            : 'Ход соперника не совпал с серверным реплеем — матч закрыт анти-читом'
        case 'topout':
          return mine ? 'Ваш стакан дошёл до верха' : 'Соперник развалился — его стакан дошёл до верха'
        case 'time_limit':
          return 'Время матча вышло — победа по набранным линиям'
      }
      // Older server without `detail`: fall back to the rule verdict alone.
      if (mp.invalidMoveSeen) {
        return 'Сервер отклонил ваш ход (не совпал с его реплеем) — матч закрыт'
      }
      switch (info.reason) {
        case 'topout':
          return mine ? 'Ваш стакан дошёл до верха' : 'Соперник развалился — его стакан дошёл до верха'
        case 'surrender':
          return mine === 'button' ? 'Вы сдались' : 'Соперник сдался'
        case 'forfeit':
          if (mine === 'reload') return 'Страница перезагрузилась — матч потерян технически'
          return 'Соперник отключился — техническая победа'
        case 'survival':
          return 'Время матча вышло'
        default:
          return ''
      }
    })

    // We lost the server while the match is still ours to play: say so instead of freezing.
    const connectionLost = computed(() => Boolean(mp.match) && !mp.matchOverInfo && !mp.connected)

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
    let lastClockTick = 0

    function loop(timestamp: number) {
      if (!lastTime) lastTime = timestamp
      const dtMs = timestamp - lastTime
      lastTime = timestamp
      // Cheap wall clock for the reconnect countdown — twice a second is plenty.
      if (timestamp - lastClockTick > 500) {
        lastClockTick = timestamp
        nowTick.value = Date.now()
      }

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

    // ----- fast phrases + toast -----
    const quickReadyAt = ref(0)
    const phraseToast = ref<{ name: string; text: string } | null>(null)
    let toastTimer: ReturnType<typeof setTimeout> | null = null

    function quick(text: string) {
      const now = Date.now()
      if (now < quickReadyAt.value) return // client mirror of the server rate limit (no wasted round trip)
      quickReadyAt.value = now + QUICK_RATE_LIMIT_MS
      mp.sendFastPhrase(text)
    }

    watch(() => mp.lastPhrase, (p) => {
      if (!p || p.playerId === mp.myId) return
      phraseToast.value = { name: p.name, text: p.text }
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { phraseToast.value = null }, 5000)
    })

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
      if (toastTimer) clearTimeout(toastTimer)
      input.releaseAll()
    })

    return {
      mp, ownCanvas, countdown, opponents, surrenderClick, emit, GAME_CONFIG, OPP_CELL,
      QUICK_PHRASES, quick, quickReadyAt, phraseToast,
      overReasonText, dropCountdown, connectionLost,
    }
  },
})
</script>

<template>
  <div class="mp-game" data-testid="mp-game">
    <div class="opponents">
      <div v-for="{ player, shadow } in opponents" :key="player.id" class="op-panel"
           :data-testid="'mp-op-' + player.id.slice(0, 8)">
        <div class="op-name">
          Соперник · {{ player.name }}
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
      <div class="board-label board-label-me" data-testid="mp-own-label">
        Ваш стакан · {{ mp.me?.name ?? '—' }}
      </div>
      <canvas ref="ownCanvas" class="own-canvas" />
      <div v-if="countdown !== null" class="mp-countdown" data-testid="mp-countdown">{{ countdown }}</div>
      <div v-if="connectionLost" class="mp-banner mp-banner-warn" data-testid="mp-conn-lost">
        Нет связи с сервером — переподключение…
      </div>
      <div v-else-if="mp.dropNotice" class="mp-banner" data-testid="mp-drop-notice">
        {{ mp.dropNotice.name }} потерял связь<span v-if="dropCountdown !== null"> — ждём возврата ещё {{ dropCountdown }} с</span>
      </div>
      <div v-if="mp.lockRejected && !mp.matchOverInfo" class="mp-banner mp-banner-warn" data-testid="mp-lock-rejected">
        Сервер не смог разобрать ваш отчёт о ходе {{ mp.lockRejected.step }} (поле {{ mp.lockRejected.field }}
        = {{ mp.lockRejected.value }}). Матч будет закрыт — это ошибка приложения, а не ваша.
      </div>
      <div v-if="phraseToast" class="mp-phrase-toast" data-testid="mp-phrase-toast">
        <b>{{ phraseToast.name }}:</b> {{ phraseToast.text }}
      </div>
      <div v-if="mp.matchOverInfo" class="mp-over" data-testid="mp-over">
        <div class="over-title">МАТЧ ОКОНЧЕН</div>
        <div v-if="overReasonText" class="over-reason" data-testid="mp-over-reason">{{ overReasonText }}</div>
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
      <div class="mp-quick" data-testid="mp-quick">
        <button v-for="p in QUICK_PHRASES" :key="p" class="mp-btn mp-btn-quick" @click="quick(p)">{{ p }}</button>
      </div>
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
/* Which glass is whose: without these labels two boards side by side read as "my stack is
   mirrored from my opponent", especially when both players are idle and the shared bag makes
   the two stacks genuinely identical. */
.board-label {
  position: absolute;
  top: -20px;
  left: 2px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: #8aa;
  white-space: nowrap;
}
.board-label-me { color: #00f5ff; }
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
.mp-banner {
  position: absolute;
  left: 8px;
  top: 8px;
  right: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  background: rgba(10, 10, 26, 0.88);
  border: 1px solid #00f5ff;
  color: #cfe8ff;
  font-size: 13px;
  text-align: center;
  z-index: 4;
}
.mp-banner-warn { border-color: #ffe600; color: #ffe600; }
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
.over-reason { font-size: 13px; color: #cfe8ff; text-align: center; max-width: 90%; }
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
.mp-quick { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
.mp-btn-quick { padding: 6px 8px; font-size: 12px; }
.mp-phrase-toast {
  position: absolute;
  left: 8px;
  bottom: 8px;
  max-width: 80%;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(10, 10, 26, 0.85);
  border: 1px solid #ff00ff;
  color: #cfe8ff;
  font-size: 13px;
  z-index: 4;
}
@media (max-width: 900px) {
  .mp-game { flex-direction: column; height: auto; padding: 40px 8px; }
}
</style>
