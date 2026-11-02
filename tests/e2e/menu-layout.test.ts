// Стартовый экран обязан влезать в окно целиком. Раньше меню было одной колонкой высотой ~1100 px,
// а `body { overflow: hidden }` (App.vue) просто обрезал низ: на ноутбуке с 100 % масштаба кнопки
// «РЕКОРДЫ» и «МУЛЬТИПЛЕЕР» не существовали. Тест проверяет и отсутствие прокрутки, и то, что
// каждый блок помещается в вьюпорт, и раскладку «A сверху, B+D слева, C справа».
import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3001'

const VIEWPORTS: [number, number][] = [
  [1920, 1080],
  [1600, 900],
  [1366, 768],
  [1280, 720],
  [1024, 768],
  [900, 700],
]

const BLOCKS = [
  '.title-word',
  '.mode-selector',
  '#player-name',
  '.start-btn',
  '.leaderboard-btn',
  '[data-testid="menu-multiplayer"]',
  '.controls',
]

async function openMenu(page: Page): Promise<void> {
  await page.goto(BASE)
  await expect(page.getByTestId('menu-multiplayer')).toBeVisible()
}

for (const [width, height] of VIEWPORTS) {
  test(`the menu fits a ${width}x${height} window without scrolling`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height } })
    const page = await ctx.newPage()
    try {
      await openMenu(page)

      const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
      expect(overflow, 'no vertical overflow').toBeLessThanOrEqual(0)

      for (const selector of BLOCKS) {
        const box = await page.locator(selector).first().boundingBox()
        expect(box, `${selector} is laid out`).not.toBeNull()
        expect(box!.y, `${selector} is below the top edge`).toBeGreaterThanOrEqual(0)
        expect(
          box!.y + box!.height,
          `${selector} fits above the bottom edge of a ${height}px window`,
        ).toBeLessThanOrEqual(height + 1)
      }
    } finally {
      await ctx.close()
    }
  })
}

test('wide window: identity on top, вход/выходы in the left half, клавиши in the right half', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  try {
    await openMenu(page)
    const head = await page.locator('.mode-selector').boundingBox()
    const start = await page.locator('.start-btn').boundingBox()
    const secondary = await page.locator('[data-testid="menu-multiplayer"]').boundingBox()
    const controls = await page.locator('.controls').boundingBox()
    const middle = 1440 / 2

    // A: карточки режимов под заголовком и во всю ширину (шире любой из колонок).
    expect(head!.y).toBeLessThan(start!.y)
    // B и D — левая колонка, D под B.
    expect(start!.x + start!.width / 2).toBeLessThan(middle)
    expect(secondary!.x + secondary!.width / 2).toBeLessThan(middle)
    expect(secondary!.y).toBeGreaterThan(start!.y + start!.height)
    // C — правая колонка.
    expect(controls!.x + controls!.width / 2).toBeGreaterThan(middle)
  } finally {
    await ctx.close()
  }
})

test('narrow window: blocks stack in the readable order A → B → D → C', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 760, height: 1024 } })
  const page = await ctx.newPage()
  try {
    await openMenu(page)
    const head = await page.locator('.mode-selector').boundingBox()
    const start = await page.locator('.start-btn').boundingBox()
    const secondary = await page.locator('[data-testid="menu-multiplayer"]').boundingBox()
    const controls = await page.locator('.controls').boundingBox()

    expect(head!.y).toBeLessThan(start!.y)
    expect(start!.y).toBeLessThan(secondary!.y)
    expect(secondary!.y).toBeLessThan(controls!.y)
  } finally {
    await ctx.close()
  }
})
