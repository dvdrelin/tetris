import { test, expect } from '@playwright/test';
import { getErrors, getGameState, startGame } from './helpers';

/**
 * Block 6 UI E2E: C2 (one pause button driven by isPaused), C3 (menu and HUD render the same
 * CONTROL_HINTS list) and C5 (leaving the play stops the engine).
 */
test.describe('Pause button (C2)', () => {
  test('one button, driven by isPaused: ⏸ while playing, ▶ while paused', async ({ page }) => {
    await startGame(page);

    const btn = page.locator('.pause-btn');
    await expect(btn).toHaveCount(1);
    await expect(btn).toHaveText('⏸');

    await btn.click();
    await expect.poll(async () => (await getGameState(page))?.isPaused, { timeout: 3000 }).toBe(true);
    await expect(btn).toHaveCount(1);
    await expect(btn).toHaveText('▶');

    // The same button resumes: no second, unreachable button any more.
    await btn.click();
    await expect.poll(async () => (await getGameState(page))?.isPaused, { timeout: 3000 }).toBe(false);
    await expect(btn).toHaveText('⏸');

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('the `P` key and the button stay in sync', async ({ page }) => {
    await startGame(page);
    const btn = page.locator('.pause-btn');

    await page.keyboard.press('p');
    await expect.poll(async () => (await getGameState(page))?.isPaused, { timeout: 3000 }).toBe(true);
    await expect(btn).toHaveText('▶');

    // Escape unpauses first (C7 behaviour, unchanged) and the button follows.
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await getGameState(page))?.isPaused, { timeout: 3000 }).toBe(false);
    await expect(btn).toHaveText('⏸');
    await expect(page.locator('.board-canvas')).toBeVisible();
  });
});

test.describe('App version chip', () => {
  test('the menu shows the 2.{YY}.{MM}.{hash} version in the top right corner', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    const chip = page.getByTestId('app-version');
    await expect(chip).toBeVisible();
    // vite stamps scripts/app-version.cjs into the bundle: major 2 (MP MVP), YY, MM, git hash.
    await expect(chip).toHaveText(/^2\.\d{2}\.\d{2}\.[0-9a-f]{7,}$/);
  });
});

test.describe('Shared control hints (C3)', () => {
  test('the menu and the HUD list the same keys and labels', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    const menuHints = await page.locator('.controls .control-row').allTextContents();
    expect(menuHints.length).toBeGreaterThan(5);
    // The old menu promised "↑ / ↓ — Вращение / Сброс", which the input layer does not do.
    expect(menuHints.join('|')).not.toContain('Вращение / Сброс');

    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    const hudHints = await page.locator('.controls-section .control-item').allTextContents();
    // Compare key+label pairs with all whitespace removed: the menu and the HUD mark the key in a
    // different inline structure, and that spacing is presentation, not content.
    const normalize = (list: string[]) => list.map((t) => t.replace(/\s+/g, ''));
    expect(normalize(hudHints)).toEqual(normalize(menuHints));
  });
});

test.describe('Abandoned game (C5)', () => {
  test('leaving with Escape stops the engine — the store reports isRunning false', async ({ page }) => {
    await startGame(page);
    expect((await getGameState(page))?.isRunning).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.title-word')).toBeVisible();

    const state = await getGameState(page);
    expect(state?.isRunning).toBe(false);
    expect(state?.isGameOver).toBe(false);

    // Starting again works from a stopped engine.
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();
    await expect.poll(async () => (await getGameState(page))?.isRunning, { timeout: 5000 }).toBe(true);

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });
});
