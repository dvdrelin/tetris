// MP block C E2E: two real browsers (two contexts) play the room flow against the live
// backend: create → join by code → chat both ways → both ready → the versus view starts
// aligned → surrender → results in both clients → back to the lobby with the results panel.
import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3001'

async function openMenuMp(page: Page, name: string): Promise<void> {
  await page.goto(BASE)
  await page.fill('#player-name', name)
  await page.getByTestId('menu-multiplayer').click()
  await expect(page.getByTestId('mp-code-input')).toBeVisible()
}

test('room lifecycle across two browsers', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    // --- create and join ---
    await openMenuMp(pageA, 'Alice')
    await pageA.getByTestId('mp-create').click()
    await expect(pageA.getByTestId('mp-room-code')).toBeVisible()
    const code = (await pageA.getByTestId('mp-room-code').textContent())!.trim()
    expect(code).toMatch(/^[A-Z0-9]{4}$/)

    await openMenuMp(pageB, 'Bob')
    await pageB.getByTestId('mp-code-input').fill(code.toLowerCase())
    await pageB.getByTestId('mp-join').click()

    await expect(pageA.getByTestId('mp-players')).toContainText('Bob')
    await expect(pageB.getByTestId('mp-players')).toContainText('Alice')
    await expect(pageB.getByTestId('mp-room-code')).toHaveText(code)

    // --- chat both ways (the E2E backend runs with MP_CHAT_COOLDOWN_MS=200) ---
    await pageA.getByTestId('mp-chat-input').fill('привет, бойся')
    await pageA.getByTestId('mp-chat-input').press('Enter')
    await expect(pageB.getByTestId('mp-chat')).toContainText('привет, бойся')
    await pageB.waitForTimeout(300)
    await pageB.getByTestId('mp-chat-input').fill('сам бойся')
    await pageB.getByTestId('mp-chat-input').press('Enter')
    await expect(pageA.getByTestId('mp-chat')).toContainText('сам бойся')

    // --- ready up: the match starts for both when everyone is ready ---
    await pageA.getByTestId('mp-ready').click()
    await pageB.getByTestId('mp-ready').click()

    await expect(pageA.getByTestId('mp-game')).toBeVisible({ timeout: 5000 })
    await expect(pageB.getByTestId('mp-game')).toBeVisible({ timeout: 5000 })
    // Both start on the same aligned countdown (E2E backend: MP_START_DELAY_MS = 6 s).
    await expect(pageA.getByTestId('mp-countdown')).toBeVisible({ timeout: 2000 })
    // When the countdown disappears, the seeded engines are running on both clients.
    await expect(pageA.getByTestId('mp-countdown')).toBeHidden({ timeout: 8000 })

    // --- fast phrase: one tap lands as a toast on the opponent (never on the sender) ---
    await pageA.getByTestId('mp-quick').getByRole('button', { name: 'GG' }).click()
    await expect(pageB.getByTestId('mp-phrase-toast')).toContainText('GG', { timeout: 4000 })
    await expect(pageA.getByTestId('mp-phrase-toast')).toBeHidden()

    // --- Alice surrenders; both screens get the verdict ---
    pageA.on('dialog', (d) => d.accept())
    await pageA.getByTestId('mp-surrender').click()
    await expect(pageA.getByTestId('mp-over')).toBeVisible({ timeout: 4000 })
    await expect(pageB.getByTestId('mp-over')).toBeVisible({ timeout: 4000 })
    await expect(pageA.getByTestId('mp-over')).toContainText('Bob')

    // --- back to the room: the lobby shows the finished-match results ---
    await pageA.getByTestId('mp-to-room').click()
    await expect(pageA.getByTestId('mp-results')).toBeVisible()
    await expect(pageA.getByTestId('mp-results')).toContainText('Bob')
    await pageB.getByTestId('mp-to-room').click()
    await expect(pageB.getByTestId('mp-results')).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('a third browser into the same room is refused (room_full)', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const ctxC = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  const pageC = await ctxC.newPage()
  try {
    await openMenuMp(pageA, 'Alice')
    await pageA.getByTestId('mp-create').click()
    const code = (await pageA.getByTestId('mp-room-code').textContent())!.trim()
    await openMenuMp(pageB, 'Bob')
    await pageB.getByTestId('mp-code-input').fill(code)
    await pageB.getByTestId('mp-join').click()
    await expect(pageA.getByTestId('mp-players')).toContainText('Bob')

    await openMenuMp(pageC, 'Mallory')
    await pageC.getByTestId('mp-code-input').fill(code)
    await pageC.getByTestId('mp-join').click()
    await expect(pageC.getByTestId('mp-error')).toHaveText('Room is full')
  } finally {
    await ctxA.close()
    await ctxB.close()
    await ctxC.close()
  }
})
