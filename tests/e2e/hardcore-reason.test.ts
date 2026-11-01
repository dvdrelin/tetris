import { test, expect, Page } from '@playwright/test';
import { getErrors, getGameState, getWarnings } from './helpers';

/**
 * A Hardcore death must announce itself. Before this, a wall crash and a refused rotation ended the
 * game exactly like an Arcade block-out — "GAME OVER" over a nearly empty board, no explanation, and
 * the player concluded the game was broken. The engine now carries the cause, and the overlay draws
 * it together with the Arcade rule that does not apply here.
 */

async function startInMode(page: Page, mode: 'Аркадный' | 'Хардкор'): Promise<void> {
  await page.goto('http://localhost:3001');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.mode-card', { hasText: mode }).click();
  await page.locator('.start-btn').click();
  await expect(page.locator('.board-canvas')).toBeVisible();
  await expect.poll(async () => (await getGameState(page))?.isRunning, { timeout: 5000 }).toBe(true);
}

test.describe('Hardcore death cause', () => {
  test('a wall crash in Hardcore reports the cause and explains the Arcade difference', async ({ page }) => {
    await startInMode(page, 'Хардкор');
    expect((await getGameState(page)).overReason).toBeNull();

    // The active piece is walked into the right wall: the moves stop being valid, and in Hardcore an
    // invalid sideways move is instant death. 15 presses is far more than the 4 columns needed for
    // any piece, and they happen well inside the level-1 gravity interval.
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');

    await expect
      .poll(async () => (await getGameState(page))?.isGameOver, { timeout: 5000 })
      .toBe(true);

    const state = await getGameState(page);
    expect(state.overReason).toBe('hardcore-wall-crash');
    // The cause is part of the state the renderer draws, and it is mode-consistent.
    expect(state.mode).toBe(1);

    // No console noise: a designed death must not look like a runtime error.
    expect(await getErrors(page)).toHaveLength(0);
    expect(await getWarnings(page)).toHaveLength(0);
  });

  test('the same wall press in Arcade is ignored: no death, no cause', async ({ page }) => {
    await startInMode(page, 'Аркадный');

    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');

    const state = await getGameState(page);
    expect(state.isGameOver).toBe(false);
    expect(state.isRunning).toBe(true);
    expect(state.overReason).toBeNull();
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('restart after a Hardcore death clears the cause', async ({ page }) => {
    await startInMode(page, 'Хардкор');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await getGameState(page))?.isGameOver, { timeout: 5000 }).toBe(true);
    expect((await getGameState(page)).overReason).toBe('hardcore-wall-crash');

    await page.keyboard.press('Enter');
    await expect.poll(async () => (await getGameState(page))?.isRunning, { timeout: 5000 }).toBe(true);
    const state = await getGameState(page);
    expect(state.isGameOver).toBe(false);
    expect(state.overReason).toBeNull();
  });
});
