import { test, expect, type Page } from '@playwright/test'

/**
 * Verifies the Output tab actually renders streaming content
 * (tool badges, thinking, markdown text) when the agent-streaming
 * store is populated. We inject events directly via the test hook
 * `window.__bentoyaAgentStreamingStore` to simulate a real agent run.
 */

async function openPanelForSampleTask(page: Page) {
  await page.goto('/')
  await page.waitForTimeout(800)
  const card = page.getByText('Sample Task').first()
  await expect(card).toBeVisible({ timeout: 10000 })
  await card.click()
  await page.waitForTimeout(500)
}

async function getSampleTaskId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-task-id]')
    for (const c of cards) {
      const titleEl = c.querySelector('h4')
      if (titleEl?.textContent?.includes('Sample Task')) {
        return c.getAttribute('data-task-id') ?? ''
      }
    }
    return ''
  })
}

async function injectStream(page: Page, taskId: string, events: Array<{ type: string; payload: any }>) {
  await page.evaluate(
    ({ id, evts }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__bentoyaAgentStreamingStore
      if (!store) throw new Error('streaming store not exposed on window')
      const state = store.getState()
      state.ensureStream(id)
      for (const e of evts) {
        switch (e.type) {
          case 'thinking':
            state.appendThinking(id, e.payload.content)
            break
          case 'tool_call':
            state.updateTool(id, e.payload.toolId, e.payload.toolName, e.payload.status)
            break
          case 'stream':
            state.appendContent(id, e.payload.content)
            break
          case 'complete':
            state.complete(id)
            break
        }
      }
    },
    { id: taskId, evts: events },
  )
}

test.describe('AgentPanel — live streaming render', () => {
  test('Output tab renders tool badges + thinking + markdown when stream is active', async ({ page }) => {
    await openPanelForSampleTask(page)

    const taskId = await getSampleTaskId(page)
    expect(taskId).toBeTruthy()

    // Make sure Output tab is active first (Sample Task is idle, defaults to Terminal)
    await page.getByRole('button', { name: 'Output' }).click()
    await page.waitForTimeout(200)

    // Inject a realistic agent run sequence
    await injectStream(page, taskId, [
      { type: 'thinking', payload: { content: 'Reading the codebase to understand the audit scope.\nNeed to identify all routes and check responsiveness.' } },
      { type: 'tool_call', payload: { toolId: 't1', toolName: 'Read', status: 'completed' } },
      { type: 'tool_call', payload: { toolId: 't2', toolName: 'Glob', status: 'completed' } },
      { type: 'tool_call', payload: { toolId: 't3', toolName: 'Grep', status: 'completed' } },
      { type: 'tool_call', payload: { toolId: 't4', toolName: 'Bash', status: 'running' } },
      { type: 'stream', payload: { content: '## UI Audit — initial findings\n\nFound 3 critical issues:\n\n1. **Button overflow on /studio** — primary CTA cut off below 768px\n2. **Theme inconsistency** — `/profile` uses light-mode colors in dark theme\n3. **Missing loading state** on `/opportunities` filter dropdown\n\nContinuing audit...' } },
    ])

    await page.waitForTimeout(500)

    // Verify status banner
    await expect(page.locator('text=Streaming').first()).toBeVisible()

    // Verify tool badges (look for the specific tool names — there's a list of tools rendered)
    await expect(page.getByText('Read', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('Glob', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('Bash', { exact: true }).last()).toBeVisible()

    // Verify markdown content rendered
    await expect(page.locator('text=UI Audit — initial findings').first()).toBeVisible()
    await expect(page.locator('text=Button overflow on /studio').first()).toBeVisible()

    // Verify thinking section exists (collapsible)
    await expect(page.locator('summary').filter({ hasText: 'Thinking' }).first()).toBeVisible()

    await page.screenshot({
      path: 'test-results/panel-streaming-active.png',
      fullPage: false,
    })
  })

  test('Output tab shows Completed banner when stream finishes', async ({ page }) => {
    await openPanelForSampleTask(page)
    const taskId = await getSampleTaskId(page)

    await page.getByRole('button', { name: 'Output' }).click()
    await page.waitForTimeout(200)

    await injectStream(page, taskId, [
      { type: 'tool_call', payload: { toolId: 't1', toolName: 'Read', status: 'completed' } },
      { type: 'tool_call', payload: { toolId: 't2', toolName: 'Edit', status: 'completed' } },
      { type: 'stream', payload: { content: 'Done — ready for review.' } },
      { type: 'complete', payload: {} },
    ])

    await page.waitForTimeout(500)

    // Banner should show "Completed" instead of "Streaming"
    await expect(page.locator('text=Completed').first()).toBeVisible()

    // Final content still visible (NOT cleared on complete — that was the bug)
    await expect(page.locator('text=Done — ready for review').first()).toBeVisible()

    await page.screenshot({
      path: 'test-results/panel-streaming-completed.png',
      fullPage: false,
    })
  })
})
