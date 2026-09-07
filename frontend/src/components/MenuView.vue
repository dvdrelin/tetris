<script lang="ts">
import { defineComponent, ref, onMounted } from 'vue'
import { useGameStore } from '../stores/gameStore'
import { GameMode } from '../shared/domain/types'

export default defineComponent({
  name: 'MenuView',
  emits: ['start'],
  setup(_, { emit }) {
    const gameStore = useGameStore()
    const selectedMode = ref<'arcade' | 'hardcore'>('arcade')
    const hoveredMode = ref<string | null>(null)

    gameStore.init()

    function startGame() {
      const mode = selectedMode.value === 'arcade' ? GameMode.Arcade : GameMode.Hardcore
      gameStore.startGame(mode)
      emit('start')
    }

    return {
      selectedMode,
      hoveredMode,
      startGame,
    }
  },
})
</script>

<template>
  <div class="menu-container">
    <div class="title-section">
      <h1 class="title-word">TETRIS</h1>
      <div class="title-line neon-border"></div>
    </div>
    <div class="mode-selector">
      <div
        class="mode-card"
        :class="{ active: selectedMode === 'arcade', hovered: hoveredMode === 'arcade' }"
        @mouseenter="hoveredMode = 'arcade'"
        @mouseleave="hoveredMode = null"
        @click="selectedMode = 'arcade'"
      >
        <div class="mode-icon">🎮</div>
        <div class="mode-name">Аркадный</div>
        <div class="mode-desc">Быстрый темп, комбо-система, яркие эффекты</div>
      </div>
      <div
        class="mode-card"
        :class="{ active: selectedMode === 'hardcore', hovered: hoveredMode === 'hardcore' }"
        @mouseenter="hoveredMode = 'hardcore'"
        @mouseleave="hoveredMode = null"
        @click="selectedMode = 'hardcore'"
      >
        <div class="mode-icon">⚡</div>
        <div class="mode-name">Хардкор</div>
        <div class="mode-desc">Реальное время, максимальная сложность</div>
      </div>
    </div>
    <button class="start-btn" @click="startGame">
      <span>ИГРАТЬ</span>
    </button>
    <div class="controls">
      <div class="control-row">
        <span class="key">← →</span>
        <span class="action">Движение</span>
      </div>
      <div class="control-row">
        <span class="key">↑ / ↓</span>
        <span class="action">Вращение / Сброс</span>
      </div>
      <div class="control-row">
        <span class="key">SPACE</span>
        <span class="action">Hard Drop</span>
      </div>
      <div class="control-row">
        <span class="key">P</span>
        <span class="action">Пауза</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
}

.title-section {
  text-align: center;
  margin-bottom: 20px;
}

.title-line {
  height: 2px;
  background: linear-gradient(90deg, transparent, #00f5ff, #ff00ff, #ffe600, transparent);
  margin: 0 auto;
  width: 300px;
}

.title-word {
  font-size: 72px;
  font-weight: 900;
  letter-spacing: 20px;
  background: linear-gradient(135deg, #00f5ff 0%, #ff00ff 50%, #ffe600 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 20px rgba(0, 245, 255, 0.5));
  animation: titleGlow 2s ease-in-out infinite;
}

@keyframes titleGlow {
  0%, 100% { filter: drop-shadow(0 0 20px rgba(0, 245, 255, 0.5)); }
  50% { filter: drop-shadow(0 0 40px rgba(255, 0, 255, 0.8)); }
}

.mode-selector {
  display: flex;
  gap: 30px;
}

.mode-card {
  background: rgba(26, 26, 46, 0.8);
  border: 2px solid #2a2a3e;
  border-radius: 16px;
  padding: 30px 25px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.mode-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 0 30px rgba(0, 245, 255, 0.3);
}

.mode-card.active {
  border-color: #00f5ff;
  box-shadow: 0 0 30px rgba(0, 245, 255, 0.3);
}

.mode-card.hovered {
  border-color: #ff00ff;
  box-shadow: 0 0 30px rgba(255, 0, 255, 0.3);
}

.mode-icon {
  font-size: 48px;
  margin-bottom: 15px;
}

.mode-name {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 10px;
  background: linear-gradient(135deg, #00f5ff, #ff00ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.mode-desc {
  font-size: 12px;
  color: #888;
}

.start-btn {
  background: linear-gradient(135deg, #00f5ff, #ff00ff);
  border: none;
  border-radius: 12px;
  padding: 20px 60px;
  font-size: 24px;
  font-weight: 900;
  color: #fff;
  cursor: pointer;
  transition: all 0.3s ease;
  letter-spacing: 4px;
}

.start-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 0 40px rgba(0, 245, 255, 0.5);
}

.controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 30px;
  padding: 20px;
  background: rgba(26, 26, 46, 0.5);
  border-radius: 12px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 15px;
}

.key {
  background: rgba(0, 245, 255, 0.1);
  border: 1px solid rgba(0, 245, 255, 0.3);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 700;
  color: #00f5ff;
  min-width: 60px;
  text-align: center;
}

.action {
  color: #aaa;
  font-size: 14px;
}
</style>
