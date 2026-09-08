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
    let bgCtx: CanvasRenderingContext2D | null = null
    let bgParticles: Array<{ x: number; y: number; vx: number; vy: number; size: number; baseAlpha: number; hue: number }> = []
    let lastBgTime = 0
    let bgStartTime = 0

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

    // Cosmic breathing — gentle, dark, peaceful
    const COSMIC_CYCLE = 12000 // 12s full cycle (slow breathing)
    const PARTICLE_COUNT = 360

    function initBgCanvas() {
      const canvas = document.createElement('canvas')
      canvas.id = 'bg-canvas'
      canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;'
      document.body.prepend(canvas)
      bgCanvas = canvas
      bgCtx = canvas.getContext('2d')

      const w = window.innerWidth
      const h = window.innerHeight

      bgParticles = []
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        bgParticles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          size: 0.8 + Math.random() * 2,
          phase: Math.random() * Math.PI * 2, // smooth opacity phase per particle
          speed: 0.3 + Math.random() * 0.5,   // breathing speed per particle
          alphaMin: 0.08 + Math.random() * 0.12,
          alphaMax: 0.3 + Math.random() * 0.2,
          hue: Math.random() * 60 + 220, // blues and purples: 220-280
        })
      }

      bgStartTime = performance.now()

      function animateBg(timestamp: number) {
        if (!lastBgTime) lastBgTime = timestamp
        const dt = (timestamp - lastBgTime) / 1000
        lastBgTime = timestamp

        const cw = bgCanvas!.width
        const ch = bgCanvas!.height
        bgCtx!.clearRect(0, 0, cw, ch)

        const elapsed = timestamp - bgStartTime

        for (let i = 0; i < bgParticles.length; i++) {
          const p = bgParticles[i]

          // Move particle
          p.x += p.vx * dt * 60
          p.y += p.vy * dt * 60

          // Seamless wrap
          if (p.x < 0) p.x = cw
          if (p.x > cw) p.x = 0
          if (p.y < 0) p.y = ch
          if (p.y > ch) p.y = 0

          // Gentle breathing opacity — smooth sine wave per particle
          const breathT = elapsed * 0.001 * p.speed + p.phase
          const breath = 0.5 + 0.5 * Math.sin(breathT)
          const alpha = p.alphaMin + (p.alphaMax - p.alphaMin) * breath

          bgCtx!.fillStyle = `hsla(${p.hue}, 50%, 55%, ${alpha})`
          bgCtx!.beginPath()
          bgCtx!.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          bgCtx!.fill()
        }

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
      animateBg(performance.now())
    }

    function stopBgCanvas() {
      if (bgAnimId) cancelAnimationFrame(bgAnimId)
      if (bgCanvas) {
        bgCanvas.remove()
        bgCanvas = null
      }
      bgCtx = null
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
  background: rgba(10, 10, 26, 0.7);
  position: relative;
  z-index: 1;
}

body {
  background: #0a0a1a;
  overflow: hidden;
}
</style>
