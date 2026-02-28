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

## E2E Tests (WebdriverIO)

Full application tests using WebdriverIO with tauri-driver.

> **Note:** `tauri-driver` only works on Linux. E2E tests cannot run on macOS or Windows locally. Use Linux CI (GitHub Actions) for E2E testing.

### Prerequisites

1. Build the Tauri app:
   ```bash
   # Debug build (faster)
   npm run tauri build -- --debug

   # Or release build
   npm run tauri build
   ```

2. Install tauri-driver (Linux only):
   ```bash
   cargo install tauri-driver
   ```

### Running E2E Tests (Linux only)

```bash
# Using debug build
npm run test:e2e

# Using release build
TAURI_E2E_RELEASE=1 npm run test:e2e
```

### Test Files

- `e2e/app.spec.ts` - Main application tests

### CI Configuration

For GitHub Actions, use a Linux runner:
```yaml
e2e-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Install dependencies
      run: |
        sudo apt-get update
        sudo apt-get install -y webkit2gtk-4.1 libayatana-appindicator3-dev
        cargo install tauri-driver
    - run: npm ci
    - run: npm run tauri build -- --debug
    - run: npm run test:e2e
```
