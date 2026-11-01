import { test, expect } from '@playwright/test';
import { getErrors, getWarnings } from './helpers';

/**
 * A leaderboard that cannot be read must degrade visibly, not crash and not lie:
 *  - the player sees why the table is empty (an honest error panel + retry), not "no records";
 *  - the console carries a *warning* — the error channel stays clean for the rest of the suite;
 *  - `loading` is released, so the view never sticks on "Загрузка...".
 *
 * Reads are stubbed at the network layer: this is about the client's behaviour only.
 */
test.describe('Leaderboard degraded reads', () => {
  test('an HTTP 500 shows an error panel with a reason, warns (not errors), and retry can recover', async ({ page }) => {
    let scoresAttempts = 0;
    let leaderboardAttempts = 0;
    await page.route('**/api/scores**', (route) => {
      scoresAttempts += 1;
      if (scoresAttempts === 1) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      }
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ scores: [{ id: 'r1', player_name: 'Recovered', score: 10, mode: 0, level: 1, lines_cleared: 1, created_at: '2026-11-01T12:00:00.000Z' }] }),
      });
    });
    await page.route('**/api/leaderboard**', (route) => {
      leaderboardAttempts += 1;
      if (leaderboardAttempts === 1) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      }
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ leaderboard: [{ player: 'RecoveredBoard', totalScore: 40, games: 2, highScore: 30 }] }),
      });
    });

    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.leaderboard-btn').click();
    await expect(page.locator('.leaderboard-container')).toBeVisible();

    // Tab "Топ-10" is the default and issues GET /api/scores on mount.
    const panel = page.locator('.load-error');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('500');
    await expect(panel).toContainText('рекорды');
    await expect(panel.locator('.retry-btn')).toBeVisible();
    await expect(page.locator('.score-table')).toHaveCount(0);

    await expect
      .poll(async () => (await getWarnings(page)).some((w) => w.includes('Could not load scores') && w.includes('500')), { timeout: 5000 })
      .toBe(true);

    // The loading flag must not stay stuck, otherwise the view would sit on "Загрузка..." forever.
    await expect(page.locator('.loading')).toHaveCount(0);

    // Retry on the same tab recovers: the stub now answers 200 → panel gone, row rendered.
    await page.locator('.retry-btn').click();
    await expect(page.locator('.load-error')).toHaveCount(0);
    await expect(page.locator('.score-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.score-table tbody tr').first()).toContainText('Recovered');

    // The other tab degrades on its own first read, and its own retry recovers too.
    await page.locator('.tabs button').last().click();
    await expect(page.locator('.load-error')).toBeVisible();
    await expect(page.locator('.load-error')).toContainText('лидерборд');
    await expect
      .poll(async () => (await getWarnings(page)).some((w) => w.includes('Could not load leaderboard') && w.includes('500')), { timeout: 5000 })
      .toBe(true);
    await page.locator('.retry-btn').click();
    await expect(page.locator('.load-error')).toHaveCount(0);
    await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.leaderboard-table tbody tr').first()).toContainText('RecoveredBoard');

    expect(await getErrors(page)).toHaveLength(0);
  });

  test('an honest "no records yet" (200 + empty list) is NOT an error state', async ({ page }) => {
    await page.route('**/api/scores**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scores: [] }) }));

    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.leaderboard-btn').click();

    await expect(page.locator('.score-table')).toBeVisible();
    await expect(page.locator('.score-table tbody tr')).toHaveCount(0);
    await expect(page.locator('.load-error')).toHaveCount(0);
    expect(await getWarnings(page)).toHaveLength(0);
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
    await expect(page.locator('.load-error')).toHaveCount(0);

    expect(await getWarnings(page)).toHaveLength(0);
    expect(await getErrors(page)).toHaveLength(0);
  });
});
