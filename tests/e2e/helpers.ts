import { Page, expect } from '@playwright/test';

/**
 * Shared E2E helpers.
 *
 * `window.__consoleErrors` / `__consoleWarnings` are filled by frontend/src/main.ts, and
 * `window.__vueStores.game` is exposed by the same file in dev builds only — which is exactly the
 * build the Playwright web server runs.
 */
export async function getErrors(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as any).__consoleErrors || []);
}

export async function getWarnings(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as any).__consoleWarnings || []);
}

export async function getGameState(page: Page): Promise<any> {
  return await page.evaluate(() => {
    const store = (window as any).__vueStores?.game;
    if (!store) return null;
    return store.$state?.gameState ?? null;
  });
}

/** Click the first start button and wait until the engine is running. */
export async function startGame(page: Page): Promise<void> {
  await page.goto('http://localhost:3001');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.start-btn').first().click();
  await expect(page.locator('.board-canvas')).toBeVisible();
  await expect.poll(async () => (await getGameState(page))?.isRunning, { timeout: 5000 }).toBe(true);
}

/** x / y / rotation of the active piece. */
export async function piecePosition(page: Page): Promise<{ x: number; y: number; rotation: number }> {
  const state = await getGameState(page);
  return { x: state.currentPos.x, y: state.currentPos.y, rotation: state.currentRotation.index };
}
