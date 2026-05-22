#!/usr/bin/env node
// Writes the canonical KaitenCode GitHub releases URL into
// src-tauri/tauri.conf.json's updater.endpoints and, when provided by CI,
// injects the updater public key required to produce signed updater artifacts.
//
// Run via package.json scripts before Tauri commands.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const confPath = join(__dirname, '..', 'src-tauri', 'tauri.conf.json')
const endpoint = 'https://github.com/ANonABento/kaitencode/releases/latest/download/latest.json'
const pubkey = process.env.TAURI_UPDATER_PUBKEY?.trim() ?? ''
const requirePubkey = process.env.REQUIRE_TAURI_UPDATER_PUBKEY === '1'

function main() {
  if (requirePubkey && !pubkey) {
    throw new Error('TAURI_UPDATER_PUBKEY is required when REQUIRE_TAURI_UPDATER_PUBKEY=1')
  }

  const conf = JSON.parse(readFileSync(confPath, 'utf8'))
  const current = conf?.plugins?.updater?.endpoints?.[0]
  const currentPubkey = conf?.plugins?.updater?.pubkey ?? ''
  const currentUpdaterArtifacts = conf?.bundle?.createUpdaterArtifacts ?? false

  conf.plugins ??= {}
  conf.plugins.updater ??= { pubkey: '', endpoints: [] }
  conf.bundle ??= {}

  conf.plugins.updater.endpoints = [endpoint]

  if (pubkey) {
    conf.plugins.updater.pubkey = pubkey
    conf.bundle.createUpdaterArtifacts = true
  } else {
    conf.bundle.createUpdaterArtifacts = false
  }

  const nextPubkey = conf.plugins.updater.pubkey ?? ''
  const nextUpdaterArtifacts = conf.bundle.createUpdaterArtifacts
  const changed =
    current !== endpoint ||
    currentPubkey !== nextPubkey ||
    currentUpdaterArtifacts !== nextUpdaterArtifacts

  if (!changed) {
    console.log(
      `[sync-updater-endpoint] already up to date: ${endpoint}; updater artifacts ${nextUpdaterArtifacts ? 'enabled' : 'disabled'}`,
    )
    return
  }

  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
  console.log(
    `[sync-updater-endpoint] endpoint ${current ?? '(empty)'} → ${endpoint}; updater artifacts ${nextUpdaterArtifacts ? 'enabled' : 'disabled'}`,
  )
}

main()
