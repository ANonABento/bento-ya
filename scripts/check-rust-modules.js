#!/usr/bin/env node

/**
 * Fails when a `.rs` file sits in a module directory but no `mod` declaration
 * pulls it in — i.e. it is never compiled.
 *
 * This is not hypothetical. Commit 234a992 "Split pipeline/mod.rs" created
 * `completion.rs`, `engine.rs`, `events.rs` and `exit.rs`, but never added the
 * `mod` lines, so the split silently never took effect: `mod.rs` kept the live
 * implementation and ~1.2k lines of duplicate `decide_completion` /
 * `mark_complete_with_error` sat beside it, compiling never, tested never.
 *
 * The failure mode is nasty because everything looks fine: `cargo build`
 * passes, `cargo clippy` passes, the file reads like production code, and
 * editing it changes nothing at runtime. Someone did exactly that before this
 * check existed.
 */

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const crates = ['src-tauri/src', 'mcp-server/src']

/** Declarations in a parent file: `mod foo;`, `pub mod foo;`, `pub(crate) mod foo;`. */
function declaredMods(source) {
  const found = new Set()
  for (const m of source.matchAll(/^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm)) {
    found.add(m[1])
  }
  return found
}

/**
 * Known-dead files, left in place pending a decision.
 *
 * Commit 234a992 "Split pipeline/mod.rs" created these and never declared them.
 * Declaring them now would not build — they duplicate symbols that still live
 * in `pipeline/mod.rs` (`decide_completion`, `mark_complete_with_error`, ...),
 * so the choice is *delete them* or *finish the split*, and that belongs to
 * whoever owns the refactor. Listed here so the check still guards every new
 * file instead of being switched off entirely.
 *
 * Shrink this list; never grow it.
 */
const KNOWN_DEAD = new Set([
  'src-tauri/src/pipeline/completion.rs',
  'src-tauri/src/pipeline/engine.rs',
  'src-tauri/src/pipeline/events.rs',
  'src-tauri/src/pipeline/exit.rs',
  'src-tauri/src/pipeline/test_utils.rs',
])

const offenders = []

function checkDir(dir, parentFile) {
  if (!fs.existsSync(parentFile)) return
  const declared = declaredMods(fs.readFileSync(parentFile, 'utf8'))

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // A subdirectory only matters if it actually holds Rust. `db/migrations/`
      // is .sql read at runtime, not compiled.
      const holdsRust = fs
        .readdirSync(full, { withFileTypes: true })
        .some((e) => (e.isFile() && e.name.endsWith('.rs')) || e.isDirectory())
      if (!holdsRust) continue

      // A subdirectory is a module only if the parent declares it; its own
      // mod.rs then governs the files inside.
      const name = entry.name
      if (!declared.has(name)) {
        offenders.push(`${path.relative(root, full)}/  (directory not declared in ${path.relative(root, parentFile)})`)
        continue
      }
      checkDir(full, path.join(full, 'mod.rs'))
      continue
    }
    if (!entry.name.endsWith('.rs')) continue
    const stem = entry.name.slice(0, -3)
    if (stem === 'mod' || stem === 'main' || stem === 'lib') continue
    const rel = path.relative(root, full)
    if (!declared.has(stem) && !KNOWN_DEAD.has(rel)) {
      const lines = fs.readFileSync(full, 'utf8').split('\n').length
      offenders.push(`${rel}  (${lines} lines, never compiled)`)
    }
  }
}

for (const crate of crates) {
  const dir = path.join(root, crate)
  if (!fs.existsSync(dir)) continue
  // Crate root declares the top-level modules.
  const rootFile = ['lib.rs', 'main.rs']
    .map((f) => path.join(dir, f))
    .find((f) => fs.existsSync(f))
  if (rootFile) checkDir(dir, rootFile)
}

if (offenders.length > 0) {
  console.error('Rust files that no `mod` declaration pulls in — these are never compiled:')
  for (const o of offenders) console.error(`  - ${o}`)
  console.error('\nAdd the missing `mod <name>;`, or delete the file. A file that')
  console.error('compiles never and tests never is worse than no file: it reads like')
  console.error('production code and editing it changes nothing.')
  process.exit(1)
}

const stale = [...KNOWN_DEAD].filter((f) => !fs.existsSync(path.join(root, f)))
if (stale.length > 0) {
  console.error('KNOWN_DEAD lists files that no longer exist — remove them from the list:')
  for (const f of stale) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  `Rust module check passed (every new .rs file is reachable; ${String(KNOWN_DEAD.size)} known-dead file(s) pending a decision).`,
)
