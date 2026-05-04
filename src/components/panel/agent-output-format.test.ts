import { describe, expect, it } from 'vitest'
import { looksLikeDiff, splitMarkdownParts, stripAnsi } from './agent-output-format'

describe('agent-output-format', () => {
  describe('splitMarkdownParts', () => {
    it('keeps ordinary markdown lists as markdown', () => {
      expect(splitMarkdownParts('Summary\n\n- first\n- second')).toEqual([
        { type: 'markdown', content: 'Summary\n\n- first\n- second' },
      ])
    })

    it('splits raw unified diffs into diff parts', () => {
      expect(splitMarkdownParts('Before\n\ndiff --git a/a.ts b/a.ts\nindex 123..456 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n\nAfter')).toEqual([
        { type: 'markdown', content: 'Before' },
        {
          type: 'diff',
          content: 'diff --git a/a.ts b/a.ts\nindex 123..456 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
        },
        { type: 'markdown', content: 'After' },
      ])
    })

    it('splits raw unified diffs without git a/b file prefixes', () => {
      expect(splitMarkdownParts('Before\n\n--- old/path.ts\n+++ new/path.ts\n@@ -1 +1 @@\n-old\n+new\n\nAfter')).toEqual([
        { type: 'markdown', content: 'Before' },
        {
          type: 'diff',
          content: '--- old/path.ts\n+++ new/path.ts\n@@ -1 +1 @@\n-old\n+new',
        },
        { type: 'markdown', content: 'After' },
      ])
    })

    it('keeps horizontal rules as markdown', () => {
      expect(splitMarkdownParts('Before\n\n---\n\nAfter')).toEqual([
        { type: 'markdown', content: 'Before\n\n---\n\nAfter' },
      ])
    })

    it('does not split fenced diff code blocks before markdown rendering', () => {
      const content = '```diff\n-old\n+new\n```'

      expect(splitMarkdownParts(content)).toEqual([
        { type: 'markdown', content },
      ])
    })
  })

  it('detects fenced code that should be rendered as a diff', () => {
    expect(looksLikeDiff('-old\n+new')).toBe(true)
    expect(looksLikeDiff('- list item\n- another item')).toBe(false)
  })

  it('strips simple SGR ANSI escape codes', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
  })
})
