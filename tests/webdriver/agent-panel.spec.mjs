/**
 * AgentPanel UI Tests — single-Terminal layout
 *
 * After the unified-PTY migration there's exactly one panel view: the live
 * tmux-backed terminal. These tests verify the surface contract:
 *   - The panel mounts on task-card click
 *   - The header shows the Terminal label and a Stop button
 *   - The Output tab is gone
 *   - Stop button is interactive (does not crash the panel)
 *
 * Runs against a real Tauri app via tauri-webdriver. Requires:
 *   1. cd src-tauri && cargo build --features webdriver
 *   2. tauri-wd --port 4444 (already running per session)
 *   3. npx wdio run wdio.conf.mjs
 */

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

describe('AgentPanel — single-Terminal layout', () => {
  let workspaceId
  let testTaskId

  before(async () => {
    await browser.pause(2000)

    // Ensure a workspace exists; seed if not.
    const wsResult = await tauriInvoke(browser, 'list_workspaces')
    if (!wsResult.ok || wsResult.data.length === 0) {
      await tauriInvoke(browser, 'seed_demo_data', { repoPath: '/tmp/e2e-demo-repo' })
      await browser.pause(2000)
      await browser.refresh()
      await browser.pause(2000)
    }

    const ws = (await tauriInvoke(browser, 'list_workspaces')).data
    workspaceId = ws[0].id

    // Create a task we control fully
    const cols = (await tauriInvoke(browser, 'list_columns', { workspaceId })).data
    const backlog = cols.find(c => c.name === 'Backlog') ?? cols[0]
    const created = await tauriInvoke(browser, 'create_task', {
      workspaceId,
      columnId: backlog.id,
      title: '__webdriver_panel_test_task__',
      description: 'Test task — ignore me',
    })
    if (!created.ok) throw new Error(`create_task failed: ${created.error}`)
    testTaskId = created.data.id
  })

  after(async () => {
    if (testTaskId) {
      await tauriInvoke(browser, 'delete_task', { id: testTaskId })
    }
  })

  it('opens the panel on task-card click and shows the Terminal header', async () => {
    const card = await $(`[data-task-id="${testTaskId}"]`)
    expect(await card.isExisting()).toBe(true)
    await card.click()
    await browser.pause(500)

    // The Terminal label is text inside the panel header (not a tab anymore)
    const terminalLabel = await $('span*=Terminal')
    expect(await terminalLabel.isExisting()).toBe(true)

    // Stop button must be present
    const stopButton = await $('button*=Stop')
    expect(await stopButton.isExisting()).toBe(true)
  })

  it('does not render an Output tab', async () => {
    // Negative assertion: there should be no button labeled "Output"
    const outputTab = await $('button*=Output')
    expect(await outputTab.isExisting()).toBe(false)
  })

  it('xterm container mounts in the panel', async () => {
    // xterm injects a div with class .xterm once initialized
    const xterm = await $('.xterm, .xterm-screen')
    // xterm may take a beat to mount after panel slide-in animation
    await browser.waitUntil(async () => xterm.isExisting(), {
      timeout: 5000,
      timeoutMsg: 'xterm did not mount',
    })
    expect(await xterm.isExisting()).toBe(true)
  })

  it('Stop button is clickable and does not crash the panel', async () => {
    const stopButton = await $('button*=Stop')
    await stopButton.click()
    await browser.pause(400)
    // Stop is a no-op for a task without a running tmux session, but the
    // panel must still be interactive afterward.
    expect(await stopButton.isExisting()).toBe(true)
  })

  it('captures screenshots for visual review', async () => {
    await browser.saveScreenshot('./tests/webdriver/screenshots/panel-terminal-only.png')
  })
})
