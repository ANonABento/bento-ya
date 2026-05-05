import { test, expect, type Page } from '@playwright/test'

/**
 * AgentPanel — single-Terminal layout visual audit.
 *
 * After the unified-PTY migration there is exactly one panel view: the live
 * tmux-backed terminal. This test runs against the Vite dev server with
 * browser mocks (no Tauri), so the PTY itself never spawns; we just verify
 * the panel renders, the Terminal label / Stop button are present, and the
 * xterm container mounts.
 */

async function openTaskPanel(page: Page, taskTitle: string) {
  await page.goto('/')
  await page.waitForTimeout(800)

  // Find and click the task card — match by visible title text
  const card = page.getByText(taskTitle).first()
  await expect(card).toBeVisible({ timeout: 10000 })
  await card.click()

  // Side panel should slide in
  await page.waitForTimeout(500)
}

test.describe('AgentPanel — visual audit', () => {
  test('panel opens with Terminal label and Stop button', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    // The Terminal label is text inside the panel header (not a tab anymore)
    await expect(page.getByText('Terminal').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: 'test-results/panel-default.png', fullPage: false })
  })

  test('Output tab is gone (single-view layout)', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    // Ensure neither an Output tab button nor a tab-style toggle exists.
    const outputTab = page.getByRole('button', { name: 'Output' })
    await expect(outputTab).toHaveCount(0)
  })

  test('xterm container renders for any task type', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    // xterm renders into a div with .xterm class once initialized
    const xtermDiv = page.locator('.xterm, [class*="xterm-screen"], canvas').first()
    await expect(xtermDiv).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: 'test-results/panel-terminal-rendered.png', fullPage: false })
  })

  test('Stop button is clickable and does not crash', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    const stopButton = page.getByRole('button', { name: 'Stop' })
    await expect(stopButton).toBeEnabled({ timeout: 5000 })
    await stopButton.click()
    // In browser-mock mode the Tauri invoke is a no-op; we just verify the
    // click doesn't throw and the button re-enables shortly after.
    await page.waitForTimeout(400)
    await expect(stopButton).toBeEnabled()
  })

  test('captures a full-board screenshot for visual review', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/board-full.png', fullPage: true })
  })
})
