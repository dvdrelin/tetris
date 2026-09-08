<script lang="ts">
import { defineComponent, computed, ref, onMounted, onUnmounted } from 'vue'
import { useGameStore } from './stores/gameStore'
import MenuView from './components/MenuView.vue'
import GameView from './components/GameView.vue'

export default defineComponent({
  name: 'App',
  setup() {
    const gameStore = useGameStore()
    const showMenu = ref(true)

    const currentView = computed(() => {
      return showMenu.value ? 'menu' : 'game'
    })

    function showGame() {
      showMenu.value = false
    }

    function showMainMenu() {
      showMenu.value = true
    }

    onMounted(() => {
      gameStore.init()
    })

    return {
      showMenu,
      currentView,
      showGame,
      showMainMenu,
    }
  },
  components: {
    MenuView,
    GameView,
  },
})
</script>

<template>
  <div id="app-root">
    <MenuView v-if="showMenu" @start="showGame" />
    <GameView v-else @menu="showMainMenu" />
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
