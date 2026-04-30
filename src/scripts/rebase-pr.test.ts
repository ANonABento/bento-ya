import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/rebase-pr.sh')
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

const tempDirs: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bentoya-rebase-pr-'))
  tempDirs.push(dir)
  return dir
}

function writeGhStub(binDir: string, branch = 'feature', base = 'main') {
  mkdirSync(binDir, { recursive: true })
  const ghPath = join(binDir, 'gh')
  writeFileSync(
    ghPath,
    `#!/bin/sh
case "$*" in
  *headRefName*) printf '%s\\n' '${branch}' ;;
  *baseRefName*) printf '%s\\n' '${base}' ;;
  *) exit 1 ;;
esac
`,
  )
  chmodSync(ghPath, 0o755)
}

function setupRepo() {
  const root = makeTempDir()
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')

  execFileSync('git', ['init', '--bare', origin], { env })
  mkdirSync(repo)
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['remote', 'add', 'origin', origin])

  writeFileSync(join(repo, 'file.txt'), 'base\n')
  git(repo, ['add', 'file.txt'])
  git(repo, ['commit', '-m', 'base'])
  git(repo, ['push', '-u', 'origin', 'main'])

  return { root, repo, origin }
}

function runScript(repo: string, root: string, extraEnv: Record<string, string> = {}) {
  const binDir = join(root, 'bin')
  writeGhStub(binDir)

  return spawnSync('bash', [scriptPath, '123', repo], {
    cwd: repo,
    env: {
      ...env,
      ...extraEnv,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      BENTOYA_DB_PATH: join(root, 'missing.db'),
    },
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('scripts/rebase-pr.sh', () => {
  it('rebases a clean PR branch and force-pushes it', () => {
    const { root, repo } = setupRepo()

    git(repo, ['checkout', '-b', 'feature'])
    writeFileSync(join(repo, 'feature.txt'), 'feature\n')
    git(repo, ['add', 'feature.txt'])
    git(repo, ['commit', '-m', 'feature'])
    git(repo, ['push', '-u', 'origin', 'feature'])

    git(repo, ['checkout', 'main'])
    writeFileSync(join(repo, 'main.txt'), 'main\n')
    git(repo, ['add', 'main.txt'])
    git(repo, ['commit', '-m', 'main'])
    git(repo, ['push', 'origin', 'main'])
    git(repo, ['checkout', 'feature'])

    const result = runScript(repo, root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Clean rebase succeeded')
    expect(git(repo, ['merge-base', '--is-ancestor', 'origin/main', 'feature'])).toBe('')
    expect(git(repo, ['status', '--porcelain'])).toBe('')
  }, 30_000)

  it('marks manual review and does not push when the guarded fallback fails type-check', () => {
    const { root, repo, origin } = setupRepo()

    git(repo, ['checkout', '-b', 'feature'])
    writeFileSync(join(repo, 'file.txt'), 'feature\n')
    git(repo, ['add', 'file.txt'])
    git(repo, ['commit', '-m', 'feature change'])
    git(repo, ['push', '-u', 'origin', 'feature'])
    const remoteBefore = git(repo, ['ls-remote', origin, 'refs/heads/feature']).split(/\s+/)[0]

    git(repo, ['checkout', 'main'])
    writeFileSync(join(repo, 'file.txt'), 'main\n')
    git(repo, ['add', 'file.txt'])
    git(repo, ['commit', '-m', 'main change'])
    git(repo, ['push', 'origin', 'main'])
    git(repo, ['checkout', 'feature'])

    const result = runScript(repo, root, { BENTOYA_TYPECHECK_CMD: 'false' })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('NEEDS MANUAL REVIEW')
    expect(git(repo, ['status', '--porcelain'])).toBe('')

    const marker = join(repo, '.git', 'bentoya', 'needs-manual-review-feature.txt')
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toContain('file.txt')
    expect(git(repo, ['ls-remote', origin, 'refs/heads/feature']).split(/\s+/)[0]).toBe(remoteBefore)
  }, 30_000)
})
