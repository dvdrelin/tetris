import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ScoreEntry {
  id: string
  player_name: string
  score: number
  mode: number
  level: number
  lines_cleared: number
  created_at: string
}

export interface LeaderboardEntry {
  player: string
  totalScore: number
  games: number
  highScore: number
}

export const useLeaderboardStore = defineStore('leaderboard', () => {
  const topScores = ref<ScoreEntry[]>([])
  const leaderboard = ref<LeaderboardEntry[]>([])
  const mode = ref<number>(-1)
  const loading = ref(false)

  async function fetchTopScores(m: number = -1) {
    mode.value = m
    loading.value = true
    try {
      const res = await fetch(`/api/scores?mode=${m}&limit=10`)
      const data = await res.json()
      topScores.value = data.scores || []
    } catch (e) {
      console.error('Failed to fetch scores:', e)
      topScores.value = []
    }
    loading.value = false
  }

  async function fetchLeaderboard(m: number = -1) {
    mode.value = m
    loading.value = true
    try {
      const res = await fetch(`/api/leaderboard?mode=${m}`)
      const data = await res.json()
      leaderboard.value = data.leaderboard || []
    } catch (e) {
      console.error('Failed to fetch leaderboard:', e)
      leaderboard.value = []
    }
    loading.value = false
  }

  return { topScores, leaderboard, mode, loading, fetchTopScores, fetchLeaderboard }
})
