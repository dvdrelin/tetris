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
      gameStore.handleKey(e)
    }

    function goMenu() {
      emit('menu')
    }

    return {
      gameStore,
      handleKeydown,
      goMenu,
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
</style>
