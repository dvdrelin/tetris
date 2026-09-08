<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../stores/gameStore'
import GameBoard from './GameBoard.vue'
import HudView from './HudView.vue'

export default defineComponent({
  name: 'GameView',
  emits: ['menu'],
  components: { GameBoard, HudView },
  setup(_, { emit }) {
    const gameStore = useGameStore()

    function handleKeydown(e: KeyboardEvent) {
      // Escape → exit to menu (unless paused, then toggle pause)
      if (e.key === 'Escape') {
        const gs = gameStore.gameState
        if (gs.isPaused) {
          gameStore.togglePause()
        } else if (gs.isRunning || gs.isGameOver) {
          emit('menu')
        }
        return
      }
      gameStore.handleKey(e)
    }

    function goMenu() {
      emit('menu')
    }

    return {
      gameStore,
      handleKeydown,
    }
  },
  mounted() {
    document.addEventListener('keydown', this.handleKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeydown)
  },
})
</script>

<template>
  <div class="game-container">
    <button class="menu-btn" @click="$emit('menu')" title="Выход в меню (Esc)">📋 Меню</button>
    <GameBoard />
    <HudView />
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
</style>
