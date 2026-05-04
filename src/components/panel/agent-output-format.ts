export type MarkdownPart =
  | { type: 'markdown'; content: string }
  | { type: 'diff'; content: string }

export function splitMarkdownParts(content: string): MarkdownPart[] {
  const lines = content.split('\n')
  const parts: MarkdownPart[] = []
  let buffer: string[] = []
  let diffBuffer: string[] = []
  let inFence = false

  const flushMarkdown = () => {
    const markdown = buffer.join('\n').trim()
    if (markdown) parts.push({ type: 'markdown', content: markdown })
    buffer = []
  }
  const flushDiff = () => {
    const diff = diffBuffer.join('\n').trimEnd()
    if (diff) parts.push({ type: 'diff', content: diff })
    diffBuffer = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const nextLine = lines[index + 1]
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      buffer.push(line)
      continue
    }

    if (!inFence && startsRawDiffBlock(line, nextLine)) {
      flushMarkdown()
      diffBuffer.push(line)
      continue
    }

    if (!inFence && diffBuffer.length > 0 && isRawDiffContinuationLine(line)) {
      diffBuffer.push(line)
      continue
    }

    if (diffBuffer.length > 0) flushDiff()
    buffer.push(line)
  }

  if (diffBuffer.length > 0) flushDiff()
  flushMarkdown()
  return parts
}

export function looksLikeDiff(content: string): boolean {
  const lines = content.split('\n')
  return lines.some((line) => line.startsWith('@@') || line.startsWith('diff --git '))
    || (lines.some((line) => line.startsWith('+') && !line.startsWith('+++'))
      && lines.some((line) => line.startsWith('-') && !line.startsWith('---')))
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function startsRawDiffBlock(line: string, nextLine?: string): boolean {
  return line.startsWith('diff --git ')
    || line.startsWith('@@')
    || (line.startsWith('--- ') && (nextLine?.startsWith('+++ ') ?? false))
}

function isRawDiffContinuationLine(line: string): boolean {
  return line === ''
    || line.startsWith('diff --git ')
    || line.startsWith('index ')
    || line.startsWith('@@')
    || line.startsWith('--- ')
    || line.startsWith('+++ ')
    || line.startsWith('+')
    || line.startsWith('-')
    || line.startsWith(' ')
    || line.startsWith('\\ No newline at end of file')
}
