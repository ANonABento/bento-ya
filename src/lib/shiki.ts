/**
 * Shared Shiki helpers — one lazily-loaded highlighter instance + tokenizer,
 * reused by the diff viewer and the file/code viewer. Languages are loaded on
 * demand and cached; themes follow the app light/dark setting.
 */

import type { BundledLanguage, Highlighter, ThemedToken } from 'shiki'

export type { ThemedToken }
export type ShikiTheme = 'github-dark' | 'github-light'

const LANG_MAP: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  svg: 'xml',
  xml: 'xml',
  dockerfile: 'docker',
  graphql: 'graphql',
}

export function detectLanguage(filePath: string): BundledLanguage | null {
  const lower = filePath.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (base === 'dockerfile') return 'docker'
  const ext = base.includes('.') ? base.split('.').pop() ?? '' : ''
  return LANG_MAP[ext] ?? null
}

let highlighterPromise: Promise<Highlighter> | null = null
const loadedLangs = new Set<string>()

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((mod) =>
      mod.createHighlighter({ themes: ['github-dark', 'github-light'], langs: [] }),
    )
  }
  return highlighterPromise
}

export async function tokenizeCode(
  code: string,
  lang: BundledLanguage,
  theme: ShikiTheme,
): Promise<ThemedToken[][] | null> {
  try {
    const hl = await getHighlighter()
    if (!loadedLangs.has(lang)) {
      await hl.loadLanguage(lang)
      loadedLangs.add(lang)
    }
    return hl.codeToTokens(code, { lang, theme }).tokens
  } catch {
    return null
  }
}

export function getCurrentShikiTheme(): ShikiTheme {
  if (typeof document === 'undefined') return 'github-dark'
  return document.documentElement.dataset.theme === 'light' ? 'github-light' : 'github-dark'
}
