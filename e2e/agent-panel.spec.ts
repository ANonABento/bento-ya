import { test, expect, type Page } from '@playwright/test'

/**
 * AgentPanel — Transcript/Terminal layout visual audit.
 *
 * These tests run against the Vite dev server with browser mocks. The primary
 * surface should be the semantic Transcript tab; Terminal remains the raw
 * xterm/tmux inspection view.
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
  test('panel opens on semantic Transcript with folded tool rows', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    await expect(page.getByRole('button', { name: 'Transcript' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Terminal').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /run.*Working.*claude/ })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /Read.*completed/ })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /Bash.*completed/ })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('git status --short')).toHaveCount(0)

    await page.screenshot({ path: 'test-results/panel-default.png', fullPage: false })
  })

  test('Output tab is gone', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    // Ensure neither an Output tab button nor a tab-style toggle exists.
    const outputTab = page.getByRole('button', { name: 'Output' })
    await expect(outputTab).toHaveCount(0)
  })

  test('xterm container renders for any task type', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    await page.getByRole('button', { name: 'Terminal' }).click()

    // xterm renders into a div with .xterm class once initialized
    const xtermDiv = page.locator('.xterm, [class*="xterm-screen"], canvas').first()
    await expect(xtermDiv).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Spawning terminal')).toHaveCount(0, { timeout: 5000 })

    await page.screenshot({ path: 'test-results/panel-terminal-rendered.png', fullPage: false })
  })

  test('Stop button is disabled while idle', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    const stopButton = page.getByRole('button', { name: 'Stop' })
    await expect(stopButton).toBeDisabled({ timeout: 5000 })
  })

  test('captures a full-board screenshot for visual review', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/board-full.png', fullPage: true })
  })
})
