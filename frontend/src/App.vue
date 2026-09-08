<script lang="ts">
import { defineComponent, computed, ref, onMounted } from 'vue'
import { useGameStore } from './stores/gameStore'
import MenuView from './components/MenuView.vue'
import GameView from './components/GameView.vue'
import LeaderboardView from './components/LeaderboardView.vue'

export default defineComponent({
  name: 'App',
  setup() {
    const gameStore = useGameStore()
    const currentView = ref<'menu' | 'game' | 'leaderboard'>('menu')

    const viewOrder = computed(() => {
      return ['menu', 'game', 'leaderboard']
    })

    function showGame() {
      currentView.value = 'game'
    }

    function showMainMenu() {
      currentView.value = 'menu'
    }

    function goToLeaderboard() {
      currentView.value = 'leaderboard'
    }

    function nextView() {
      const idx = viewOrder.value.indexOf(currentView.value)
      currentView.value = viewOrder.value[(idx + 1) % viewOrder.value.length]
    }

    onMounted(() => {
      gameStore.init()
    })

    return {
      currentView,
      showGame,
      showMainMenu,
      goToLeaderboard,
      nextView,
    }
  },
  components: {
    MenuView,
    GameView,
    LeaderboardView,
  },
})
</script>

<template>
  <div id="app-root">
    <MenuView v-if="currentView === 'menu'" @start="showGame" @leaderboard="goToLeaderboard" />
    <GameView v-else-if="currentView === 'game'" @menu="showMainMenu" />
    <LeaderboardView v-else @menu="showMainMenu" />
  </div>
</template>

<style>
#app-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #0a0a1a;
}
</style>
