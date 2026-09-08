<script lang="ts">
import { defineComponent, ref, onMounted } from 'vue'
import { useLeaderboardStore } from '../stores/leaderboardStore'

export default defineComponent({
  name: 'LeaderboardView',
  emits: ['menu'],
  setup(_, { emit }) {
    const lbStore = useLeaderboardStore()
    const activeTab = ref<'scores' | 'leaderboard'>('scores')

    function goMenu() {
      emit('menu')
    }

    function switchTab(tab: 'scores' | 'leaderboard') {
      activeTab.value = tab
      if (tab === 'scores') lbStore.fetchTopScores(lbStore.mode)
      else lbStore.fetchLeaderboard(lbStore.mode)
    }

    function toggleMode() {
      const next = lbStore.mode === -1 ? 0 : lbStore.mode === 0 ? 1 : -1
      lbStore.mode = next
      switchTab(activeTab.value)
    }

    onMounted(() => {
      lbStore.fetchTopScores(lbStore.mode)
    })

    return {
      lbStore,
      activeTab,
      switchTab,
      toggleMode,
      goMenu,
    }
  },
})
</script>

<template>
  <div class="leaderboard-container">
    <div class="header">
      <h1>РЕКОРДЫ</h1>
      <button class="back-btn" @click="goMenu">⬅ Меню</button>
    </div>

    <div class="tabs">
      <button :class="{ active: activeTab === 'scores' }" @click="switchTab('scores')">
        Топ-10
      </button>
      <button :class="{ active: activeTab === 'leaderboard' }" @click="switchTab('leaderboard')">
        Лидерборд
      </button>
    </div>

    <div class="mode-toggle">
      <span>Режим:</span>
      <button @click="toggleMode">
        {{ lbStore.mode === 0 ? 'Аркадный' : lbStore.mode === 1 ? 'Хардкор' : 'Все' }}
      </button>
    </div>

    <div class="content">
      <div v-if="lbStore.loading" class="loading">Загрузка...</div>

      <div v-else-if="activeTab === 'scores'">
        <table class="score-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Игрок</th>
              <th>Счёт</th>
              <th>Уровень</th>
              <th>Линии</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, idx) in lbStore.topScores" :key="entry.id">
              <td>{{ idx + 1 }}</td>
              <td>{{ entry.player_name }}</td>
              <td>{{ entry.score.toLocaleString() }}</td>
              <td>{{ entry.level }}</td>
              <td>{{ entry.lines_cleared }}</td>
              <td>{{ new Date(entry.created_at).toLocaleDateString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="activeTab === 'leaderboard'">
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>Игрок</th>
              <th>Игры</th>
              <th>Общий</th>
              <th>Рекорд</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in lbStore.leaderboard" :key="entry.player">
              <td>{{ entry.player }}</td>
              <td>{{ entry.games }}</td>
              <td>{{ entry.totalScore.toLocaleString() }}</td>
              <td>{{ entry.highScore.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.leaderboard-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  max-width: 700px;
  width: 100%;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
}

.header h1 {
  font-size: 36px;
  font-weight: 900;
  background: linear-gradient(135deg, #00f5ff, #ff00ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: 4px;
}

.back-btn {
  background: rgba(0, 245, 255, 0.1);
  border: 2px solid #00f5ff;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 700;
  color: #00f5ff;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(0, 245, 255, 0.2);
  box-shadow: 0 0 15px rgba(0, 245, 255, 0.3);
}

.tabs {
  display: flex;
  gap: 12px;
}

.tabs button {
  background: rgba(26, 26, 46, 0.8);
  border: 2px solid #2a2a3e;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 700;
  color: #888;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tabs button.active {
  border-color: #00f5ff;
  color: #00f5ff;
  box-shadow: 0 0 15px rgba(0, 245, 255, 0.3);
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #aaa;
}

.mode-toggle button {
  background: rgba(255, 0, 255, 0.1);
  border: 2px solid #ff00ff;
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 700;
  color: #ff00ff;
  cursor: pointer;
}

.content {
  width: 100%;
}

.loading {
  text-align: center;
  color: #888;
  padding: 40px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

td {
  padding: 12px;
  color: #ccc;
  font-size: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

tr:hover td {
  background: rgba(0, 245, 255, 0.05);
}
</style>
