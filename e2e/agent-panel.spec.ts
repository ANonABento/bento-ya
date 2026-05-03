import { test, expect, type Page } from '@playwright/test'

/**
 * AgentPanel — Output / Terminal tabs visual audit.
 *
 * Runs against the Vite dev server with browser mocks. Browser mocks won't
 * populate the agent-streaming store (those events come from Tauri), so this
 * test verifies the *empty-state* path and tab switching, NOT live streaming.
 *
 * Live streaming is verified manually via the running app, OR by adding test
 * hooks that prime the zustand store directly (deferred — see follow-up).
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
  test('panel opens with Output/Terminal tabs visible', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    const outputTab = page.getByRole('button', { name: 'Output' })
    const terminalTab = page.getByRole('button', { name: 'Terminal' })

    await expect(outputTab).toBeVisible({ timeout: 5000 })
    await expect(terminalTab).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: 'test-results/panel-default-tab.png', fullPage: false })
  })

  test('default tab for idle task is Terminal (no agent activity)', async ({ page }) => {
    // Sample Task in browser-mock has agentStatus: null → not an agent task
    // → should default to Terminal
    await openTaskPanel(page, 'Sample Task')

    const terminalTab = page.getByRole('button', { name: 'Terminal' })
    const cls = await terminalTab.getAttribute('class')
    expect(cls).toContain('bg-accent')
  })

  test('default tab for running agent task is Output', async ({ page }) => {
    // "Task with CI failure" in browser-mock has agentStatus: 'running'
    // → should default to Output
    await openTaskPanel(page, 'Task with CI failure')

    const outputTab = page.getByRole('button', { name: 'Output' })
    const cls = await outputTab.getAttribute('class')
    expect(cls).toContain('bg-accent')

    await page.screenshot({ path: 'test-results/panel-running-task-output.png', fullPage: false })
  })

  test('clicking Terminal tab switches the active view', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    const outputTab = page.getByRole('button', { name: 'Output' })
    const terminalTab = page.getByRole('button', { name: 'Terminal' })

    await terminalTab.click()
    await page.waitForTimeout(300)

    let cls = await terminalTab.getAttribute('class')
    expect(cls).toContain('bg-accent')

    await page.screenshot({ path: 'test-results/panel-terminal-tab.png', fullPage: false })

    await outputTab.click()
    await page.waitForTimeout(300)
    cls = await outputTab.getAttribute('class')
    expect(cls).toContain('bg-accent')

    await page.screenshot({ path: 'test-results/panel-output-tab.png', fullPage: false })
  })

  test('Output tab shows empty state copy when no streaming data', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    // Click into Output tab explicitly (default would be Terminal for idle task)
    const outputTab = page.getByRole('button', { name: 'Output' })
    await outputTab.click()
    await page.waitForTimeout(300)

    // In browser mock mode, no Tauri events fire → store stays empty
    // → empty-state copy should be visible
    const emptyState = page.locator(
      'text=/Agent starting|No agent has run|No streaming output/',
    )
    await expect(emptyState).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: 'test-results/panel-output-empty.png', fullPage: false })
  })

  test('Terminal tab shows xterm container', async ({ page }) => {
    await openTaskPanel(page, 'Sample Task')

    const terminalTab = page.getByRole('button', { name: 'Terminal' })
    await terminalTab.click()
    await page.waitForTimeout(500)

    // xterm renders into a div with .xterm class once initialized
    const xtermDiv = page.locator('.xterm, [class*="terminal"], canvas').first()
    await expect(xtermDiv).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: 'test-results/panel-terminal-rendered.png', fullPage: false })
  })

  test('captures a full-board screenshot for visual review', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/board-full.png', fullPage: true })
  })
})
