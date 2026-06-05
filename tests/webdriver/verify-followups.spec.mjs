/**
 * Manual-verification spec for the B-series + Front 3 follow-up UI.
 * Drives the REAL Tauri app (real Rust backend + SQLite) via tauri-driver and
 * captures screenshots as evidence. Not part of the regular suite's intent —
 * this is the "did the new UI actually render and work" pass.
 */

const SHOTS = './tests/webdriver/screenshots'

async function tauriInvoke(cmd, args = {}) {
  return browser.executeAsync(
    (command, commandArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(command, commandArgs)
        .then((result) => done({ ok: true, data: result }))
        .catch((err) => done({ ok: false, error: String(err) }))
    },
    cmd,
    args,
  )
}

describe('Follow-up UI verification (B1–B4 + Front 3)', () => {
  let workspaceId

  before(async () => {
    await browser.setWindowSize(1600, 1000)
    await browser.pause(2000)
    let ws = await tauriInvoke('list_workspaces')
    if (!ws.ok || ws.data.length === 0) {
      const seed = await tauriInvoke('seed_demo_data', { repoPath: '/tmp/e2e-followups-repo' })
      if (!seed.ok) throw new Error(`seed failed: ${seed.error}`)
      await browser.pause(1500)
      await browser.refresh()
      await browser.pause(2500)
      ws = await tauriInvoke('list_workspaces')
    }
    workspaceId = ws.data[0].id
    console.log('[verify] workspaceId =', workspaceId)
  })

  it('B4: check_cli_health returns structured reports for claude+codex', async () => {
    const res = await tauriInvoke('check_cli_health')
    console.log('[verify] check_cli_health =', JSON.stringify(res.data))
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    const ids = res.data.map((r) => r.id).sort()
    expect(ids).toEqual(['claude', 'codex'])
    for (const r of res.data) {
      expect(typeof r.status).toBe('string')
      expect(Array.isArray(r.missingFlags)).toBe(true)
    }
    await browser.saveScreenshot(`${SHOTS}/fu-00-board.png`)
  })

  it('B1: inline add → "More options…" opens the full create dialog', async () => {
    const addBtn = await $('[aria-label="Add task"]')
    await addBtn.waitForExist({ timeout: 10000 })
    await addBtn.click()
    const input = await $('[data-testid="add-task-input"]')
    await input.waitForDisplayed({ timeout: 5000 })
    await input.setValue('VERIFY create-with-options')

    const more = await $('button*=More options')
    await more.waitForExist({ timeout: 5000 })
    await more.click()

    const title = await $('#create-task-title')
    await title.waitForDisplayed({ timeout: 5000 })
    // Title carried over from the inline quick-add
    await expect(title).toHaveValue('VERIFY create-with-options')

    // Every advertised control is present
    for (const id of ['#create-task-column', '#create-task-model', '#create-task-priority', '#create-task-runtime-mode', '#create-task-trigger-prompt']) {
      await expect(await $(id)).toBeExisting()
    }
    await browser.saveScreenshot(`${SHOTS}/fu-01-create-dialog.png`)
  })

  it('B1: creating with options persists model + priority through to the DB', async () => {
    await $('#create-task-model').then((e) => e.selectByAttribute('value', 'opus'))
    await $('#create-task-priority').then((e) => e.selectByAttribute('value', 'high'))
    await $('#create-task-runtime-mode').then((e) => e.selectByAttribute('value', 'managed'))
    await $('#create-task-trigger-prompt').then((e) => e.setValue('do the verify thing'))

    const create = await $('button*=Create Task')
    await create.click()
    await browser.pause(1500)

    const res = await tauriInvoke('list_tasks', { workspaceId })
    expect(res.ok).toBe(true)
    const task = res.data.find((t) => t.title === 'VERIFY create-with-options')
    console.log('[verify] created task =', JSON.stringify(task))
    expect(task).toBeTruthy()
    expect(task.model).toBe('opus')
    expect(task.priority).toBe('high')
    expect(task.triggerPrompt).toBe('do the verify thing')
  })

  it('B2: Settings → Agent shows the "Agent runtime" section and the toggle persists', async () => {
    await $('[aria-label="Settings"]').then((e) => e.click())
    const agentTab = await $('button*=Models & Limits')
    await agentTab.waitForExist({ timeout: 5000 })
    await agentTab.click()
    await browser.pause(500)

    const toggle = await $('[aria-label="Enable interactive runtime mode"]')
    await toggle.waitForExist({ timeout: 5000 })
    await toggle.scrollIntoView()
    await browser.saveScreenshot(`${SHOTS}/fu-02-agent-runtime.png`)

    const before = await tauriInvoke('get_app_settings')
    const wasEnabled = before.data.interactive_mode_enabled === true
    await toggle.click()
    await browser.pause(800)
    const after = await tauriInvoke('get_app_settings')
    console.log('[verify] interactive_mode_enabled', wasEnabled, '->', after.data.interactive_mode_enabled)
    expect(after.data.interactive_mode_enabled).toBe(!wasEnabled)

    // Leave interactive ON so the per-chat/runtime resolution check below is meaningful
    if (after.data.interactive_mode_enabled !== true) {
      await toggle.click()
      await browser.pause(500)
    }
    await browser.keys('Escape')
    await browser.pause(500)
  })

  it('B2: set_task_runtime_mode_override write-path takes effect on the resolver', async () => {
    const tasks = await tauriInvoke('list_tasks', { workspaceId })
    const taskId = tasks.data[0].id
    const set = await tauriInvoke('set_task_runtime_mode_override', { id: taskId, runtimeModeOverride: 'interactive' })
    expect(set.ok).toBe(true)
    expect(set.data.runtimeModeOverride).toBe('interactive')
    const resolved = await tauriInvoke('resolve_runtime_mode', { taskId })
    console.log('[verify] resolved after override =', JSON.stringify(resolved.data))
    expect(resolved.ok).toBe(true)
    // Override is tier-2; with interactive enabled it should now resolve interactive.
    expect(resolved.data.mode).toBe('interactive')
    // cleanup
    await tauriInvoke('set_task_runtime_mode_override', { id: taskId, runtimeModeOverride: null })
  })

  it('B3: orchestrator panel Chat↔Terminal toggle mounts the chef terminal', async () => {
    // The chef panel can start collapsed (only its header shows); expand it so
    // the chat/terminal area — and the toggle — render.
    const expandBtn = await $('[aria-label="Expand orchestrator panel"]')
    if (await expandBtn.isExisting()) {
      await expandBtn.click()
      await browser.pause(1000)
    }
    await browser.saveScreenshot(`${SHOTS}/fu-03a-chef-panel.png`)
    const termToggle = await $('[data-testid="orchestrator-view-terminal"]')
    await termToggle.waitForExist({ timeout: 8000 })
    await termToggle.click()
    const termView = await $('[data-testid="agent-terminal-view"]')
    await termView.waitForExist({ timeout: 8000 })
    expect(await termView.isExisting()).toBe(true)
    await browser.pause(2500) // let the shell spawn + paint
    await browser.saveScreenshot(`${SHOTS}/fu-03-chef-terminal.png`)
    // back to chat
    await $('[data-testid="orchestrator-view-chat"]').then((e) => e.click())
  })
})
