import type { Options } from '@wdio/types'
import { spawn, type ChildProcess } from 'child_process'

let tauriDriver: ChildProcess | null = null

export const config: Options.Testrunner = {
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: './tsconfig.json',
      transpileOnly: true,
    },
  },

  specs: ['./e2e/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      'browserName': 'chrome',
      'tauri:options': {
        // Use debug build for faster iteration, or release for CI
        application: process.env.TAURI_E2E_RELEASE
          ? './src-tauri/target/release/bento-ya'
          : './src-tauri/target/debug/bento-ya',
      },
    } as WebdriverIO.Capabilities,
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // Start tauri-driver before tests
  onPrepare: async function () {
    // Build the app first
    console.log('Starting tauri-driver for E2E tests...')

    // Start tauri-driver (installed via cargo install tauri-driver)
    tauriDriver = spawn(
      'tauri-driver',
      [],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      }
    )

    tauriDriver.stdout?.on('data', (data) => {
      console.log(`[tauri-driver] ${data}`)
    })

    tauriDriver.stderr?.on('data', (data) => {
      console.error(`[tauri-driver] ${data}`)
    })

    // Wait for driver to be ready
    await new Promise((resolve) => setTimeout(resolve, 3000))
  },

  // Stop tauri-driver after tests
  onComplete: async function () {
    if (tauriDriver) {
      tauriDriver.kill()
      tauriDriver = null
    }
  },

  // Connect to tauri-driver
  port: 4444,
  path: '/',
}
