import { test, expect } from '@playwright/test';
import { getErrors, getGameState, startGame } from './helpers';

const NAME_KEY = 'neon-tetris.playerName';

/**
 * Block 6 (C4): the player name is typed in the menu, normalized to the backend limits and
 * remembered in localStorage.
 */
test.describe('Player name (C4)', () => {
  test('the field exists, is saved on start and survives a reload', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('.name-input');
    await expect(input).toBeVisible();
    await input.fill('  Маша  ');

    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), NAME_KEY)).toBe('Маша');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.name-input')).toHaveValue('Маша');

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('an overlong name is clamped to the backend limit (32)', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.name-input').fill('x'.repeat(40));
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    const saved = await page.evaluate((k) => localStorage.getItem(k), NAME_KEY);
    expect(saved).toHaveLength(32);
  });

  test('an empty name falls back to the default', async ({ page }) => {
    await startGame(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.title-word')).toBeVisible();

    // The default name is a display fallback, not something the app writes to storage on its own.
    await page.locator('.name-input').fill('   ');
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), NAME_KEY)).toBe('Игрок');

    const state = await getGameState(page);
    expect(state?.isRunning).toBe(true);
  });
});
