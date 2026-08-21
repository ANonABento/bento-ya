#!/usr/bin/env node

/**
 * Guards Settings → Appearance → Font Size.
 *
 * That setting works by putting `--base-font-size` on <html>, so only
 * rem-based type scales with it. An arbitrary pixel size is absolute: it
 * ignores the setting entirely. Once enough of them accumulate the hierarchy
 * doesn't just stop scaling, it inverts — at "small" the root drops to 12px so
 * `text-sm` renders 10.5px, and a caption pinned at a fixed 11px comes out *larger*
 * than the body text it sits under.
 *
 * 247 of these had built up before this check existed. Use the scale instead:
 * text-2xs / text-xs / text-sm / text-base / text-lg …
 */

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.css'])
const ARBITRARY_FONT_SIZE = /text-\[\d+(?:\.\d+)?(px|pt)\]/g

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

const offenders = []
let scanned = 0
for (const file of walk(path.join(root, 'src'))) {
  scanned += 1
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const match of line.matchAll(ARBITRARY_FONT_SIZE)) {
      offenders.push(`${path.relative(root, file)}:${i + 1}  ${match[0]}`)
    }
  })
}

if (offenders.length > 0) {
  console.error('Absolute font sizes found — these ignore the Font Size setting:')
  for (const offender of offenders) {
    console.error(`  - ${offender}`)
  }
  console.error('\nUse a rem step from the scale instead: text-2xs, text-xs, text-sm, text-base, text-lg.')
  console.error('If a genuinely fixed size is required, add a rem token to the @theme block in src/index.css.')
  process.exit(1)
}

console.log(`Type scale check passed (${scanned} file(s), no absolute font sizes).`)
