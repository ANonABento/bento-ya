/**
 * AgentPanel UI Tests — semantic Transcript + raw Terminal layout
 *
 * The primary panel surface is now the semantic Transcript tab. The raw
 * tmux-backed xterm remains available in the Terminal tab for inspection and
 * direct control. These tests verify that split contract against the real
 * Tauri app.
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

async function waitForTaskCard(taskId) {
  const selector = `[data-task-id="${taskId}"]`
  await browser.waitUntil(async () => (await $(selector)).isExisting(), {
    timeout: 8000,
    timeoutMsg: `task card ${taskId} did not render`,
  })
  return $(selector)
}

describe('AgentPanel — Transcript/Terminal layout', () => {
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
    workspaceId = (ws.find(workspace => workspace.isActive) ?? ws[0]).id

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
    await browser.refresh()
    await browser.pause(1200)
  })

  after(async () => {
    if (testTaskId) {
      await tauriInvoke(browser, 'update_task_agent_status', {
        taskId: testTaskId,
        agentStatus: null,
        queuedAt: null,
      })
      await tauriInvoke(browser, 'delete_task', { id: testTaskId })
    }
  })

  it('opens the panel on task-card click and shows Transcript/Terminal tabs', async () => {
    const card = await waitForTaskCard(testTaskId)
    await card.scrollIntoView()
    await card.click()
    await browser.waitUntil(async () => (await $('[data-testid="agent-panel"]')).isExisting(), {
      timeout: 5000,
      timeoutMsg: 'agent panel did not open',
    })

    expect(await $('[data-testid="agent-panel-tab-transcript"]').isExisting()).toBe(true)
    expect(await $('[data-testid="agent-panel-tab-terminal"]').isExisting()).toBe(true)

    // Lifecycle controls remain in the header.
    expect(await $('[data-testid="agent-panel-hold-button"]').isExisting()).toBe(true)
    expect(await $('[data-testid="agent-panel-stop-button"]').isExisting()).toBe(true)
    expect(await $('[data-testid="agent-panel-kill-button"]').isExisting()).toBe(true)
  })

  it('does not render an Output tab', async () => {
    // Negative assertion: there should be no button labeled "Output"
    const outputTab = await $('button*=Output')
    expect(await outputTab.isExisting()).toBe(false)
  })

  it('Terminal tab mounts the raw xterm view', async () => {
    await $('[data-testid="agent-panel-tab-terminal"]').click()
    await browser.waitUntil(async () => (await $('[data-testid="agent-terminal-view"]')).isExisting(), {
      timeout: 5000,
      timeoutMsg: 'terminal view did not mount',
    })
    await browser.waitUntil(async () => (await $('.xterm, .xterm-screen')).isExisting(), {
      timeout: 5000,
      timeoutMsg: 'xterm did not mount',
    })
    expect(await $('[data-testid="agent-terminal-host"]').isExisting()).toBe(true)
  })

  it('Stop button is enabled for running tasks and does not crash the panel', async () => {
    const update = await tauriInvoke(browser, 'update_task_agent_status', {
      taskId: testTaskId,
      agentStatus: 'running',
      queuedAt: null,
    })
    expect(update.ok).toBe(true)
    await browser.refresh()
    await browser.pause(1200)
    const card = await waitForTaskCard(testTaskId)
    await card.scrollIntoView()
    await card.click()
    await browser.waitUntil(async () => (await $('[data-testid="agent-panel-stop-button"]')).isExisting(), {
      timeout: 5000,
      timeoutMsg: 'Stop button did not render',
    })

    const stopButton = await $('[data-testid="agent-panel-stop-button"]')
    expect(await stopButton.isEnabled()).toBe(true)
    await stopButton.click()
    await browser.pause(400)
    expect(await $('[data-testid="agent-panel"]').isExisting()).toBe(true)
  })

  it('captures screenshots for visual review', async () => {
    await browser.saveScreenshot('./tests/webdriver/screenshots/panel-transcript-terminal.png')
  })
})
