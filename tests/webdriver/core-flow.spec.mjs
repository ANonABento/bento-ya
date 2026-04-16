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
  // Seed demo data before any tests — ensures workspace + columns + tasks exist
  before(async () => {
    await browser.pause(2000)
    const wsResult = await tauriInvoke(browser, 'list_workspaces')
    if (!wsResult.ok || wsResult.data.length === 0) {
      const seedResult = await tauriInvoke(browser, 'seed_demo_data', { repoPath: '/tmp/e2e-demo-repo' })
      if (!seedResult.ok) throw new Error(`Failed to seed demo data: ${seedResult.error}`)
      // Wait for frontend to pick up the new workspace
      await browser.pause(2000)
      // Reload to ensure the UI reflects the seeded state
      await browser.refresh()
      await browser.pause(2000)
    }
  })

  describe('App Launch', () => {
    it('should load and display the app title', async () => {
      const title = await browser.getTitle()
      expect(title).toBe('Bento-ya')
    })

    it('should show the kanban board with columns', async () => {
      // Verify columns exist via IPC (more reliable than DOM text extraction
      // since kanban uses icons/CSS that webdriver can't extract text from)
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      expect(wsResult.ok).toBe(true)
      const wsId = wsResult.data[0].id
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId: wsId })
      expect(colResult.ok).toBe(true)
      const names = colResult.data.map(c => c.name)
      expect(names).toContain('Backlog')
      expect(names).toContain('Working')
      expect(names).toContain('Review')
      expect(names).toContain('Done')
    })

    it('should show a workspace tab', async () => {
      // Verify at least one workspace exists (name varies between dev/test)
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      expect(wsResult.ok).toBe(true)
      expect(wsResult.data.length).toBeGreaterThan(0)
      expect(wsResult.data[0].name).toBeTruthy()
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

      // Clean slate: delete any leftover test tasks from previous runs
      const tasksResult = await tauriInvoke(browser, 'list_tasks', { workspaceId })
      if (tasksResult.ok) {
        for (const task of tasksResult.data) {
          if (task.title === 'E2E Test Task' || task.title === 'Trigger Test Task' || task.title === 'CLI Trigger Test') {
            await tauriInvoke(browser, 'delete_task', { id: task.id })
          }
        }
      }
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

    it('should verify created task exists via IPC', async () => {
      // Verify the task we just created is retrievable
      const tasksResult = await tauriInvoke(browser, 'list_tasks', { workspaceId })
      expect(tasksResult.ok).toBe(true)
      const testTask = tasksResult.data.find(t => t.title === 'E2E Test Task')
      expect(testTask).toBeTruthy()
      expect(testTask.columnId).toBe(firstColumnId)

      await browser.saveScreenshot('./tests/webdriver/screenshots/02-after-task-create.png')
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

      // Temporarily clear triggers on target column to avoid spawning agents during test
      const savedTriggers = secondColumn.triggers
      await tauriInvoke(browser, 'update_column', { id: secondColumn.id, triggers: '{}' })

      // Move task to second column
      const moveResult = await tauriInvoke(browser, 'move_task', {
        id: testTask.id,
        targetColumnId: secondColumn.id,
        position: 0,
      })
      expect(moveResult.ok).toBe(true)
      expect(moveResult.data.columnId).toBe(secondColumn.id)

      // Restore triggers
      if (savedTriggers && savedTriggers !== '{}') {
        await tauriInvoke(browser, 'update_column', { id: secondColumn.id, triggers: savedTriggers })
      }

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
    let savedTriggers = {} // column.id → triggers JSON

    before(async () => {
      const wsResult = await tauriInvoke(browser, 'list_workspaces')
      workspaceId = wsResult.data[0].id
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId })
      columns = colResult.data.sort((a, b) => a.position - b.position)

      // Save and clear ALL column triggers to prevent agents spawning during tests
      for (const col of columns) {
        savedTriggers[col.id] = col.triggers
        if (col.triggers && col.triggers !== '{}') {
          await tauriInvoke(browser, 'update_column', { id: col.id, triggers: '{}' })
        }
      }
    })

    after(async () => {
      // Restore all column triggers
      for (const [colId, triggers] of Object.entries(savedTriggers)) {
        if (triggers && triggers !== '{}') {
          await tauriInvoke(browser, 'update_column', { id: colId, triggers })
        }
      }
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

    it('should accept spawn_cli trigger configuration', async () => {
      // Verify that spawn_cli trigger config can be set and read back
      // (actual trigger execution tested manually — spawning tmux/agents
      // destabilizes the webdriver connection)
      const triggerConfig = JSON.stringify({
        on_entry: {
          type: 'spawn_cli',
          cli: 'codex exec',
          prompt: 'Test prompt for {task.title}',
          use_queue: false,
        },
        on_exit: null,
        exit_criteria: { type: 'agent_complete', auto_advance: true },
      })

      const result = await tauriInvoke(browser, 'update_column', {
        id: columns[1].id,
        triggers: triggerConfig,
      })
      expect(result.ok).toBe(true)

      // Read it back and verify
      const colResult = await tauriInvoke(browser, 'list_columns', { workspaceId })
      const working = colResult.data.find(c => c.id === columns[1].id)
      const parsed = JSON.parse(working.triggers)
      expect(parsed.on_entry.type).toBe('spawn_cli')
      expect(parsed.on_entry.cli).toBe('codex exec')
      expect(parsed.exit_criteria.type).toBe('agent_complete')

      await browser.saveScreenshot('./tests/webdriver/screenshots/05-spawn-cli-trigger.png')

      // Clean up — restore empty triggers (real triggers restored in after())
      await tauriInvoke(browser, 'update_column', {
        id: columns[1].id,
        triggers: '{}',
      })
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
