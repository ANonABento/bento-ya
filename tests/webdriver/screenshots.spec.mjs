/**
 * Screenshot capture spec — generates README assets at `docs/screenshots/`.
 *
 * Not a regression test. Run via:
 *   npm run test:webdriver -- --spec ./tests/webdriver/screenshots.spec.mjs
 *
 * Each scenario navigates to a different surface and snaps the viewport.
 * Uses the same seeded `/tmp/kaitencode-wdio` fixture as the other specs.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const OUT_DIR = './docs/screenshots'

async function tauriInvoke(browser, cmd, args = {}) {
  return browser.executeAsync(
    (command, commandArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(command, commandArgs)
        .then(result => done({ ok: true, data: result }))
        .catch(err => done({ ok: false, error: String(err) }))
    },
    cmd,
    args,
  )
}

describe('Screenshots', () => {
  before(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true })
    await browser.pause(2000)

    // Seed demo data if no workspace exists yet, then reload so React re-fetches
    const wsResult = await tauriInvoke(browser, 'list_workspaces')
    if (!wsResult.ok || wsResult.data.length === 0) {
      await tauriInvoke(browser, 'seed_demo_data', { repoPath: '/tmp/e2e-demo-repo' })
      await browser.pause(1500)
      await browser.refresh()
      await browser.pause(2000)
    }
  })

  it('captures the kanban board', async () => {
    await browser.pause(500)
    await browser.saveScreenshot(path.join(OUT_DIR, 'board.png'))
  })

  it('captures the settings panel', async () => {
    const settingsBtn = await $('[aria-label="Settings"]')
    await settingsBtn.click()
    await browser.pause(800)
    await browser.saveScreenshot(path.join(OUT_DIR, 'settings.png'))
    // Settings panel has no Escape handler — click its dedicated close button
    const closeBtn = await $('[title="Close settings"]')
    await closeBtn.click()
    await browser.pause(500)
  })

  it('captures task detail with terminal', async () => {
    const firstCard = await $('[data-task-id]')
    await firstCard.click()
    // Terminal mounts lazily on panel open — give xterm time to render
    await browser.pause(1500)
    await browser.saveScreenshot(path.join(OUT_DIR, 'task-detail.png'))
    // Re-click the same card to collapse, or click the board to deselect
    await firstCard.click()
    await browser.pause(500)
  })

  it('captures column trigger config', async () => {
    const configBtn = await $('[aria-label="Configure column"]')
    await configBtn.click()
    await browser.pause(800)
    // Click into the Triggers tab — General is the default
    const triggersTab = await browser.$('//button[normalize-space(text())="Triggers"]')
    await triggersTab.click()
    await browser.pause(500)
    await browser.saveScreenshot(path.join(OUT_DIR, 'column-triggers.png'))
    await browser.keys(['Escape'])
    await browser.pause(400)
  })
})
