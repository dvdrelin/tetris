import { test, expect } from '@playwright/test';
import { getErrors, getWarnings } from './helpers';

/**
 * A leaderboard that cannot be read must degrade, not crash: the user sees an empty table,
 * the console carries a *warning* (the error channel stays clean, and it stays that way for the
 * rest of the E2E suite), and `loading` is released.
 *
 * Reads are stubbed at the network layer, so this is about the client's behaviour only.
 */
test.describe('Leaderboard degraded reads', () => {
  test('an HTTP 500 on the score reads warns instead of erroring and empties the tables', async ({ page }) => {
    await page.route('**/api/scores**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.route('**/api/leaderboard**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));

    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.leaderboard-btn').click();
    await expect(page.locator('.leaderboard-container')).toBeVisible();

    // Tab "Рекорды" is the default and issues GET /api/scores on mount.
    await expect
      .poll(async () => (await getWarnings(page)).some((w) => w.includes('Could not load scores') && w.includes('500')), { timeout: 5000 })
      .toBe(true);
    await expect(page.locator('.score-table tbody tr')).toHaveCount(0);

    // Second read: tab "Лидерборд" → GET /api/leaderboard.
    await page.locator('.tabs button').last().click();
    await expect
      .poll(async () => (await getWarnings(page)).some((w) => w.includes('Could not load leaderboard') && w.includes('500')), { timeout: 5000 })
      .toBe(true);
    await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(0);

    // The loading flag must not stay stuck, otherwise the view would show "Загрузка..." forever.
    await expect(page.locator('.loading')).toHaveCount(0);

    expect(await getErrors(page)).toHaveLength(0);
  });

  test('a healthy read renders rows and keeps the console silent', async ({ page }) => {
    const row = {
      id: 'stub-1', player_name: 'StubPlayer', score: 12345, mode: 0,
      level: 4, lines_cleared: 12, created_at: '2026-11-01T12:00:00.000Z',
    };
    await page.route('**/api/scores**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scores: [row] }) }));
    await page.route('**/api/leaderboard**', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ leaderboard: [{ player: 'StubPlayer', totalScore: 12345, games: 1, highScore: 12345 }] }),
      }));

    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.leaderboard-btn').click();

    await expect(page.locator('.score-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.score-table tbody tr').first()).toContainText('StubPlayer');

    await page.locator('.tabs button').last().click();
    await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(1);

    expect(await getWarnings(page)).toHaveLength(0);
    expect(await getErrors(page)).toHaveLength(0);
  });
});
