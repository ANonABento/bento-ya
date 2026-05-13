/**
 * WebDriverIO config for Bento-ya E2E testing via tauri-driver.
 *
 * Prerequisites:
 *   1. Build with webdriver feature: cd src-tauri && cargo build --features webdriver
 *   2. Start Vite dev server: npm run dev
 *   3. Start WebDriver server: tauri-driver --port 4444
 *   4. Run tests: npx wdio run wdio.conf.mjs
 *
 * Binary path resolution:
 *   - Defaults to `<repo>/target/debug/bento-ya` (Cargo workspace layout)
 *   - Override with BENTOYA_BINARY env var (e.g. for release builds or non-standard targets)
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const application = process.env.BENTOYA_BINARY || resolve(__dirname, 'target/debug/bento-ya')

export const config = {
  runner: 'local',
  port: 4444,
  specs: ['./tests/webdriver/**/*.spec.mjs'],
  maxInstances: 1,

  capabilities: [{
    // tauri-driver 2.x expects `application` (not `binary`); the latter is
    // silently ignored, which makes WebKitWebDriver fall back to MiniBrowser
    // and `window.__TAURI_INTERNALS__` ends up undefined.
    'tauri:options': {
      application,
    },
  }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 30000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
}
