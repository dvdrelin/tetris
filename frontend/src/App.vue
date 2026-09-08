<script lang="ts">
import { defineComponent, computed, ref, onMounted, onUnmounted } from 'vue'
import { useGameStore } from './stores/gameStore'
import MenuView from './components/MenuView.vue'
import GameView from './components/GameView.vue'
import LeaderboardView from './components/LeaderboardView.vue'

export default defineComponent({
  name: 'App',
  setup() {
    const gameStore = useGameStore()
    const currentView = ref<'menu' | 'game' | 'leaderboard'>('menu')
    let bgCanvas: HTMLCanvasElement | null = null
    let bgAnimId: number | null = null
    let bgParticles: Array<{ x: number; y: number; vx: number; vy: number; size: number; color: string }> = []
    let lastBgTime = 0

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

    const viewOrder = computed(() => ['menu', 'game', 'leaderboard'])

    function initBgCanvas() {
      const canvas = document.createElement('canvas')
      canvas.id = 'bg-canvas'
      canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;'
      document.body.prepend(canvas)
      bgCanvas = canvas

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      bgParticles = []
      const w = window.innerWidth
      const h = window.innerHeight
      for (let i = 0; i < 50; i++) {
        bgParticles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          size: 1 + Math.random() * 2,
          color: `hsla(${Math.random() * 360}, 80%, 60%, 0.3)`,
        })
      }

      function animateBg(timestamp: number) {
        if (!lastBgTime) lastBgTime = timestamp
        const dt = (timestamp - lastBgTime) / 1000
        lastBgTime = timestamp

        const cw = bgCanvas!.width
        const ch = bgCanvas!.height
        ctx.clearRect(0, 0, cw, ch)

        bgParticles.forEach(p => {
          p.x += p.vx * dt * 60
          p.y += p.vy * dt * 60
          if (p.x < 0 || p.x > cw) p.vx *= -1
          if (p.y < 0 || p.y > ch) p.vy *= -1
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
        })

        bgAnimId = requestAnimationFrame(animateBg)
      }

      function resize() {
        if (bgCanvas) {
          bgCanvas.width = window.innerWidth
          bgCanvas.height = window.innerHeight
        }
      }

      resize()
      window.addEventListener('resize', resize)
      lastBgTime = 0
      animateBg(0)
    }

    function stopBgCanvas() {
      if (bgAnimId) cancelAnimationFrame(bgAnimId)
      if (bgCanvas) {
        bgCanvas.remove()
        bgCanvas = null
      }
      bgParticles = []
    }

    onMounted(() => {
      gameStore.init()
      initBgCanvas()
    })

    onUnmounted(() => {
      stopBgCanvas()
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
  position: relative;
  z-index: 1;
}

body {
  background: #0a0a1a;
  overflow: hidden;
}
</style>
