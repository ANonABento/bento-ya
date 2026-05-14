/**
 * UI audit screenshot spec for 2026-05-14.
 *
 * Captures every major surface at three viewports (mobile 375×667,
 * tablet 1024×768, desktop 1440×900 — 1920×1080 is rejected by some
 * WebKitGTK builds so we cap at 1440×900). Drives the regression
 * watchlist from docs/audits/2026-05-14/_plan.md.
 *
 * Output:
 *   docs/audits/2026-05-14/screenshots/wdio/<surface>-<viewport>.png
 *   docs/audits/2026-05-14/_findings_wdio.json
 *
 * Run:
 *   npm run test:webdriver -- --spec ./tests/webdriver/audit-2026-05-14.spec.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const OUT_DIR = './docs/audits/2026-05-14/screenshots/wdio'
const FINDINGS_PATH = './docs/audits/2026-05-14/_findings_wdio.json'

const VIEWPORTS = [
  { tag: 'desktop', w: 1440, h: 900 },
  { tag: 'tablet', w: 1024, h: 768 },
  { tag: 'mobile', w: 375, h: 667 },
]

const findings = {
  shots: [],
  ariaIssues: [],
  consoleLogs: [],
  interactionNotes: [],
  regressionChecks: [],
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

async function setViewport(vp) {
  try {
    await browser.setWindowSize(vp.w, vp.h)
    await browser.pause(500)
    return true
  } catch (e) {
    findings.interactionNotes.push({ surface: 'viewport', note: `setWindowSize ${vp.tag} failed: ${e.message}` })
    return false
  }
}

async function snapAt(surface, viewports = VIEWPORTS, note = '') {
  for (const vp of viewports) {
    const ok = await setViewport(vp)
    if (!ok) continue
    await browser.pause(400)
    await snap(`${surface}-${vp.tag}`, note ? `${note} @${vp.tag}` : `@${vp.tag}`)
  }
}

async function scanIconButtonsForAriaLabel() {
  const issues = await browser.execute(() => {
    const out = []
    const buttons = Array.from(document.querySelectorAll('button'))
    buttons.forEach((b, i) => {
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
        out.push({
          index: i,
          class: cls,
          testid: dataTestId,
          rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        })
      }
    })
    return out
  })
  return issues
}

async function jsClick(selector) {
  return browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { ok: false, reason: 'not-found' }
    el.click()
    return { ok: true }
  }, selector)
}

async function jsClickByText(label, tag = 'button') {
  return browser.execute(
    (text, tagName) => {
      const all = Array.from(document.querySelectorAll(tagName))
      const btn = all.find((b) => (b.textContent || '').trim() === text)
      if (!btn) return { ok: false, reason: 'not-found' }
      btn.click()
      return { ok: true }
    },
    label,
    tag,
  )
}

async function pressEscape() {
  await browser.keys(['Escape'])
  await browser.pause(300)
}

async function safeClose(selector) {
  const closeBtn = await $(selector)
  if (await closeBtn.isExisting()) {
    try {
      await closeBtn.click()
    } catch (e) {
      await jsClick(selector)
    }
    await browser.pause(400)
  }
}

describe('UI Audit 2026-05-14', () => {
  before(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true })
    await browser.pause(2000)

    // Seed demo data if empty
    const wsResult = await tauriInvoke(browser, 'list_workspaces')
    if (!wsResult.ok || wsResult.data.length === 0) {
      await tauriInvoke(browser, 'seed_demo_data', { repoPath: '/tmp/e2e-demo-repo-audit-0514' })
      await browser.pause(1500)
      await browser.refresh()
      await browser.pause(2000)
    }
    await setViewport(VIEWPORTS[0])  // start desktop
    await browser.pause(800)
  })

  after(async () => {
    await fs.writeFile(FINDINGS_PATH, JSON.stringify(findings, null, 2))
    console.log(`[audit] findings → ${FINDINGS_PATH}`)
    console.log(
      `[audit] ${findings.shots.length} screenshots, ${findings.ariaIssues.length} aria scans, ${findings.interactionNotes.length} notes, ${findings.regressionChecks.length} regression checks`,
    )
  })

  // ─── Board surfaces ───────────────────────────────────────────────

  it('board-default at all viewports', async () => {
    await snapAt('board-default')
    findings.ariaIssues.push({ surface: 'board-default', items: await scanIconButtonsForAriaLabel() })
  })

  it('board-card-hover (desktop only — hover doesn\'t make sense on mobile)', async () => {
    await setViewport(VIEWPORTS[0])
    const firstCard = await $('[data-task-id]')
    if (await firstCard.isExisting()) {
      try {
        await firstCard.moveTo()
        await browser.pause(400)
        await snap('board-card-hover-desktop', 'first card hover quick-actions')
      } catch (e) {
        findings.interactionNotes.push({ surface: 'card-hover', note: `moveTo failed: ${e.message}` })
      }
    } else {
      findings.interactionNotes.push({ surface: 'card-hover', note: 'no [data-task-id] cards rendered' })
    }
  })

  it('task-card-expanded at all viewports', async () => {
    // Click first card to expand
    const firstCard = await $('[data-task-id]')
    if (!(await firstCard.isExisting())) {
      findings.interactionNotes.push({ surface: 'task-card-expanded', note: 'no card to expand' })
      return
    }
    await firstCard.click()
    await browser.pause(1200)
    await snapAt('task-card-expanded')
    findings.ariaIssues.push({ surface: 'task-card-expanded', items: await scanIconButtonsForAriaLabel() })
    // Close panel by re-clicking
    await firstCard.click()
    await browser.pause(500)
  })

  // ─── Agent panel (transcript + terminal) ──────────────────────────

  it('agent-panel-transcript at all viewports', async () => {
    const firstCard = await $('[data-task-id]')
    if (!(await firstCard.isExisting())) return
    await firstCard.click()
    await browser.waitUntil(
      async () => (await $('[data-testid="agent-panel"]')).isExisting(),
      { timeout: 6000, timeoutMsg: 'agent panel did not mount' },
    ).catch(() => {})
    await browser.pause(1200)
    await snapAt('agent-panel-transcript')
    findings.ariaIssues.push({ surface: 'agent-panel-transcript', items: await scanIconButtonsForAriaLabel() })
  })

  it('agent-panel-terminal at all viewports', async () => {
    const termTab = await $('[data-testid="agent-panel-tab-terminal"]')
    if (!(await termTab.isExisting())) {
      findings.interactionNotes.push({ surface: 'agent-panel-terminal', note: 'terminal tab missing' })
      return
    }
    await termTab.click()
    await browser.pause(1200)
    await snapAt('agent-panel-terminal')

    // Close panel: re-click first card
    const firstCard = await $('[data-task-id]')
    if (await firstCard.isExisting()) {
      await firstCard.click()
      await browser.pause(500)
    }
  })

  // ─── Command palette ──────────────────────────────────────────────

  it('command-palette at all viewports', async () => {
    for (const vp of VIEWPORTS) {
      await setViewport(vp)
      await browser.keys(['Meta', 'k'])
      await browser.pause(700)
      let paletteOpen = await $('input[aria-label="Search commands"]').isExisting()
      if (!paletteOpen) {
        await browser.keys(['Control', 'k'])
        await browser.pause(700)
        paletteOpen = await $('input[aria-label="Search commands"]').isExisting()
      }
      await snap(`command-palette-${vp.tag}`, `paletteOpen=${paletteOpen}`)
      await pressEscape()
    }
  })

  // ─── Settings tabs (full sweep at desktop only; responsive sample at tablet/mobile) ─

  it('settings — all tabs at desktop', async () => {
    await setViewport(VIEWPORTS[0])
    const res = await jsClick('[aria-label="Settings"]')
    findings.interactionNotes.push({ surface: 'settings.open', note: JSON.stringify(res) })
    await browser.pause(1100)
    await snap('settings-workspace-desktop', 'opens to Workspace')
    findings.ariaIssues.push({ surface: 'settings', items: await scanIconButtonsForAriaLabel() })

    const tabs = [
      ['Appearance', 'settings-appearance'],
      ['Board', 'settings-board'],
      ['Models & Limits', 'settings-agent'],
      ['Voice', 'settings-voice'],
      ['GitHub', 'settings-github'],
      ['MCP Server', 'settings-mcp'],
      ['Batches', 'settings-batches'],
      ['Advanced', 'settings-advanced'],
      ['Updates', 'settings-updates'],
    ]
    for (const [label, slug] of tabs) {
      const clickRes = await jsClickByText(label)
      findings.interactionNotes.push({ surface: `${slug}.click`, note: JSON.stringify(clickRes) })
      await browser.pause(700)
      await snap(`${slug}-desktop`)
    }
    // Close settings via dedicated close button
    await jsClick('[title="Close settings"]')
    await browser.pause(700)
  })

  it('settings — workspace tab at tablet + mobile (responsive sample)', async () => {
    for (const vp of [VIEWPORTS[1], VIEWPORTS[2]]) {
      await setViewport(vp)
      await jsClick('[aria-label="Settings"]')
      await browser.pause(900)
      await snap(`settings-workspace-${vp.tag}`)
      // Capture one inner tab at this viewport too
      await jsClickByText('Appearance')
      await browser.pause(700)
      await snap(`settings-appearance-${vp.tag}`)
      await jsClick('[title="Close settings"]')
      await browser.pause(500)
    }
    await setViewport(VIEWPORTS[0])
  })

  // ─── Column config dialog ─────────────────────────────────────────

  it('column-config dialog tabs at desktop', async () => {
    await setViewport(VIEWPORTS[0])
    const res = await jsClick('[aria-label="Configure column"]')
    findings.interactionNotes.push({ surface: 'column-config.open', note: JSON.stringify(res) })
    await browser.pause(900)
    await snap('column-config-general-desktop')
    findings.ariaIssues.push({ surface: 'column-config', items: await scanIconButtonsForAriaLabel() })

    await jsClickByText('Triggers')
    await browser.pause(700)
    await snap('column-config-triggers-desktop')

    await jsClickByText('Exit')
    await browser.pause(700)
    await snap('column-config-exit-desktop')

    await pressEscape()
  })

  it('column-config dialog at tablet + mobile', async () => {
    for (const vp of [VIEWPORTS[1], VIEWPORTS[2]]) {
      await setViewport(vp)
      await jsClick('[aria-label="Configure column"]')
      await browser.pause(900)
      await snap(`column-config-general-${vp.tag}`)
      await pressEscape()
    }
    await setViewport(VIEWPORTS[0])
  })

  // ─── Keyboard shortcuts modal ─────────────────────────────────────

  it('shortcuts-modal at all viewports', async () => {
    for (const vp of VIEWPORTS) {
      await setViewport(vp)
      await browser.keys(['?'])
      await browser.pause(700)
      // Heuristic: shortcuts modal contains "Keyboard shortcuts" heading
      const open = await browser.execute(() =>
        Boolean(Array.from(document.querySelectorAll('h2, h3')).find(h => /shortcut/i.test(h.textContent || ''))),
      )
      await snap(`shortcuts-modal-${vp.tag}`, `open=${open}`)
      await pressEscape()
    }
  })

  // ─── Tab bar ─────────────────────────────────────────────────────

  it('tab-bar at all viewports', async () => {
    for (const vp of VIEWPORTS) {
      await setViewport(vp)
      await browser.pause(400)
      // Crop to top — just snap the whole window
      await snap(`tab-bar-${vp.tag}`)
    }
  })

  // ─── Orchestrator panel ──────────────────────────────────────────

  it('orchestrator-panel-default at desktop + tablet', async () => {
    for (const vp of [VIEWPORTS[0], VIEWPORTS[1]]) {
      await setViewport(vp)
      // Cmd+J toggles chef/orchestrator panel
      await browser.keys(['Meta', 'j'])
      await browser.pause(900)
      await snap(`orchestrator-panel-${vp.tag}`)
      // Toggle back off
      await browser.keys(['Meta', 'j'])
      await browser.pause(500)
    }
  })

  // ─── Regression: P0 watchlist verifications ──────────────────────

  it('REGRESSION P0-1: task title/description editability', async () => {
    await setViewport(VIEWPORTS[0])
    const firstCard = await $('[data-task-id]')
    if (!(await firstCard.isExisting())) return
    await firstCard.click()
    await browser.pause(1000)
    // Look for an editable title field in the expanded card / panel
    const titleEditable = await browser.execute(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, [data-testid*="title"]'))
      for (const h of headings) {
        const txt = (h.textContent || '').trim()
        if (!txt) continue
        // Check for contenteditable / nearby <input> / role=textbox
        const editable = h.getAttribute('contenteditable') === 'true'
        const nearbyInput =
          h.parentElement?.querySelector('input, textarea, [role="textbox"]') !== null
        if (editable || nearbyInput) return { found: true, mechanism: editable ? 'contenteditable' : 'nearby-input', text: txt.slice(0, 60) }
      }
      // Look for a Pencil/Edit icon button
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const lbl = b.getAttribute('aria-label') || b.getAttribute('title') || ''
        return /edit|rename/i.test(lbl)
      })
      return { found: !!editBtn, mechanism: editBtn ? 'edit-button' : 'none', editBtn: editBtn?.getAttribute('aria-label') || null }
    })
    findings.regressionChecks.push({ id: 'P0-1', title: 'task title editability', result: titleEditable })
    await snap('regression-P0-1-task-edit-desktop', JSON.stringify(titleEditable).slice(0, 80))
    // Close panel
    if (await firstCard.isExisting()) {
      await firstCard.click()
      await browser.pause(400)
    }
  })

  it('REGRESSION P0-2: Cmd+W on workspace tab', async () => {
    await setViewport(VIEWPORTS[0])
    const wsCountBefore = await browser.execute(() => {
      // Heuristic: count workspace tabs in tab bar
      return Array.from(document.querySelectorAll('[data-workspace-id], [role="tab"]')).length
    })
    // Don't actually press Cmd+W (may delete data). Instead inspect any confirm dialog handler.
    const hasConfirmHandler = await browser.execute(() => {
      // Check that no global keydown listener calls delete_workspace directly without prompt
      // We can't introspect handlers, but we can check for a "Close tab" button on workspace tabs
      const tabs = Array.from(document.querySelectorAll('[data-workspace-id], [role="tab"]'))
      const closeBtns = tabs.map(t => t.querySelector('button[aria-label*="lose" i], button[title*="lose" i]'))
      return {
        tabCount: tabs.length,
        tabsWithCloseBtn: closeBtns.filter(Boolean).length,
      }
    })
    findings.regressionChecks.push({
      id: 'P0-2',
      title: 'Cmd+W workspace delete confirmation',
      result: { wsCountBefore, hasConfirmHandler },
    })
    await snap('regression-P0-2-cmdw-desktop', JSON.stringify(hasConfirmHandler))
  })

  it('REGRESSION P0-4: Escape close on TaskSettings + Onboarding + Checklist', async () => {
    await setViewport(VIEWPORTS[0])
    // Open task settings modal via the gear icon (if reachable)
    const taskSettingsOpened = await browser.execute(() => {
      const btn =
        document.querySelector('[aria-label*="task settings" i]') ||
        document.querySelector('[aria-label*="ettings" i][aria-label*="ask" i]') ||
        document.querySelector('button[title*="task settings" i]')
      if (!btn) return { ok: false, reason: 'no task-settings trigger' }
      btn.click()
      return { ok: true }
    })
    if (taskSettingsOpened.ok) {
      await browser.pause(900)
      await snap('regression-P0-4-task-settings-open-desktop')
      await browser.keys(['Escape'])
      await browser.pause(500)
      const closed = await browser.execute(() => !document.querySelector('[role="dialog"][aria-modal="true"]:has-text("Task settings")'))
      findings.regressionChecks.push({
        id: 'P0-4-task-settings',
        title: 'Escape closes TaskSettings',
        result: { closedAfterEscape: closed, openResult: taskSettingsOpened },
      })
    } else {
      findings.regressionChecks.push({
        id: 'P0-4-task-settings',
        title: 'Escape closes TaskSettings',
        result: { openResult: taskSettingsOpened },
      })
    }
  })

  it('REGRESSION P0-5: workspace tab close button', async () => {
    await setViewport(VIEWPORTS[0])
    const closeBtnPresent = await browser.execute(() => {
      const tabs = Array.from(document.querySelectorAll('[data-workspace-id]'))
      const results = tabs.map(t => ({
        id: t.getAttribute('data-workspace-id'),
        hasClose: Boolean(t.querySelector('button[aria-label*="lose" i], button[title*="lose" i], button[aria-label*="emove" i]')),
      }))
      return results
    })
    findings.regressionChecks.push({
      id: 'P0-5',
      title: 'workspace tab close button',
      result: closeBtnPresent,
    })
  })

  // ─── Keyboard focus / tab nav ────────────────────────────────────

  it('keyboard tab focus traversal', async () => {
    await setViewport(VIEWPORTS[0])
    // Tab 10 times from board and capture focused element after each
    const trail = []
    for (let i = 0; i < 12; i++) {
      await browser.keys(['Tab'])
      await browser.pause(60)
      const active = await browser.execute(() => {
        const el = document.activeElement
        if (!el) return null
        return {
          tag: el.tagName,
          ariaLabel: el.getAttribute('aria-label'),
          text: (el.textContent || '').trim().slice(0, 50),
          outline: getComputedStyle(el).outline,
        }
      })
      trail.push(active)
    }
    findings.interactionNotes.push({ surface: 'tab-focus', trail })
    await snap('tab-focus-state-desktop', `${trail.length} Tab presses`)
  })

  // ─── Console scrape ──────────────────────────────────────────────

  it('capture console logs', async () => {
    let logs = []
    try {
      logs = await browser.getLogs('browser')
    } catch (e) {
      findings.consoleLogs.push({ note: `getLogs not supported: ${e.message}` })
    }
    if (Array.isArray(logs)) {
      const errors = logs.filter(l => /SEVERE|error/i.test(l.level || ''))
      findings.consoleLogs.push({ total: logs.length, errors: errors.slice(0, 20) })
    }
  })
})
