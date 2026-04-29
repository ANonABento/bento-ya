declare module 'node:fs' {
  export function chmodSync(path: string, mode: number): void
  export function existsSync(path: string): boolean
  export function mkdtempSync(prefix: string): string
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function readFileSync(path: string, encoding: string): string
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function writeFileSync(path: string, data: string): void
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string | undefined>; encoding?: string; stdio?: string },
  ): string

  export function spawnSync(
    command: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string | undefined>; encoding?: string },
  ): {
    status: number | null
    stdout: string
    stderr: string
  }
}

declare const process: {
  cwd(): string
  env: Record<string, string | undefined>
}
