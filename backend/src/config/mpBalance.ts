/**
 * MP block D — attack/defense balance from design.game/02_GAME_CONFIG.json (v1.0.0).
 * Kept as code (not JSON at runtime) because the numbers are compiled-checked and tiny;
 * keep the two files in sync when rebalancing.
 */
export const MP_BALANCE = Object.freeze({
  /** Clear → attack lines before combo multiplier (perfect_clear is an additive bonus). */
  baseLines: { 1: 1, 2: 2, 3: 4, 4: 7 } as Record<number, number>,
  perfectClearBonus: 10, // match.reward_lines_sent / attack.base_lines.perfect_clear
  perfectClearImmunityMs: 1000, // incoming garbage applied within this window after a PC is dropped
  /** combo 1/2/3/4+ → ×1.0/×1.25/×1.5/×2.0, ceil-rounded (config combo_multiplier + cap). */
  comboMultiplier(combo: number): number {
    if (combo <= 1) return 1.0
    if (combo === 2) return 1.25
    if (combo === 3) return 1.5
    return 2.0
  },
  /** Queue delay before the garbage lands, by clear type; a perfect clear pushes to 1200. */
  delayFor(clearLines: number, wasPerfect: boolean): number {
    if (wasPerfect) return 1200
    const table: Record<number, number> = { 1: 400, 2: 500, 3: 700, 4: 900 }
    return table[clearLines] ?? 900
  },
  counteractRatio: 1.0, // one self-cleared line cancels one pending garbage row
  perPlayerGarbageCap: 20, // rows scheduled but not yet applied
})
