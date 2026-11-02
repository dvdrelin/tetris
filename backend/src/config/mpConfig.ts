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
})
