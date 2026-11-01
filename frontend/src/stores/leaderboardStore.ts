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
  /**
   * Human-readable reason why the last read failed, or null when the data is trustworthy.
   * Without this an empty list was ambiguous: "no records" and "the server refused us" looked
   * identical to the player.
   */
  const error = ref<string | null>(null)

  async function fetchTopScores(m: number = -1) {
    mode.value = m
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`/api/scores?mode=${m}&limit=10`)
      if (!res.ok) {
        // A failed read is a degraded leaderboard, not a crash: report it and render "no data".
        console.warn(`Could not load scores: HTTP ${res.status}`)
        topScores.value = []
        error.value = `Не удалось загрузить рекорды (сервер ответил ${res.status}).`
      } else {
        const data = await res.json()
        topScores.value = data.scores || []
      }
    } catch (e) {
      console.warn('Failed to fetch scores:', e)
      topScores.value = []
      error.value = 'Сервер недоступен — рекорды не загрузились.'
    }
    loading.value = false
  }

  async function fetchLeaderboard(m: number = -1) {
    mode.value = m
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`/api/leaderboard?mode=${m}`)
      if (!res.ok) {
        console.warn(`Could not load leaderboard: HTTP ${res.status}`)
        leaderboard.value = []
        error.value = `Не удалось загрузить лидерборд (сервер ответил ${res.status}).`
      } else {
        const data = await res.json()
        leaderboard.value = data.leaderboard || []
      }
    } catch (e) {
      console.warn('Failed to fetch leaderboard:', e)
      leaderboard.value = []
      error.value = 'Сервер недоступен — лидерборд не загрузился.'
    }
    loading.value = false
  }

  return { topScores, leaderboard, mode, loading, error, fetchTopScores, fetchLeaderboard }
})
