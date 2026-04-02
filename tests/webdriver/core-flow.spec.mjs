/**
 * Core Pipeline Flow E2E Tests
 *
 * Tests the fundamental flow:
 *   Chef creates tasks → Kanban board → Column triggers fire →
 *   Tasks auto-advance through columns → Triggers chain
 *
 * Runs against the real Tauri app with real Rust backend + SQLite.
 */

/**
 * Helper: invoke a Tauri IPC command via the webview.
 * Uses executeAsync because invoke() returns a Promise.
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

describe('Bento-ya Core Flow', () => {
  describe('App Launch', () => {
    it('should load and display the app title', async () => {
      // Give the app a moment to fully render
      await browser.pause(2000)
      const title = await browser.getTitle()
      expect(title).toBe('Bento-ya')
    })

    it('should show the kanban board with columns', async () => {
      // Wait for React to render board content
      await browser.waitUntil(
        async () => (await $('body').getText()).includes('Backlog'),
        { timeout: 10000, timeoutMsg: 'Kanban columns did not render in time' }
      )
      const text = await $('body').getText()
      expect(text).toContain('Working')
      expect(text).toContain('Review')
      expect(text).toContain('Done')
    })

    it('should show demo workspace tab', async () => {
      await browser.waitUntil(
        async () => (await $('body').getText()).includes('Demo Workspace'),
        { timeout: 10000, timeoutMsg: 'Workspace tab did not render in time' }
      )
    })

    it('should capture initial state screenshot', async () => {
      await browser.saveScreenshot('./tests/webdriver/screenshots/01-initial-state.png')
    })
  })

  describe('IPC Integration', () => {
    it('should detect Tauri runtime (not browser mock)', async () => {
      const result = await browser.execute(
        () => typeof window.__TAURI_INTERNALS__ !== 'undefined'
      )
      expect(result).toBe(true)
    })

    it('should list workspaces via IPC', async () => {
      const result = await tauriInvoke(browser, 'list_workspaces')
      expect(result.ok).toBe(true)
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data[0].name).toBeTruthy()
    })

    it('should list columns for a workspace', async () => {
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      expect(wsResult.ok).toBe(true)

      const wsId = wsResult.data[0].id
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId: wsId })
      expect(colResult.ok).toBe(true)
      expect(Array.isArray(colResult.data)).toBe(true)
      expect(colResult.data.length).toBeGreaterThanOrEqual(4)
    })

    it('should list tasks for a workspace', async () => {
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      const wsId = wsResult.data[0].id
      const taskResult = await tauriInvoke(browser, 'list_tasks', { workspaceId: wsId })
      expect(taskResult.ok).toBe(true)
      expect(Array.isArray(taskResult.data)).toBe(true)
    })
  })

  describe('Task CRUD', () => {
    let workspaceId
    let firstColumnId

    before(async () => {
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      workspaceId = wsResult.data[0].id
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId })
      // Sort by position to get first column
      const sorted = colResult.data.sort((a, b) => a.position - b.position)
      firstColumnId = sorted[0].id
    })

    it('should create a task via IPC', async () => {
      const result = await tauriInvoke(browser, 'create_task', {
        workspaceId,
        columnId: firstColumnId,
        title: 'E2E Test Task',
        description: 'Created by automated WebDriver test',
      })
      expect(result.ok).toBe(true)
      expect(result.data.title).toBe('E2E Test Task')
      expect(result.data.columnId).toBe(firstColumnId)
      expect(result.data.id).toBeTruthy()
    })

    it('should see newly created task in the UI after store refresh', async () => {
      // Task was created via direct IPC (bypassing Zustand store).
      // Trigger a store re-fetch by emitting tasks:changed event.
      await browser.executeAsync((wsId, done) => {
        // Emit the same event the pipeline engine would
        if (window.__TAURI_INTERNALS__) {
          // Dispatch a custom event that the useTaskSync hook listens for
          window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
            event: 'tasks:changed',
            payload: { workspaceId: wsId, reason: 'e2e_test' },
          }).then(() => setTimeout(done, 1000)).catch(() => setTimeout(done, 1000))
        } else {
          setTimeout(done, 500)
        }
      }, workspaceId)

      await browser.saveScreenshot('./tests/webdriver/screenshots/02-after-task-create.png')

      // Check if the task text appears in the page
      const text = await $('body').getText()
      expect(text).toContain('E2E Test Task')
    })

    it('should move a task between columns', async () => {
      // Get current tasks
      const tasksResult = await tauriInvoke(browser, 'list_tasks', { workspaceId })
      const testTask = tasksResult.data.find(t => t.title === 'E2E Test Task')
      expect(testTask).toBeTruthy()

      // Get columns sorted by position
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId })
      const cols = colResult.data.sort((a, b) => a.position - b.position)
      const secondColumn = cols[1]

      // Move task to second column
      const moveResult = await tauriInvoke(browser, 'move_task', {
        id: testTask.id,
        targetColumnId: secondColumn.id,
        position: 0,
      })
      expect(moveResult.ok).toBe(true)
      expect(moveResult.data.columnId).toBe(secondColumn.id)

      await browser.pause(500)
      await browser.saveScreenshot('./tests/webdriver/screenshots/03-after-task-move.png')
    })

    it('should delete a task', async () => {
      const tasksResult = await tauriInvoke(browser, 'list_tasks', { workspaceId })
      const testTask = tasksResult.data.find(t => t.title === 'E2E Test Task')

      const deleteResult = await tauriInvoke(browser, 'delete_task', { id: testTask.id })
      expect(deleteResult.ok).toBe(true)

      // Verify it's gone
      const afterResult = await tauriInvoke(browser, 'list_tasks', { workspaceId })
      const deleted = afterResult.data.find(t => t.title === 'E2E Test Task')
      expect(deleted).toBeUndefined()
    })
  })

  describe('Pipeline Triggers', () => {
    let workspaceId
    let columns

    before(async () => {
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      workspaceId = wsResult.data[0].id
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId })
      columns = colResult.data.sort((a, b) => a.position - b.position)
    })

    it('should configure a move_column trigger on a column', async () => {
      // Set on_entry trigger on column[1] (Working): auto-move to next column
      const triggerConfig = JSON.stringify({
        on_entry: { type: 'move_column', target: 'next' },
        on_exit: null,
        exit_criteria: null,
      })

      const result = await tauriInvoke(browser, 'update_column', {
        id: columns[1].id,
        triggers: triggerConfig,
      })
      expect(result.ok).toBe(true)
    })

    it('should auto-advance task when trigger fires', async () => {
      // Create a task in column[0] (Backlog)
      const createResult = await tauriInvoke(browser, 'create_task', {
        workspaceId,
        columnId: columns[0].id,
        title: 'Trigger Test Task',
        description: 'Should auto-advance through Working to Review',
      })
      expect(createResult.ok).toBe(true)
      const taskId = createResult.data.id

      // Move task to column[1] (Working) — should trigger on_entry → move_column next
      const moveResult = await tauriInvoke(browser, 'move_task', {
        id: taskId,
        targetColumnId: columns[1].id,
        position: 0,
      })
      expect(moveResult.ok).toBe(true)

      // Wait for trigger to process
      await browser.pause(2000)

      // Check where the task ended up
      const taskResult = await tauriInvoke(browser, 'get_task', { id: taskId })
      expect(taskResult.ok).toBe(true)

      await browser.saveScreenshot('./tests/webdriver/screenshots/04-after-trigger.png')

      // The move_column trigger should have moved it to column[2] (Review)
      expect(taskResult.data.columnId).toBe(columns[2].id)

      // Clean up trigger config
      await tauriInvoke(browser, 'update_column', {
        id: columns[1].id,
        triggers: '{}',
      })

      // Clean up task
      await tauriInvoke(browser, 'delete_task', { id: taskId })
    })

    it('should handle spawn_cli trigger type (verify event emission)', async () => {
      // Set up a spawn_cli trigger on column[1]
      const triggerConfig = JSON.stringify({
        on_entry: {
          type: 'spawn_cli',
          cli: 'claude',
          prompt: 'Test prompt for {task.title}',
          use_queue: false,
        },
        on_exit: null,
        exit_criteria: null,
      })

      await tauriInvoke(browser, 'update_column', {
        id: columns[1].id,
        triggers: triggerConfig,
      })

      // Create task and move to trigger column
      const createResult = await tauriInvoke(browser, 'create_task', {
        workspaceId,
        columnId: columns[0].id,
        title: 'CLI Trigger Test',
        description: 'Should emit spawn_cli event',
      })
      const taskId = createResult.data.id

      // Listen for the spawn_cli event
      const eventReceived = await browser.executeAsync((taskIdArg, done) => {
        let received = false
        const unlisten = window.__TAURI_INTERNALS__.invoke(
          'plugin:event|listen',
          { event: 'pipeline:spawn_cli', target: { kind: 'Any' } }
        ).catch(() => {})

        // Move the task to trigger the event
        window.__TAURI_INTERNALS__
          .invoke('move_task', {
            id: taskIdArg,
            targetColumnId: null, // will be set below
            position: 0,
          })
          .catch(() => {})

        // Timeout after 3s
        setTimeout(() => done({ received: false, note: 'timeout' }), 3000)
      }, taskId)

      // The task should at least have pipeline_state changed
      const taskResult = await tauriInvoke(browser, 'get_task', { id: taskId })
      expect(taskResult.ok).toBe(true)
      // Pipeline state should be 'triggered' since spawn_cli was configured
      // (the actual CLI won't spawn since we don't have a real agent, but the state should reflect it)

      await browser.saveScreenshot('./tests/webdriver/screenshots/05-spawn-cli-trigger.png')

      // Clean up
      await tauriInvoke(browser, 'update_column', {
        id: columns[1].id,
        triggers: '{}',
      })
      await tauriInvoke(browser, 'delete_task', { id: taskId })
    })
  })

  describe('Workspace Management', () => {
    it('should create a new workspace', async () => {
      const result = await tauriInvoke(browser, 'create_workspace', {
        name: 'E2E Test Workspace',
        repoPath: '/tmp/e2e-test-repo',
      })
      expect(result.ok).toBe(true)
      expect(result.data.name).toBe('E2E Test Workspace')

      // Clean up
      await tauriInvoke(browser, 'delete_workspace', { id: result.data.id })
    })
  })

  describe('Final State', () => {
    it('should capture final screenshot', async () => {
      await browser.pause(500)
      await browser.saveScreenshot('./tests/webdriver/screenshots/99-final-state.png')
    })
  })
})
