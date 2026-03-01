import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Bento-ya
 *
 * These tests run against the Vite dev server with browser mocks enabled.
 * The app automatically uses mock data when Tauri is not available.
 */

test.describe('Bento-ya App', () => {
  test.describe('Startup', () => {
    test('should load the app and show the title', async ({ page }) => {
      await page.goto('/')

      // App should load with correct title
      await expect(page).toHaveTitle(/Bento-ya/)
    })

    test('should show workspace tabs when workspaces exist', async ({ page }) => {
      await page.goto('/')

      // Wait for app to initialize with mock data
      await page.waitForTimeout(500)

      // Should see the demo workspace tab
      await expect(page.getByText('Demo Workspace')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Kanban Board', () => {
    test('should show default columns', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Default columns should be visible
      const columns = ['Backlog', 'Working', 'Review', 'Done']

      for (const colName of columns) {
        await expect(page.getByText(colName, { exact: true }).first()).toBeVisible({ timeout: 5000 })
      }
    })

    test('should show sample task', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Sample task from mock data should be visible
      await expect(page.getByText('Sample Task')).toBeVisible({ timeout: 5000 })
    })

    test('should have add column button', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Find add column button by its icon or title
      const addButton = page.locator('button[title="Add column"], button:has-text("+")')
      await expect(addButton.first()).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Settings', () => {
    test('should open settings by clicking gear icon', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Click settings button (has title="Settings")
      await page.locator('button[title="Settings"]').click()

      // Settings panel should appear with "Settings" heading
      await expect(page.locator('h2:has-text("Settings")')).toBeVisible({ timeout: 5000 })
    })

    test('should close settings by clicking backdrop', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Click settings button
      await page.locator('button[title="Settings"]').click()

      // Settings panel should appear
      await expect(page.locator('h2:has-text("Settings")')).toBeVisible({ timeout: 5000 })

      // Click the backdrop to close (the semi-transparent overlay)
      await page.locator('.bg-black\\/50').click({ position: { x: 10, y: 10 } })

      // Settings should be closed
      await expect(page.locator('h2:has-text("Settings")')).not.toBeVisible({ timeout: 3000 })
    })
  })

  test.describe('About Modal', () => {
    test('should open about modal with keyboard shortcut', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Press Cmd+/ (about shortcut)
      await page.keyboard.press('Meta+/')

      // About modal should appear
      await expect(page.getByText('About Bento-ya')).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Workspace Management', () => {
    test('should show workspace in tab bar', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(500)

      // Demo workspace should be in tab bar
      const tab = page.getByText('Demo Workspace')
      await expect(tab).toBeVisible({ timeout: 5000 })
    })
  })
})
