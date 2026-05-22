#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const frontendDirs = ['src']
const sourceExtensions = new Set(['.ts', '.tsx'])

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const invokedCommands = new Set()
const invokedCommandFiles = new Map()
for (const dir of frontendDirs) {
  for (const file of walk(path.join(root, dir))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/invoke(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g)) {
      invokedCommands.add(match[1])
      const relative = path.relative(root, file)
      const files = invokedCommandFiles.get(match[1]) ?? new Set()
      files.add(relative)
      invokedCommandFiles.set(match[1], files)
    }
  }
}

const libRs = read('src-tauri/src/lib.rs')
const handlerStart = libRs.indexOf('tauri::generate_handler![')
const handlerEnd = libRs.indexOf('])\n        .setup', handlerStart)
if (handlerStart === -1 || handlerEnd === -1) {
  console.error('Could not locate tauri::generate_handler! block in src-tauri/src/lib.rs')
  process.exit(1)
}

const handler = libRs.slice(handlerStart, handlerEnd)
const registeredCommands = new Set()
const devOnlyCommands = new Set(['seed_demo_data'])
const devOnlyRegisteredCommands = new Set()
const handlerLines = handler.split('\n')
for (let i = 0; i < handlerLines.length; i++) {
  const line = handlerLines[i]
  const match = line.match(/(?:commands::(?:\w+::)+|models::)([a-zA-Z0-9_]+)/)
  if (!match) continue

  const command = match[1]
  registeredCommands.add(command)
  const prev = handlerLines
    .slice(Math.max(0, i - 2), i)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
  if (prev.some((candidate) => candidate.includes('cfg(debug_assertions)'))) {
    devOnlyRegisteredCommands.add(command)
  }
}

for (const command of devOnlyCommands) {
  if (!devOnlyRegisteredCommands.has(command)) {
    console.error(`Dev-only IPC command '${command}' must be registered behind #[cfg(debug_assertions)].`)
    process.exit(1)
  }
}

const missing = [...invokedCommands]
  .filter((command) => !registeredCommands.has(command) && !devOnlyCommands.has(command))
  .sort()

if (missing.length > 0) {
  console.error('Frontend invokes missing from Tauri generate_handler!:')
  for (const command of missing) {
    console.error(`  - ${command}`)
  }
  process.exit(1)
}

const unknownDevOnlyInvokes = [...devOnlyCommands]
  .filter((command) => invokedCommands.has(command))
  .filter((command) => {
    const files = [...(invokedCommandFiles.get(command) ?? [])]
    return files.some((file) => file !== 'src/lib/ipc/workspace.ts' && file !== 'src/components/layout/workspace-setup.tsx')
  })

if (unknownDevOnlyInvokes.length > 0) {
  console.error('Dev-only IPC command invoked from unexpected frontend files:')
  for (const command of unknownDevOnlyInvokes) {
    console.error(`  - ${command}: ${[...(invokedCommandFiles.get(command) ?? [])].join(', ')}`)
  }
  process.exit(1)
}

console.log(`IPC registration check passed (${invokedCommands.size} frontend command(s)).`)
