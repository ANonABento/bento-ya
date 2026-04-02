/**
 * WebDriverIO config for Bento-ya E2E testing via tauri-webdriver.
 *
 * Prerequisites:
 *   1. Build with webdriver feature: cd src-tauri && cargo build --features webdriver
 *   2. Start Vite dev server: npm run dev
 *   3. Start WebDriver server: tauri-wd --port 4444
 *   4. Run tests: npx wdio run wdio.conf.mjs
 */
export const config = {
  runner: 'local',
  port: 4444,
  specs: ['./tests/webdriver/**/*.spec.mjs'],
  maxInstances: 1,

  capabilities: [{
    'tauri:options': {
      binary: '/Users/bentomac/bento-ya/src-tauri/target/debug/bento-ya',
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
