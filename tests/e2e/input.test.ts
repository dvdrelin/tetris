import { test, expect } from '@playwright/test';
import { getErrors, getGameState, piecePosition, startGame } from './helpers';

/**
 * E2E for the input layer (B2/B3).
 *
 * Playwright's `keyboard.down()` sends exactly one keydown — the browser never adds the operating
 * system's auto-repeat — so every repeated move seen in these tests can only come from the game's
 * own DAS/ARR controller.
 */

test.describe('Keyboard DAS / ARR (B2)', () => {
  test('one tap moves the piece exactly one column', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);

    await page.keyboard.press('ArrowRight');
    const after = await piecePosition(page);

    expect(after.x).toBe(before.x + 1);
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('holding the key repeats the move (DAS 167 ms, then ARR 33 ms)', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(400);
    const held = await piecePosition(page);
    await page.keyboard.up('ArrowRight');

    // A single press would be +1. Four hundred milliseconds of holding is 1 press plus
    // repeats starting at 167 ms: the piece travels several columns instead of one.
    expect(held.x - before.x).toBeGreaterThanOrEqual(2);
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('keyup stops the auto-repeat', async ({ page }) => {
    await startGame(page);

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(250);
    await page.keyboard.up('ArrowRight');
    const afterRelease = await piecePosition(page);

    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(200);
      const sample = await piecePosition(page);
      expect(sample.x).toBe(afterRelease.x);
    }
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('a synthetic keydown with e.repeat = true is ignored', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);

    const delivered = await page.evaluate(() => {
      let count = 0;
      const listener = () => { count++; };
      document.addEventListener('keydown', listener);
      for (let i = 0; i < 8; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', repeat: true }));
      }
      document.removeEventListener('keydown', listener);
      return count;
    });
    expect(delivered).toBe(8); // the events really did reach the document

    const after = await piecePosition(page);
    expect(after.x).toBe(before.x); // but none of them moved the piece

    // The same key without the repeat flag does move it: the listener itself is working.
    await page.keyboard.press('ArrowLeft');
    const tapped = await piecePosition(page);
    expect(tapped.x).toBe(before.x - 1);
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('capital letters and WASD keys still work', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);

    await page.keyboard.press('KeyD');
    const afterD = await piecePosition(page);
    expect(afterD.x).toBe(before.x + 1);

    await page.keyboard.press('KeyA');
    const afterA = await piecePosition(page);
    expect(afterA.x).toBe(before.x);

    const rotationBefore = (await piecePosition(page)).rotation;
    await page.keyboard.press('KeyW');
    expect((await piecePosition(page)).rotation).not.toBe(rotationBefore);
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('Ctrl+S is left to the browser and does not soft drop', async ({ page }) => {
    await startGame(page);
    const before = await piecePosition(page);
    const scoreBefore = (await getGameState(page)).score;

    await page.keyboard.press('Control+s');

    const after = await piecePosition(page);
    expect(after.y).toBe(before.y);
    expect((await getGameState(page)).score).toBe(scoreBefore);
    expect(await getErrors(page)).toHaveLength(0);
  });
});

test.describe('Touch controls (B3)', () => {
  test('no touch controls on a desktop viewport', async ({ page }) => {
    await startGame(page);
    await expect(page.locator('.touch-controls')).toHaveCount(0);
    expect(await getErrors(page)).toHaveLength(0);
  });
});
