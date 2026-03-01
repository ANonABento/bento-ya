import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Bento-ya
 *
 * Note: Full E2E testing requires proper Tauri API mocking.
 * Currently, only basic rendering tests work. Tests that interact
 * with Tauri IPC (workspaces, columns, etc.) are marked as TODO.
 *
 * For full app testing, use:
 * - Unit tests (npm run test:run) for store logic
 * - Manual testing with `npm run tauri dev`
 */

test.describe('Bento-ya App', () => {
  test('should load the app and show the title', async ({ page }) => {
    await page.goto('/')

    // App should load with correct title
    await expect(page).toHaveTitle(/Bento-ya/)
  })

  test('should show error state when Tauri is not available', async ({ page }) => {
    await page.goto('/')

    // Without Tauri runtime, app shows error
    // This is expected behavior in browser-only mode
    const errorText = page.getByText(/cannot read properties|error/i)
    await expect(errorText).toBeVisible({ timeout: 10000 })
  })

  // TODO: These tests require proper Tauri API mocking
  // See: https://tauri.app/v1/guides/testing/mocking
  test.describe.skip('With Tauri Mocks', () => {
    test('should show workspace tabs when workspaces exist', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('button', { name: /Test Workspace/i })).toBeVisible()
    })

    test('should show default columns', async ({ page }) => {
      await page.goto('/')
      const columns = ['Backlog', 'Working', 'Review', 'Done']
      for (const colName of columns) {
        await expect(page.getByText(colName)).toBeVisible()
      }
    })

    test('should open settings with Cmd+,', async ({ page }) => {
      await page.goto('/')
      await page.keyboard.press('Meta+,')
      await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
    })
  })
})
