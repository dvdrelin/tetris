/**
 * C4: the player name is typed by the player and remembered between sessions. The backend accepts
 * a non-empty trimmed name of at most 32 characters (`LIMITS.playerNameMax` in
 * backend/src/routes/gameRouter.ts), so the same bounds are enforced here before a score is sent —
 * otherwise a long name would be rejected by the server with a 400 in the background.
 */
export const PLAYER_NAME_KEY = 'neon-tetris.playerName';
export const PLAYER_NAME_MAX = 32;
export const DEFAULT_PLAYER_NAME = 'Игрок';

/** Trim, clamp to the backend limit, fall back to the default for an empty value. */
export function normalizePlayerName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PLAYER_NAME;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_PLAYER_NAME;
  return trimmed.slice(0, PLAYER_NAME_MAX);
}

/** localStorage is not always available (private mode, disabled storage): never throw. */
export function loadPlayerName(): string {
  try {
    const stored = localStorage.getItem(PLAYER_NAME_KEY);
    return normalizePlayerName(stored);
  } catch {
    return DEFAULT_PLAYER_NAME;
  }
}

export function savePlayerName(name: string): string {
  const safe = normalizePlayerName(name);
  try {
    localStorage.setItem(PLAYER_NAME_KEY, safe);
  } catch {
    // Persistence is best-effort: the name still works for this session.
  }
  return safe;
}
