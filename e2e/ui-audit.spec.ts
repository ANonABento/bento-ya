import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'

/**
 * UI audit — drives the key surfaces (board, orchestrator panel tabs, agent
 * panel tabs, settings) against the Vite dev server (browser-mock data) and
 * captures screenshots for a visual review of spacing / alignment / icons.
 * Not an assertion suite; it's for eyeballing the nicknacks.
 */

const DIR = 'e2e/audit-screens'
mkdirSync(DIR, { recursive: true })

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false })
}

test('capture UI surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await page.waitForTimeout(1200)
  await shot(page, '01-board')

  // Orchestrator / chef panel — expand if collapsed, then each tab.
  const expand = page.locator('[aria-label="Expand orchestrator panel"]')
  if (await expand.count()) {
    await expand.first().click().catch(() => {})
    await page.waitForTimeout(600)
  }
  await shot(page, '02-orchestrator-default')

  for (const view of ['chat', 'terminal', 'files']) {
    const tab = page.locator(`[data-testid="orchestrator-view-${view}"]`)
    if (await tab.count()) {
      await tab.first().click().catch(() => {})
      await page.waitForTimeout(700)
      await shot(page, `03-orchestrator-${view}`)
    }
  }

  // Detail clip of the chef tab header (sidebar-icon row + Chat/Terminal/Files).
  await page.screenshot({ path: `${DIR}/02b-chef-header.png`, clip: { x: 0, y: 700, width: 700, height: 70 } })

  // Open a task → agent panel, capture each tab.
  const card = page.getByText('Revamp agent panel UX').first()
  if (await card.count()) {
    await card.click().catch(() => {})
    await page.waitForTimeout(900)
    await shot(page, '04-agent-panel-open')
    // Detail clip of the agent panel header tabs.
    await page.screenshot({ path: `${DIR}/04b-agent-header.png`, clip: { x: 1000, y: 40, width: 600, height: 60 } })
    for (const t of ['transcript', 'terminal', 'changes', 'files']) {
      const tab = page.locator(`[data-testid="agent-panel-tab-${t}"]`)
      if (await tab.count()) {
        await tab.first().click().catch(() => {})
        await page.waitForTimeout(600)
        await shot(page, `05-agent-${t}`)
      }
    }
  }

  // Settings → Models & Limits (Agent runtime section + segmented controls).
  await page.keyboard.press('Escape').catch(() => {})
  const settings = page.locator('button[title="Settings"]')
  if (await settings.count()) {
    await settings.first().click().catch(() => {})
    await page.waitForTimeout(500)
    const tab = page.locator('button:has-text("Models & Limits")')
    if (await tab.count()) {
      await tab.first().click().catch(() => {})
      await page.waitForTimeout(500)
    }
    await shot(page, '06-settings')
  }
})
