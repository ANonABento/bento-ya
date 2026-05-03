#!/usr/bin/env node
// Reads the git remote 'origin' URL and writes the GitHub releases URL into
// src-tauri/tauri.conf.json's updater.endpoints. Keeps the endpoint in sync
// with whichever fork/remote the repo currently lives at — no hardcoded
// owner/repo string drift.
//
// Run via package.json scripts (also chained from `tauri:build`).

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const confPath = join(__dirname, '..', 'src-tauri', 'tauri.conf.json')

function parseRepoFromGitRemote() {
  const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim()
  // Match git@github.com:owner/repo.git OR https://github.com/owner/repo(.git)
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/)
  if (!m) {
    throw new Error(`Could not parse owner/repo from git remote: ${url}`)
  }
  return { owner: m[1], repo: m[2] }
}

function main() {
  const { owner, repo } = parseRepoFromGitRemote()
  const endpoint = `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`

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
