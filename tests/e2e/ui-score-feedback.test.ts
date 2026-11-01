import { test, expect } from '@playwright/test';
import { getErrors, getWarnings, getGameState, startGame } from './helpers';

/**
 * The frontend must notice a rejected score submission instead of losing it silently
 * (the backend now answers 429 when the IP window is used up, and 400 on bad payloads).
 *
 * The POST is mocked at the network layer, so this proves the client's reaction rather than the
 * backend's (the backend half is covered by tests/e2e/zz-score-rate-limit.test.ts and by
 * backend/tests/unit/rateLimit.test.ts).
 */
test.describe('Score submission feedback', () => {
  test('a 429 from POST /api/score surfaces as a console warning, not an error', async ({ page }) => {
    let posted = false;
    await page.route('**/api/score', (route) => {
      posted = true;
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '37' },
        body: JSON.stringify({ error: 'too many score submissions', retryAfter: 37 }),
      });
    });

    await startGame(page);

    // Play until the stack reaches the top: hard drops with no movement fill one column.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(60);
      const state = await getGameState(page);
      if (state?.isGameOver) break;
    }
    const state = await getGameState(page);
    expect(state?.isGameOver).toBe(true);
    expect(posted, 'the game-over flow must attempt POST /api/score').toBe(true);

    await expect
      .poll(async () => (await getWarnings(page)).some((w) => w.includes('Score was not saved') && w.includes('429') && w.includes('too many score submissions')), { timeout: 5000 })
      .toBe(true);

    // A rejected submission is a degraded outcome, not a crash: the error channel stays clean.
    expect(await getErrors(page)).toHaveLength(0);
  });
});
