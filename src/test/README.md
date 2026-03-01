# Testing Bento-ya

## Unit Tests (Vitest)

Unit tests for stores, hooks, and utilities. These run without the Tauri runtime.

```bash
# Run tests once
npm run test:run

# Run tests in watch mode
npm run test

# Run with coverage
npm run test:coverage
```

### Test Files

- `src/stores/workspace-store.test.ts` - Workspace store tests
- `src/stores/templates-store.test.ts` - Template store tests

### Adding Tests

1. Create a `*.test.ts` file next to the code being tested
2. Import from `vitest` for test utilities
3. Mock Tauri IPC calls using the mock in `src/test/setup.ts`

Example:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useMyStore } from './my-store'

vi.mock('@tauri-apps/api/core')

describe('my-store', () => {
  it('should do something', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(/* mock response */)
    // test code
  })
})
```

## E2E Tests (Playwright)

Frontend tests using Playwright. Tests run against the Vite dev server with mocked Tauri APIs.

```bash
# Run E2E tests
npm run test:e2e

# Run with UI mode (interactive)
npx playwright test --ui

# Run specific test file
npx playwright test e2e/app.spec.ts

# View test report
npx playwright show-report
```

### Test Files

- `e2e/app.spec.ts` - Main application tests

### How It Works

1. Playwright starts the Vite dev server (`npm run dev`)
2. Tests inject Tauri API mocks via `page.addInitScript()`
3. Tests interact with the React app in a real browser
4. Tauri-specific features (file system, shell) are mocked

### What Can Be Tested

| Feature | Testable | Notes |
|---------|----------|-------|
| UI rendering | Yes | Full browser testing |
| Click/keyboard | Yes | Real interactions |
| State management | Yes | Via mocked IPC |
| Keyboard shortcuts | Yes | Cmd+, etc. |
| File system ops | Mocked | Not real filesystem |
| Shell commands | Mocked | Not real shell |

### Adding E2E Tests

```typescript
import { test, expect } from '@playwright/test'

test('should do something', async ({ page }) => {
  await page.goto('/')

  // Interact with UI
  await page.getByRole('button', { name: 'Click me' }).click()

  // Assert
  await expect(page.getByText('Success')).toBeVisible()
})
```

### CI Configuration

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npx playwright install chromium
    - run: npm run test:e2e
```
