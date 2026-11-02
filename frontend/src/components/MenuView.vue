<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useGameStore } from '../stores/gameStore'
import { GameMode } from '@neon-tetris/shared/domain/types'
import { CONTROL_HINTS } from '@neon-tetris/shared/config/control-hints'
import { PLAYER_NAME_MAX } from '@neon-tetris/shared/domain/player-name'

export default defineComponent({
  name: 'MenuView',
  emits: ['start', 'leaderboard', 'multiplayer'],
  setup(_, { emit }) {
    const gameStore = useGameStore()
    const selectedMode = ref<'arcade' | 'hardcore'>('arcade')
    const hoveredMode = ref<string | null>(null)
    // The field holds the raw input; the store keeps the normalized name. Normalizing on every
    // keystroke would eat the space the user has just typed between two words.
    const nameDraft = ref<string>(gameStore.playerName)

    function commitName() {
      gameStore.playerName = nameDraft.value
      nameDraft.value = gameStore.playerName
    }

    // C6: gameStore.init() used to be called here as well as in App.vue, which replaced the engine
    // instance every time the menu mounted. App.vue owns the single init().
    function startGame() {
      commitName()
      const mode = selectedMode.value === 'arcade' ? GameMode.Arcade : GameMode.Hardcore
      gameStore.startGame(mode)
      emit('start')
    }

    function goToLeaderboard() {
      emit('leaderboard')
    }

    function goMultiplayer() {
      commitName()
      emit('multiplayer')
    }

    return {
      selectedMode,
      hoveredMode,
      gameStore,
      nameDraft,
      commitName,
      PLAYER_NAME_MAX,
      CONTROL_HINTS,
      APP_VERSION: __APP_VERSION__,
      startGame,
      goToLeaderboard,
      goMultiplayer,
    }
  },
})
</script>

<template>
  <div class="menu-container">
    <div class="app-version" data-testid="app-version">{{ APP_VERSION }}</div>
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
    <div class="name-section">
      <label class="name-label" for="player-name">Имя игрока</label>
      <input
        id="player-name"
        class="name-input"
        type="text"
        :maxlength="PLAYER_NAME_MAX"
        v-model="nameDraft"
        @blur="commitName"
        @keyup.enter="commitName"
        placeholder="Игрок"
      />
    </div>
    <button class="start-btn" @click="startGame">
      <span>ИГРАТЬ</span>
    </button>
    <div class="controls">
      <div class="control-row" v-for="(hint, index) in CONTROL_HINTS" :key="index">
        <span class="key">{{ hint.key }}</span>
        <span class="action">{{ hint.label }}</span>
      </div>
    </div>
    <button class="leaderboard-btn" @click="goToLeaderboard">
      <span>🏆 РЕКОРДЫ</span>
    </button>
    <button class="multiplayer-btn" data-testid="menu-multiplayer" @click="goMultiplayer">
      <span>👥 МУЛЬТИПЛЕЕР</span>
    </button>
  </div>
</template>

<style scoped>
.app-version {
  position: fixed;
  top: 14px;
  right: 18px;
  font-size: 13px;
  letter-spacing: 1px;
  color: rgba(207, 232, 255, 0.55);
  z-index: 10;
  user-select: none;
}
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

.name-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.name-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #888;
}

.name-input {
  width: 260px;
  padding: 12px 16px;
  font-size: 16px;
  color: #00f5ff;
  text-align: center;
  background: rgba(26, 26, 46, 0.8);
  border: 2px solid #2a2a3e;
  border-radius: 10px;
  outline: none;
  transition: all 0.3s ease;
}

.name-input:focus {
  border-color: #00f5ff;
  box-shadow: 0 0 20px rgba(0, 245, 255, 0.3);
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

.leaderboard-btn {
  background: rgba(255, 230, 0, 0.1);
  border: 2px solid #ffe600;
  border-radius: 12px;
  padding: 16px 40px;
  font-size: 18px;
  font-weight: 900;
  color: #ffe600;
  cursor: pointer;
  transition: all 0.3s ease;
  letter-spacing: 2px;
}

.multiplayer-btn {
  background: rgba(255, 0, 255, 0.1);
  border: 2px solid #ff00ff;
  border-radius: 12px;
  padding: 14px 32px;
  font-size: 16px;
  font-weight: 900;
  color: #ff66ff;
  cursor: pointer;
  transition: all 0.3s ease;
  letter-spacing: 2px;
}
.multiplayer-btn:hover {
  box-shadow: 0 0 20px rgba(255, 0, 255, 0.4);
}

.leaderboard-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 0 40px rgba(255, 230, 0, 0.5);
  background: rgba(255, 230, 0, 0.15);
}
</style>
