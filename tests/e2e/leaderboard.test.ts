import { test, expect } from '@playwright/test';

async function getErrors(page: any): Promise<string[]> {
  return await page.evaluate(() => (window as any).__consoleErrors || []);
}

test.describe('Leaderboard E2E', () => {
  test('should navigate to leaderboard without any JS errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.title-word')).toBeVisible({ timeout: 5000 });

    await page.locator('.leaderboard-btn').click();
    await expect(page.locator('.leaderboard-container')).toBeVisible();

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should display score table without errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.leaderboard-btn').click();
    await expect(page.locator('.tabs button').first()).toBeVisible();
    await expect(page.locator('.tabs button').last()).toBeVisible();

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should switch tabs without errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.leaderboard-btn').click();
    await page.locator('.tabs button').last().click();
    await expect(page.locator('.leaderboard-table')).toBeVisible();

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });

  test('should go back to menu without errors', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.leaderboard-btn').click();
    await page.locator('.back-btn').click();
    await expect(page.locator('.title-word')).toBeVisible();

    const errors = await getErrors(page);
    expect(errors).toHaveLength(0);
  });
});
