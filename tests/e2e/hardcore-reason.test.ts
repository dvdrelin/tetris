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
  test('walking to the right wall with discrete presses: Hardcore no longer dies there', async ({ page }) => {
    await startInMode(page, 'Хардкор');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');

    const state = await getGameState(page);
    expect(state.isGameOver).toBe(false); // A13: the side wall is safe in both modes
    expect(state.isRunning).toBe(true);
    expect(state.overReason).toBeNull();
    expect(state.mode).toBe(1);
    expect(state.currentPos.x).toBeGreaterThan(0); // the piece really travelled to the wall
    expect(await getErrors(page)).toEqual([]);
    expect(await getWarnings(page)).toEqual([]);
  });

  test('holding the key against the wall cannot kill and leaves no cause', async ({ page }) => {
    await startInMode(page, 'Хардкор');
    // Playwright's `keyboard.down` emits browser auto-repeat keydowns; the app ignores `e.repeat`
    // (B2) and runs its own DAS/ARR, so the same MovePiece reaches the engine either way. This is the
    // exact prod symptom that used to end the run with score 0: a held key against the wall.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(900);
    const held = await getGameState(page);
    expect(held.isGameOver).toBe(false);
    expect(held.isRunning).toBe(true);
    expect(held.overReason).toBeNull();
    expect(held.currentPos.x).toBeGreaterThan(0);
    await page.keyboard.up('ArrowRight');

    // Stepping away and pressing fresh is equally safe: the wall never stops the game.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = await getGameState(page);
    expect(after.isGameOver).toBe(false);
    expect(after.overReason).toBeNull();
    expect(await getErrors(page)).toEqual([]);
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

  test('restart after a Hardcore stack crash clears the cause', async ({ page }) => {
    // The wall no longer kills, so the death has to come from the stack. Build a two-level ledge:
    // three pieces hard-dropped against the right wall, then two a column and a half to the left.
    // The next piece then walks sideways into the side of the tall column — a real crash. (Piece
    // types are bag-random, so the push counts are generous: every piece ends flush at the wall.)
    // Every press must be awaited: an un-awaited ArrowRight can land *after* the following hard
    // drop, and the "ledge" ends up in the middle of the board instead of against the wall.
    await startInMode(page, 'Хардкор');
    const press = async (key: string) => {
      await page.keyboard.press(key);
    };

    // One attempt: build the ledge, then walk a fresh piece sideways while it descends; the moment
    // one of its cells targets a locked cell, the engine ends the run and reports the cause.
    const crashAttempt = async (): Promise<string | null> => {
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 8; k++) await press('ArrowRight');
        await press('Space');
      }
      for (let i = 0; i < 2; i++) {
        for (let k = 0; k < 5; k++) await press('ArrowRight');
        await press('Space');
      }
      let over: boolean | undefined;
      for (let attempt = 0; attempt < 3 && over !== true; attempt++) {
        for (let row = 0; row < 18 && over !== true; row++) {
          await press('ArrowDown');
          for (let k = 0; k < 3 && over !== true; k++) {
            await press('ArrowRight');
            over = (await getGameState(page))?.isGameOver;
          }
        }
        if (over !== true) await press('Space');
      }
      expect(over).toBe(true);
      return (await getGameState(page)).overReason;
    };

    // Bag-random luck decides whether this ledge kills the piece sideways (the crash we came for)
    // or just lets the stack reach the top (block-out). Retried like a mulligan: a block-out bag
    // gets a restart and a fresh build, until the crash cause shows up.
    let reason: string | null = null;
    for (let bag = 0; bag < 5 && reason !== 'hardcore-wall-crash'; bag++) {
      if (bag > 0) {
        await page.keyboard.press('Enter');
        await expect
          .poll(async () => (await getGameState(page))?.isRunning, { timeout: 5000 })
          .toBe(true);
      }
      reason = await crashAttempt();
      if (reason !== 'hardcore-wall-crash' && reason !== 'block-out') {
        throw new Error(`unexpected death cause: ${reason}`);
      }
    }
    expect(reason).toBe('hardcore-wall-crash');

    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await getGameState(page))?.isRunning, { timeout: 5000 })
      .toBe(true);
    const state = await getGameState(page);
    expect(state.isGameOver).toBe(false);
    expect(state.overReason).toBeNull();
    expect(await getErrors(page)).toEqual([]);
  });
});
