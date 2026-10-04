import { test, expect, devices } from '@playwright/test';
import { getErrors, getGameState, piecePosition, startGame } from './helpers';

/**
 * E2E for the touch layer (B3).
 *
 * The iPhone 13 device profile is used without its `defaultBrowserType`, because tests/e2e runs in
 * the single chromium project of tests/playwright.config.ts and `test.use` may not switch browser.
 */
const phoneProfile = { ...devices['iPhone 13'] };
delete (phoneProfile as { defaultBrowserType?: string }).defaultBrowserType;
test.use(phoneProfile);

test.describe('Touch controls on a phone profile (B3)', () => {
  test('the phone profile gets touch controls and reports a coarse pointer', async ({ page }) => {
    await startGame(page);
    const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    expect(coarse).toBe(true);

    await expect(page.locator('.touch-controls')).toBeVisible();
    await expect(page.locator('[data-touch="left"]')).toBeVisible();
    await expect(page.locator('[data-touch="right"]')).toBeVisible();
    await expect(page.locator('[data-touch="softDrop"]')).toBeVisible();
    await expect(page.locator('[data-touch="rotateCW"]')).toBeVisible();
    await expect(page.locator('[data-touch="rotateCCW"]')).toBeVisible();
    await expect(page.locator('[data-touch="rotate180"]')).toBeVisible();
    await expect(page.locator('[data-touch="hold"]')).toBeVisible();
    await expect(page.locator('[data-touch="hardDrop"]')).toBeVisible();
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('tapping the buttons moves, rotates and hard drops the piece', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);

    await page.tap('[data-touch="left"]');
    expect((await piecePosition(page)).x).toBe(before.x - 1);

    await page.tap('[data-touch="rotateCW"]');
    expect((await piecePosition(page)).rotation).not.toBe(before.rotation);

    const scoreBefore = (await getGameState(page)).score;
    await page.tap('[data-touch="hardDrop"]');
    const after = await getGameState(page);
    expect(after.score).toBeGreaterThan(scoreBefore);
    expect(after.currentPos.y).toBe(0); // the piece locked and a new one spawned

    expect(await getErrors(page)).toHaveLength(0);
  });

  test('hold and 180 rotation work from the buttons', async ({ page }) => {
    await startGame(page);
    const before = await getGameState(page);
    expect(before.holdType).toBeNull();
    expect(before.canHold).toBe(true);

    await page.tap('[data-touch="hold"]');
    const afterHold = await getGameState(page);
    expect(afterHold.holdType).not.toBeNull();
    expect(afterHold.canHold).toBe(false);

    const rotationBefore = (await piecePosition(page)).rotation;
    await page.tap('[data-touch="rotate180"]');
    expect((await piecePosition(page)).rotation).not.toBe(rotationBefore);

    expect(await getErrors(page)).toHaveLength(0);
  });

  test('holding a touch button repeats the move with the same DAS / ARR', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);

    const right = page.locator('[data-touch="right"]');
    await right.dispatchEvent('pointerdown');
    await page.waitForTimeout(400);
    const held = await piecePosition(page);
    await right.dispatchEvent('pointerup');

    expect(held.x - before.x).toBeGreaterThanOrEqual(2);

    // Once the finger leaves the button the repeats stop.
    const released = await piecePosition(page);
    await page.waitForTimeout(300);
    expect((await piecePosition(page)).x).toBe(released.x);
    expect(await getErrors(page)).toHaveLength(0);
  });
});
