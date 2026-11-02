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

    <!-- A: the identity block — title and mode choice, always full width. -->
    <header class="menu-head">
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
    </header>

    <!-- B (вход в игру) и D (другие выходы) — левая колонка, разделённые визуальным разрывом. -->
    <section class="menu-col menu-col-left">
      <div class="start-block">
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
      </div>

      <div class="secondary-block">
        <button class="leaderboard-btn" @click="goToLeaderboard">
          <span>🏆 РЕКОРДЫ</span>
        </button>
        <button class="multiplayer-btn" data-testid="menu-multiplayer" @click="goMultiplayer">
          <span>👥 МУЛЬТИПЛЕЕР</span>
        </button>
      </div>
    </section>

    <!-- C: легенда клавиш живёт в своей колонке — раньше она выталкивала кнопки за нижний край. -->
    <aside class="menu-col menu-col-right">
      <div class="controls">
        <div class="control-row" v-for="(hint, index) in CONTROL_HINTS" :key="index">
          <span class="key">{{ hint.key }}</span>
          <span class="action">{{ hint.label }}</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/*
 * The menu used to be one ~1100 px flex column, and `body { overflow: hidden }` (App.vue) clipped
 * whatever did not fit: at 100 % zoom on a laptop the «РЕКОРДЫ» and «МУЛЬТИПЛЕЕР» buttons simply
 * did not exist. Now it is a two-column grid — identity across the top, вход/выходы in the left
 * half, клавиши in the right half — and every size is viewport-relative (clamp), so the same
 * markup fits 1024×768, 1366×768, 1600×900 and a phone. The scrollbar is only a last-resort
 * fallback for absurd windows; the fit itself is asserted in tests/e2e/menu-layout.test.ts.
 */
.menu-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    "head  head"
    "left  right";
  align-items: start;
  justify-items: center;
  gap: clamp(10px, 1.8vh, 26px) clamp(14px, 2.2vw, 40px);
  width: min(1080px, 96vw);
  max-height: 100vh;
  padding: clamp(6px, 1.4vh, 20px) 0;
  overflow: auto;
}

.menu-head {
  grid-area: head;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 1.4vh, 20px);
}

.menu-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(10px, 1.6vh, 24px);
  width: 100%;
}
.menu-col-left { grid-area: left; }
.menu-col-right { grid-area: right; }

.start-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 1.4vh, 18px);
}

/* Блок D отделён от блока B визуальным разрывом: тонкая пунктирная линия + воздух над ней. */
.secondary-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 1.2vh, 14px);
  width: min(340px, 100%);
  padding-top: clamp(10px, 1.6vh, 22px);
  border-top: 1px dashed rgba(0, 245, 255, 0.22);
}

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

.title-section {
  text-align: center;
}

.title-line {
  height: 2px;
  background: linear-gradient(90deg, transparent, #00f5ff, #ff00ff, #ffe600, transparent);
  margin: 0 auto;
  width: min(300px, 70%);
}

.title-word {
  font-size: clamp(30px, 5.6vh, 64px);
  font-weight: 900;
  letter-spacing: clamp(6px, 1.6vh, 20px);
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
  gap: clamp(12px, 1.6vw, 30px);
}

.mode-card {
  background: rgba(26, 26, 46, 0.8);
  border: 2px solid #2a2a3e;
  border-radius: 16px;
  padding: clamp(10px, 1.5vh, 26px) clamp(14px, 1.6vw, 25px);
  max-width: 280px;
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
  font-size: clamp(24px, 3.4vh, 46px);
  margin-bottom: clamp(6px, 1vh, 15px);
}

.mode-name {
  font-size: clamp(15px, 2.2vh, 20px);
  font-weight: 700;
  margin-bottom: clamp(4px, 0.9vh, 10px);
  background: linear-gradient(135deg, #00f5ff, #ff00ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.mode-desc {
  font-size: clamp(10px, 1.5vh, 12px);
  color: #888;
}

.start-btn {
  background: linear-gradient(135deg, #00f5ff, #ff00ff);
  border: none;
  border-radius: 12px;
  padding: clamp(10px, 1.6vh, 20px) clamp(28px, 3vw, 60px);
  font-size: clamp(17px, 2.6vh, 24px);
  font-weight: 900;
  color: #fff;
  cursor: pointer;
  transition: all 0.3s ease;
  letter-spacing: clamp(2px, 0.6vh, 4px);
}

.start-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 0 40px rgba(0, 245, 255, 0.5);
}

.name-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(4px, 0.8vh, 8px);
}

.name-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #888;
}

.name-input {
  width: min(260px, 76%);
  padding: clamp(8px, 1.2vh, 12px) clamp(10px, 1vw, 16px);
  font-size: clamp(14px, 2vh, 16px);
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
  gap: clamp(4px, 0.8vh, 12px);
  padding: clamp(10px, 1.4vh, 20px);
  background: rgba(26, 26, 46, 0.5);
  border-radius: 12px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: clamp(8px, 1.2vw, 15px);
}

.key {
  background: rgba(0, 245, 255, 0.1);
  border: 1px solid rgba(0, 245, 255, 0.3);
  border-radius: 6px;
  padding: clamp(3px, 0.7vh, 6px) clamp(8px, 1vw, 12px);
  font-size: clamp(11px, 1.7vh, 14px);
  font-weight: 700;
  color: #00f5ff;
  min-width: clamp(48px, 5vw, 60px);
  text-align: center;
}

.action {
  color: #aaa;
  font-size: clamp(11px, 1.7vh, 14px);
}

.leaderboard-btn {
  background: rgba(255, 230, 0, 0.1);
  border: 2px solid #ffe600;
  border-radius: 12px;
  padding: clamp(9px, 1.4vh, 16px) clamp(20px, 2.4vw, 40px);
  font-size: clamp(14px, 2.1vh, 18px);
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
  padding: clamp(8px, 1.2vh, 14px) clamp(16px, 2vw, 32px);
  font-size: clamp(12px, 1.9vh, 16px);
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

/* Широкий экран: карточкам хватает ширины, чтобы подпись режима оставалась одной строкой —
   иначе под однострочной подписью «марафона» вырастает двухстрочная «аркады», и ряд выглядит
   лесенкой. */
@media (min-width: 1600px) {
  .mode-card { max-width: 340px; }
}

/* Узкое окно — одна колонка: порядок тот же, что и визуально (А → B → D → C). */
@media (max-width: 860px) {
  .menu-container {
    grid-template-columns: 1fr;
    grid-template-areas:
      "head"
      "left"
      "right";
  }
  .menu-col, .secondary-block { width: min(420px, 100%); }
}

/* Очень низкое окно — режем самое ненесущее: подписи-описания режимов и воздух между строками. */
@media (max-height: 640px) {
  .mode-desc { display: none; }
  .controls { gap: 3px; padding: 8px; }
  .title-line { width: min(200px, 55%); }
}
</style>
