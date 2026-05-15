#!/usr/bin/env node
// Writes the canonical KaitenCode GitHub releases URL into
// src-tauri/tauri.conf.json's updater.endpoints.
//
// Run via package.json scripts (also chained from `tauri:build`).

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const confPath = join(__dirname, '..', 'src-tauri', 'tauri.conf.json')
const endpoint = 'https://github.com/ANonABento/kaitencode/releases/latest/download/latest.json'

function main() {
  const conf = JSON.parse(readFileSync(confPath, 'utf8'))
  const current = conf?.plugins?.updater?.endpoints?.[0]

  if (current === endpoint) {
    console.log(`[sync-updater-endpoint] already up to date: ${endpoint}`)
    return
  }

  conf.plugins ??= {}
  conf.plugins.updater ??= { pubkey: '', endpoints: [] }
  conf.plugins.updater.endpoints = [endpoint]
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
  console.log(`[sync-updater-endpoint] ${current ?? '(empty)'} → ${endpoint}`)
}

main()
