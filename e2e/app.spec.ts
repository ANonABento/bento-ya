describe('Bento-ya App', () => {
  describe('Startup', () => {
    it('should launch the app and show the main window', async () => {
      // Wait for the app to load
      await browser.waitUntil(
        async () => {
          const title = await browser.getTitle()
          return title.includes('Bento-ya')
        },
        { timeout: 10000, timeoutMsg: 'App did not load in time' }
      )
    })

    it('should show workspace setup when no workspaces exist', async () => {
      // Look for the workspace setup component
      const setupHeading = await $('h2=Create Your First Workspace')
      await expect(setupHeading).toExist()
    })
  })

  describe('Workspace Creation', () => {
    it('should create a new workspace', async () => {
      // Find and fill the workspace name input
      const nameInput = await $('input[placeholder*="name"]')
      await nameInput.setValue('Test Workspace')

      // Find and fill the repo path input
      const pathInput = await $('input[placeholder*="path"]')
      await pathInput.setValue('/tmp/test-repo')

      // Click create button
      const createButton = await $('button=Create')
      await createButton.click()

      // Verify workspace tab appears
      await browser.waitUntil(
        async () => {
          const tabs = await $$('[role="button"]')
          const tabTexts = await Promise.all(tabs.map(t => t.getText()))
          return tabTexts.some(text => text.includes('Test Workspace'))
        },
        { timeout: 5000, timeoutMsg: 'Workspace tab did not appear' }
      )
    })
  })

  describe('Kanban Board', () => {
    it('should show default columns', async () => {
      // Default columns should be visible
      const columns = ['Backlog', 'Working', 'Review', 'Done']

      for (const colName of columns) {
        const column = await $(`//*[contains(text(), "${colName}")]`)
        await expect(column).toExist()
      }
    })

    it('should add a new column', async () => {
      // Find and click the add column button
      const addButton = await $('button[title="Add column"]')
      await addButton.click()

      // Verify new column appears
      const newColumn = await $('//*[contains(text(), "Column 5")]')
      await expect(newColumn).toExist()
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('should open settings with Cmd+,', async () => {
      // Press Cmd+,
      await browser.keys(['Meta', ','])

      // Wait for settings panel
      const settingsHeading = await $('h2=Settings')
      await expect(settingsHeading).toBeDisplayed()
    })

    it('should open about modal with Cmd+/', async () => {
      // Close any open panels first
      await browser.keys(['Escape'])
      await browser.pause(200)

      // Press Cmd+/
      await browser.keys(['Meta', '/'])

      // Wait for about modal
      const aboutHeading = await $('h2=About Bento-ya')
      await expect(aboutHeading).toBeDisplayed()
    })
  })
})
