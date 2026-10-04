<script lang="ts">
import { defineComponent, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../stores/gameStore'
import GameBoard from './GameBoard.vue'
import HudView from './HudView.vue'
import TouchControls from './TouchControls.vue'
import { InputController } from '../shared/input/input-controller'
import { InputAction, actionToCommand } from '../shared/input/input-actions'

export default defineComponent({
  name: 'GameView',
  emits: ['menu'],
  components: { GameBoard, HudView, TouchControls },
  setup(_, { emit }) {
    const gameStore = useGameStore()

    // The controller decides *when* an action happens (press, DAS, ARR); this function decides
    // *what* it means. Pause goes through the store so the keyboard and the HUD button stay in
    // sync — the HUD button toggles, it does not only pause.
    function fireAction(action: InputAction) {
      if (action === 'pause') {
        gameStore.togglePause()
        return
      }
      gameStore.handleCommand(actionToCommand(action))
    }

    const input = new InputController({ fire: fireAction })

    function handleKeydown(e: KeyboardEvent) {
      // Escape → exit to menu (unless paused, then unpause first) — behaviour C7, unchanged.
      if (e.key === 'Escape') {
        const gs = gameStore.gameState
        if (gs.isPaused) {
          gameStore.togglePause()
        } else if (gs.isRunning || gs.isGameOver) {
          emit('menu')
        }
        return
      }

      const gs = gameStore.gameState
      // Enter restarts the finished game with the same mode (moved here from the store).
      if (gs.isGameOver && e.key === 'Enter') {
        gameStore.startGame(gs.mode)
        return
      }

      if (input.handleKeyDown(e)) e.preventDefault()
    }

    function handleKeyup(e: KeyboardEvent) {
      input.handleKeyUp(e)
    }

    // A held key must not keep moving the piece after the window loses focus or the tab is hidden.
    function releaseHeldKeys() {
      input.releaseAll()
    }

    // Input timing runs on its own animation frame, independent of the gravity loop in
    // GameBoard: DAS/ARR must keep working even when the game itself is not ticking.
    let inputFrame: number | null = null

    function inputLoop() {
      const gs = gameStore.gameState
      if (gs.isRunning && !gs.isPaused && !gs.isGameOver) {
        input.update()
      } else {
        input.releaseAll()
      }
      inputFrame = requestAnimationFrame(inputLoop)
    }

    function goMenu() {
      emit('menu')
    }

    onMounted(() => {
      document.addEventListener('keydown', handleKeydown)
      document.addEventListener('keyup', handleKeyup)
      window.addEventListener('blur', releaseHeldKeys)
      document.addEventListener('visibilitychange', releaseHeldKeys)
      inputFrame = requestAnimationFrame(inputLoop)
    })

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('keyup', handleKeyup)
      window.removeEventListener('blur', releaseHeldKeys)
      document.removeEventListener('visibilitychange', releaseHeldKeys)
      if (inputFrame !== null) cancelAnimationFrame(inputFrame)
      inputFrame = null
      input.releaseAll()
    })

    return {
      gameStore,
      input,
      handleKeydown,
      handleKeyup,
      goMenu,
    }
  },
})
</script>

<template>
  <div class="game-container">
    <button class="menu-btn" @click="$emit('menu')" title="Выход в меню (Esc)">📋 Меню</button>
    <GameBoard />
    <HudView />
    <TouchControls :input="input" />
  </div>
</template>

<style scoped>
.game-container {
  display: flex;
  gap: 20px;
  align-items: center;
  height: 100vh;
}

.menu-btn {
  background: rgba(0, 245, 255, 0.1);
  border: 2px solid #00f5ff;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 700;
  color: #00f5ff;
  cursor: pointer;
  transition: all 0.2s ease;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 100;
}

.menu-btn:hover {
  background: rgba(0, 245, 255, 0.2);
  box-shadow: 0 0 15px rgba(0, 245, 255, 0.3);
}

/* Mobile (B3): the HUD drops under the board instead of squeezing it to the side. */
@media (max-width: 900px) {
  .game-container {
    flex-direction: column;
    align-items: center;
    gap: 10px;
    height: auto;
    min-height: 100vh;
    padding: 52px 8px 150px;
  }
}
</style>
