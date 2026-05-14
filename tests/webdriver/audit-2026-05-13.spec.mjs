/**
 * UI audit screenshot spec — captures every major surface for a structured
 * visual review. Writes PNGs to docs/screenshots/audit-2026-05-13/ and also
 * surfaces basic interaction-smoke + a11y findings via console output.
 *
 * Run:
 *   npm run test:webdriver -- --spec ./tests/webdriver/audit-2026-05-13.spec.mjs
 *
 * Prereqs (see CLAUDE.md > "WebDriver E2E Testing"):
 *   - Vite on :1420
 *   - tauri-driver --port 4444 with KAITENCODE_DATA_DIR=/tmp/kaitencode-wdio
 *   - Webdriver-feature binary at target/debug/kaitencode
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const OUT_DIR = './docs/screenshots/audit-2026-05-13'
const FINDINGS_PATH = path.join(OUT_DIR, '_findings.json')

const findings = {
  shots: [],
  ariaIssues: [],
  consoleLogs: [],
  interactionNotes: [],
}

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

async function snap(name, note = '') {
  const file = path.join(OUT_DIR, `${name}.png`)
  await browser.saveScreenshot(file)
  findings.shots.push({ name, file, note })
  console.log(`[audit] snap → ${file}${note ? ` (${note})` : ''}`)
}

async function scanIconButtonsForAriaLabel() {
  // Heuristic: any <button> whose direct text content is empty (only icon
  // children) must have either aria-label, aria-labelledby, or title.
  const issues = await browser.execute(() => {
    const out = []
    const buttons = Array.from(document.querySelectorAll('button'))
    buttons.forEach((b, i) => {
      // Skip hidden buttons
      const rect = b.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const text = (b.textContent || '').trim()
      const hasLabel =
        b.hasAttribute('aria-label') ||
        b.hasAttribute('aria-labelledby') ||
        b.hasAttribute('title')
      if (!text && !hasLabel) {
        const cls = (b.className || '').toString().slice(0, 80)
        const dataTestId = b.getAttribute('data-testid') || ''
        out.push({ index: i, class: cls, testid: dataTestId, rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}` })
      }
    })
    return out
  })
  return issues
}

async function clickableSmokeTest(selector) {
  // Returns true if the element is visible and clickable, false otherwise.
  // Does NOT actually click — just verifies presence + dimensions + cursor.
  const exists = await $(selector).isExisting()
  if (!exists) return { selector, exists: false }
  const el = await $(selector)
  const display = await el.isDisplayed()
  const size = await el.getSize()
  return { selector, exists, displayed: display, size }
}

// JS click that bypasses the OS titlebar interception issue WebKitGTK exhibits
// for buttons near y < 32 (the system chrome zone).
async function jsClick(selector) {
  return browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { ok: false, reason: 'not-found' }
    el.click()
    return { ok: true }
  }, selector)
}

async function jsClickXPath(predicate) {
  // predicate is a function-body string that runs in-page and returns the element to click
  return browser.execute(`
    try {
      const fn = function() { ${predicate} };
      const el = fn();
      if (!el) return { ok: false, reason: 'not-found' };
      el.click();
      return { ok: true };
    } catch (e) { return { ok: false, reason: String(e) } }
  `)
}

async function jsClickByText(label) {
  return browser.execute((text) => {
    const all = Array.from(document.querySelectorAll('button'))
    const btn = all.find((b) => {
      const t = (b.textContent || '').trim()
      return t === text
    })
    if (!btn) return { ok: false, reason: 'not-found' }
    btn.click()
    return { ok: true }
  }, label)
}

describe('UI Audit 2026-05-13', () => {
  before(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true })
    await browser.pause(2000)

    // Seed demo data if needed
    const wsResult = await tauriInvoke(browser, 'list_workspaces')
    if (!wsResult.ok || wsResult.data.length === 0) {
      await tauriInvoke(browser, 'seed_demo_data', { repoPath: '/tmp/e2e-demo-repo' })
      await browser.pause(1500)
      await browser.refresh()
      await browser.pause(2000)
    }
    // Resize to a known viewport so screenshots are reproducible
    try { await browser.setWindowSize(1440, 900) } catch (e) { /* WebKit may reject */ }
    await browser.pause(800)
  })

  after(async () => {
    await fs.writeFile(FINDINGS_PATH, JSON.stringify(findings, null, 2))
    console.log(`[audit] findings → ${FINDINGS_PATH}`)
    console.log(`[audit] ${findings.shots.length} screenshots, ${findings.ariaIssues.length} aria issues, ${findings.interactionNotes.length} interaction notes`)
  })

  it('01 — kanban board (default state)', async () => {
    await snap('01-board')
    findings.ariaIssues.push({ surface: 'board', items: await scanIconButtonsForAriaLabel() })
  })

  it('02 — board with task card hovered (quick-actions)', async () => {
    const firstCard = await $('[data-task-id]')
    if (await firstCard.isExisting()) {
      // moveTo to trigger hover-only quick actions
      try {
        await firstCard.moveTo()
        await browser.pause(400)
        await snap('02-card-hover', 'first card hover')
      } catch (e) {
        findings.interactionNotes.push({ surface: 'board', note: `moveTo failed: ${e.message}` })
      }
    } else {
      findings.interactionNotes.push({ surface: 'board', note: 'no [data-task-id] cards rendered after seed' })
    }
  })

  it('03 — open task detail panel (Transcript tab default)', async () => {
    const firstCard = await $('[data-task-id]')
    if (!(await firstCard.isExisting())) {
      findings.interactionNotes.push({ surface: 'task-detail', note: 'no card to open' })
      return
    }
    await firstCard.click()
    // Panel mounts lazily — wait
    await browser.waitUntil(async () => (await $('[data-testid="agent-panel"]')).isExisting(), {
      timeout: 6000,
      timeoutMsg: 'agent panel did not mount',
    }).catch(() => {})
    await browser.pause(1200)
    await snap('03-task-detail-transcript')
    findings.ariaIssues.push({ surface: 'task-detail-transcript', items: await scanIconButtonsForAriaLabel() })
  })

  it('04 — task detail panel (Terminal tab)', async () => {
    const termTab = await $('[data-testid="agent-panel-tab-terminal"]')
    if (await termTab.isExisting()) {
      await termTab.click()
      await browser.pause(1200)
      await snap('04-task-detail-terminal')
    } else {
      findings.interactionNotes.push({ surface: 'task-detail-terminal', note: 'terminal tab missing' })
    }
  })

  it('05 — close task panel and open Cmd+K command palette', async () => {
    // Close panel by re-clicking the active task card
    const firstCard = await $('[data-task-id]')
    if (await firstCard.isExisting()) {
      await firstCard.click()
      await browser.pause(500)
    }
    // Trigger command palette via Meta+K
    await browser.keys(['Meta', 'k'])
    await browser.pause(700)
    const paletteOpen = await $('input[aria-label="Search commands"]').isExisting()
    if (!paletteOpen) {
      findings.interactionNotes.push({ surface: 'command-palette', note: 'Meta+K did not open palette; trying Ctrl+K' })
      await browser.keys(['Control', 'k'])
      await browser.pause(700)
    }
    await snap('05-command-palette')
    findings.interactionNotes.push({
      surface: 'command-palette',
      note: `paletteOpen=${await $('input[aria-label="Search commands"]').isExisting()}`,
    })
    // Close palette
    await browser.keys(['Escape'])
    await browser.pause(400)
  })

  // ===== Settings panel — capture all top-level tabs =====
  // Use JS-clicks throughout: the Settings button sits at y≈4, which is in
  // the WebKitGTK "OS chrome" zone — native clicks are intermittently
  // intercepted. JS click bypasses coordinate-based event routing.
  it('06 — settings → Workspace', async () => {
    const res = await jsClick('[aria-label="Settings"]')
    findings.interactionNotes.push({ surface: 'settings.open', note: JSON.stringify(res) })
    await browser.pause(1100)
    await snap('06-settings-workspace', 'opens to Workspace by default')
    findings.ariaIssues.push({ surface: 'settings', items: await scanIconButtonsForAriaLabel() })
  })

  it('07 — settings → Appearance', async () => {
    await jsClickByText('Appearance')
    await browser.pause(700)
    await snap('07-settings-appearance')
  })

  it('08 — settings → Board', async () => {
    await jsClickByText('Board')
    await browser.pause(700)
    await snap('08-settings-board')
  })

  it('09 — settings → Models & Limits', async () => {
    await jsClickByText('Models & Limits')
    await browser.pause(700)
    await snap('09-settings-models-limits')
  })

  it('10 — settings → Voice', async () => {
    await jsClickByText('Voice')
    await browser.pause(700)
    await snap('10-settings-voice')
  })

  it('11 — settings → GitHub', async () => {
    await jsClickByText('GitHub')
    await browser.pause(700)
    await snap('11-settings-github')
  })

  it('12 — settings → MCP Server', async () => {
    await jsClickByText('MCP Server')
    await browser.pause(700)
    await snap('12-settings-mcp')
  })

  it('13 — settings → Batches', async () => {
    await jsClickByText('Batches')
    await browser.pause(700)
    await snap('13-settings-batches')
  })

  it('14 — settings → Advanced (Terminal / Git / Shortcuts stacked)', async () => {
    await jsClickByText('Advanced')
    await browser.pause(800)
    await snap('14-settings-advanced')
  })

  it('15 — settings → Updates', async () => {
    await jsClickByText('Updates')
    await browser.pause(700)
    await snap('15-settings-updates')
  })

  it('16 — close settings (interaction: dedicated close button)', async () => {
    const res = await jsClick('[title="Close settings"]')
    findings.interactionNotes.push({ surface: 'settings.close', note: JSON.stringify(res) })
    await browser.pause(900)
    // Also: verify Escape does NOT close settings (matches the comment in
    // screenshots.spec.mjs) — open it again, hit Escape, expect still open.
    await jsClick('[aria-label="Settings"]')
    await browser.pause(700)
    await browser.keys(['Escape'])
    await browser.pause(500)
    const stillOpen = await browser.execute(() =>
      Boolean(document.querySelector('[title="Close settings"]')),
    )
    findings.interactionNotes.push({
      surface: 'settings.escape',
      note: `after Escape, settings stillOpen=${stillOpen} (expected false after P1-1 fix)`,
    })
    if (stillOpen) await jsClick('[title="Close settings"]')
    await browser.pause(500)
    await snap('16-after-close')
  })

  // ===== Column config dialog =====
  it('17 — column config → General tab', async () => {
    const res = await jsClick('[aria-label="Configure column"]')
    findings.interactionNotes.push({ surface: 'column-config.open', note: JSON.stringify(res) })
    await browser.pause(900)
    await snap('17-column-config-general')
    findings.ariaIssues.push({ surface: 'column-config', items: await scanIconButtonsForAriaLabel() })
  })

  it('18 — column config → Triggers tab', async () => {
    await jsClickByText('Triggers')
    await browser.pause(700)
    await snap('18-column-config-triggers')
  })

  it('19 — column config → Exit tab', async () => {
    await jsClickByText('Exit')
    await browser.pause(700)
    await snap('19-column-config-exit')
    await browser.keys(['Escape'])
    await browser.pause(500)
  })

  // ===== Empty / responsive cases =====
  it('20 — board narrow viewport (768x900) responsive check', async () => {
    try {
      await browser.setWindowSize(768, 900)
      await browser.pause(800)
      await snap('20-board-narrow-768')
    } catch (e) {
      findings.interactionNotes.push({ surface: 'responsive', note: `setWindowSize failed: ${e.message}` })
    }
  })

  it('21 — settings narrow viewport (mobile-style picker)', async () => {
    // Use JS click — at 768px the Settings button lands under the WebKit
    // titlebar y-range and a normal click is intercepted by the chrome.
    // This is itself an audit finding (logged below).
    const opened = await browser.execute(() => {
      const btn = document.querySelector('[aria-label="Settings"]')
      if (!btn) return false
      btn.click()
      return true
    })
    findings.interactionNotes.push({
      surface: 'settings.narrow',
      note: `JS-click on Settings opened=${opened}; native click was intercepted by OS titlebar at 768px width`,
    })
    await browser.pause(900)
    await snap('21-settings-narrow-768')
    const closeBtn = await $('[title="Close settings"]')
    if (await closeBtn.isExisting()) {
      try { await closeBtn.click() } catch (e) {
        await browser.execute(() => document.querySelector('[title="Close settings"]')?.click())
      }
      await browser.pause(500)
    }
    try { await browser.setWindowSize(1440, 900) } catch (e) {}
    await browser.pause(500)
  })

  it('22 — keyboard focus + tab navigation', async () => {
    // Tab through ~10 elements and snap focus rings
    for (let i = 0; i < 10; i++) {
      await browser.keys(['Tab'])
      await browser.pause(80)
    }
    await snap('22-tab-focus-state', 'after 10 Tabs from board')
    const active = await browser.execute(() => {
      const el = document.activeElement
      if (!el) return null
      return {
        tag: el.tagName,
        ariaLabel: el.getAttribute('aria-label'),
        text: (el.textContent || '').trim().slice(0, 60),
        outline: getComputedStyle(el).outline,
      }
    })
    findings.interactionNotes.push({ surface: 'focus', note: `after 10 tabs: ${JSON.stringify(active)}` })
  })

  // ===== Console scrape =====
  it('23 — capture console errors via browser logs (WebKit best-effort)', async () => {
    let logs = []
    try {
      logs = await browser.getLogs('browser')
    } catch (e) {
      // WebKit does not implement /log in WebDriver. Try injecting a sniffer
      // instead — too late to capture earlier errors, but useful for next run.
      findings.consoleLogs.push({ note: `getLogs not supported by WebKit: ${e.message}` })
    }
    if (Array.isArray(logs)) {
      const errors = logs.filter(l => /SEVERE|error/i.test(l.level || ''))
      findings.consoleLogs.push({ total: logs.length, errors: errors.slice(0, 20) })
    }
  })
})
