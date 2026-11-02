/**
 * Multiplayer room-server knobs (MP block B). Pure constants with env overrides — the balance
 * numbers of *gameplay* (attack formulas, delays) belong to design.game/02_GAME_CONFIG.json and
 * arrive with block D; these are the transport/lifecycle guards block B enforces.
 */
const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export const MP_CONFIG = Object.freeze({
  /** Human-friendly room code: unambiguous alphabet (no I/O/U/0/1/L), deploy-friendly. */
  roomCodeLen: 4,
  roomCodeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  minPlayersToStart: num('MP_MIN_PLAYERS', 2),
  defaultMaxPlayers: 2,
  maxPlayersCap: 4,
  /** Delay between `game_start` broadcast and the aligned round start (client countdown). */
  startDelayMs: num('MP_START_DELAY_MS', 2000),
  /** How long a dropped socket keeps its seat before being replaced/forfeited (block C reconnect). */
  rejoinGraceMs: num('MP_REJOIN_GRACE_MS', 120_000),
  chatCooldownMs: num('MP_CHAT_COOLDOWN_MS', 500),
  chatMaxLen: num('MP_CHAT_MAX_LEN', 200),
  chatHistorySize: num('MP_CHAT_HISTORY_SIZE', 20),
  /** Per-connection inbound message budget (reuses the pure RateLimiter from D1). */
  msgWindowMs: num('MP_MSG_WINDOW_MS', 1000),
  msgMaxPerWindow: num('MP_MSG_MAX_PER_SEC', 60),
  /** Lifetime protocol violations (bad JSON, unknown type, rate hits) before terminate. */
  maxViolations: num('MP_MAX_VIOLATIONS', 30),
  /** Hard cap for one inbound WS frame — protocol messages are tiny; 16 KiB is generous. */
  maxPayloadBytes: num('MP_MAX_PAYLOAD', 16_384),
  /** Server-side ws transport heartbeat (README-of-ws pattern; nginx idle is 60 s). */
  transportPingMs: num('MP_TRANSPORT_PING_MS', 30_000),
  /** heads_up time limit (02_GAME_CONFIG match.heads_up.time_limit_sec). */
  timeLimitSec: num('MP_TIME_LIMIT_SEC', 180),
  /** How often scheduled garbage is checked against the clock and shipped out. */
  garbageSweepMs: num('MP_GARBAGE_SWEEP_MS', 250),
  /** GDD room.fast_phrase: one preset phrase per player per window, length cap 50. */
  fastPhraseRateLimitMs: num('MP_FAST_PHRASE_MS', 3000),
  fastPhraseMaxLen: num('MP_FAST_PHRASE_MAX_LEN', 50),
  /** Match diagnostics: one append-only JSONL per match under backend/data/mp-matches. MP_LOGS=0 off. */
  logsEnabled: process.env.MP_LOGS !== '0',
  logMaxFiles: num('MP_LOG_MAX_FILES', 300),
  /** Secret for GET /api/mp/matches… Empty → the endpoints answer 503, logs are SSH-only. */
  logAdminToken: (process.env.MP_ADMIN_TOKEN ?? '').trim(),
  /**
   * Soft resync of a lost `piece_lock` report (instead of an instant cheat verdict): the server
   * asks for the missing steps and waits this long for the retransmission before forfeiting.
   * A gap wider than resyncMaxGap, or more than resyncMaxPerMatch incidents, stays a forfeit.
   */
  resyncGraceMs: num('MP_RESYNC_GRACE_MS', 3000),
  resyncMaxGap: num('MP_RESYNC_MAX_GAP', 12),
  resyncMaxPerMatch: num('MP_RESYNC_MAX_PER_MATCH', 3),
})
