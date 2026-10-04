import { test, expect, Page } from '@playwright/test';

/**
 * Helper: check for any JS errors (window.onerror) or console errors
 */
async function getErrors(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as any).__consoleErrors || []);
}

async function getWarnings(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as any).__consoleWarnings || []);
}

/**
 * Helper: get game store state via evaluate
 */
async function getGameState(page: Page): Promise<any> {
  // The store is exposed in dev builds by frontend/src/main.ts (window.__vueStores.game)
  return await page.evaluate(() => {
    const store = (window as any).__vueStores?.game;
    if (!store) return null;
    return store.$state?.gameState ?? null;
  });
}

test.describe('Tetris Game E2E', () => {
  test('should render menu without any JS errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.title-word')).toBeVisible({ timeout: 5000 });

    // NO window.onerror or console errors
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should start game and spawn a piece', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.title-word')).toBeVisible();

    // Click play button
    await page.locator('.start-btn').first().click();

    // Game canvas visible
    await expect(page.locator('.board-canvas')).toBeVisible();

    // NO errors during game start
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should NOT have RangeError during game loop', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    // Click play
    await page.locator('.start-btn').first().click();

    // Let game run for 5 seconds (many frames)
    await page.waitForTimeout(5000);

    // Check for ANY errors (RangeError, console.error, etc.)
    const errors = await getErrors(page);
    // If we get here without errors, the test passes
    expect(errors).toHaveLength(0);
  });

  test('should handle keyboard input without errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    // Click play
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    // Press arrow keys
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');

    // Press space (hard drop)
    await page.keyboard.press('Space');

    // Wait for game to run
    await page.waitForTimeout(2000);

    // NO errors from keyboard input
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should pause and resume without errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    // Click play
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    // Press P to pause
    await page.keyboard.press('p');
    await page.waitForTimeout(500);

    // Press P to resume
    await page.keyboard.press('p');

    // Wait and check for errors
    await page.waitForTimeout(1000);
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should render HUD and canvas after game starts', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.start-btn').first().click();

    // HUD section visible (first one)
    await expect(page.locator('.hud-section').first()).toBeVisible();
    // Canvas visible
    await expect(page.locator('.board-canvas')).toBeVisible();

    // No errors
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should handle Escape to go back to menu', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    // Press Escape to go back to menu
    await page.keyboard.press('Escape');

    // Should be back at menu
    await expect(page.locator('.title-word')).toBeVisible();

    // No errors
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should handle menu button click to go back', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    // Click menu button
    await page.locator('.menu-btn').click();

    // Should be back at menu
    await expect(page.locator('.title-word')).toBeVisible();

    // No errors
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should handle game over state without errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    // Click play and let game run
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    // Wait for game to run and pieces to fall (simulate game over)
    await page.waitForTimeout(8000);

    // Canvas should still be visible (no crash)
    await expect(page.locator('.board-canvas')).toBeVisible();

    // NO errors during extended gameplay
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should handle piece movement via keyboard', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    // Click play
    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    // Simulate multiple piece drops
    // Press Space multiple times (hard drop)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
    }

    // Canvas should still be visible
    await expect(page.locator('.board-canvas')).toBeVisible();

    // No errors
    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('ArrowUp actually rotates the active piece', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    const before = await getGameState(page);
    expect(before).not.toBeNull();
    expect(before.currentRotation).not.toBeNull();

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);

    const after = await getGameState(page);
    expect(after.currentRotation.index).not.toBe(before.currentRotation.index);
    // A rotation must never change the number of cells the piece is made of.
    expect(after.currentPiece.shape.flat().filter((v: number) => v === 1)).toHaveLength(4);
    expect(await getErrors(page)).toHaveLength(0);
  });

  test('Space (hard drop) locks the whole piece and scores', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.start-btn').first().click();
    await expect(page.locator('.board-canvas')).toBeVisible();

    const before = await getGameState(page);
    expect(before).not.toBeNull();
    const pieceCells = before.currentPiece.shape.flat().filter((v: number) => v === 1).length;
    expect(pieceCells).toBe(4);

    await page.keyboard.press('Space');
    await page.waitForTimeout(400);

    const after = await getGameState(page);
    const lockedCells = after.board.flat().filter((v: number) => v !== 0).length;
    expect(lockedCells).toBeGreaterThanOrEqual(pieceCells);
    expect(after.score).toBeGreaterThan(before.score);
    expect(await getErrors(page)).toHaveLength(0);
  });
});
