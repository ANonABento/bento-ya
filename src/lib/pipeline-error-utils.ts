export type ErrorCategory = 'rate_limit' | 'auth' | 'syntax' | 'context_limit' | 'timeout' | 'exit_code' | 'unknown'

export interface ParsedPipelineError {
  friendlyMessage: string
  suggestedFixes: string[]
  category: ErrorCategory
}

interface ErrorPattern {
  pattern: RegExp
  category: ErrorCategory
  friendlyMessage: string
  suggestedFixes: string[]
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /rate.?limit|429|too many requests|rate_limit_exceeded/i,
    category: 'rate_limit',
    friendlyMessage: 'API rate limit reached',
    suggestedFixes: [
      'Wait a few minutes before retrying',
      'Check your API plan and usage limits',
      'Consider adding a retry delay in the trigger config',
    ],
  },
  {
    pattern: /authentication|invalid.{0,10}api.{0,10}key|unauthorized|401|403|forbidden|auth.{0,10}fail/i,
    category: 'auth',
    friendlyMessage: 'Authentication failed',
    suggestedFixes: [
      'Check your API key in Settings → Providers',
      'Verify the API key has not expired or been revoked',
      'Ensure the key has the required permissions',
    ],
  },
  {
    pattern: /syntax.?error|SyntaxError|unexpected.{0,20}token|parse.{0,10}error|invalid.{0,10}json/i,
    category: 'syntax',
    friendlyMessage: 'Syntax or parse error in agent output',
    suggestedFixes: [
      'Check the agent command for syntax errors',
      'Verify CLI arguments are correctly formatted',
      'Review the agent log for the specific failing line',
    ],
  },
  {
    pattern: /context.{0,10}length|too many tokens|context.{0,10}window|max.{0,10}token|token.{0,10}limit|context.{0,10}exceeded/i,
    category: 'context_limit',
    friendlyMessage: 'Context or token limit exceeded',
    suggestedFixes: [
      'Break the task into smaller subtasks',
      'Reduce the task description or prompt size',
      'Use a model with a larger context window',
    ],
  },
  {
    pattern: /timeout|timed.?out|ETIMEDOUT|connection.{0,10}timeout/i,
    category: 'timeout',
    friendlyMessage: 'Agent timed out',
    suggestedFixes: [
      'The agent exceeded the 2-hour time limit',
      'Break the task into smaller, faster subtasks',
      'Check if the agent process hung or stalled',
    ],
  },
  {
    pattern: /exit.{0,10}code [1-9]|non.?zero exit|exited with code [1-9]|process.{0,10}exit/i,
    category: 'exit_code',
    friendlyMessage: 'Agent exited with an error',
    suggestedFixes: [
      'Check the agent log file for error details',
      'Verify the working directory and file permissions',
      'Ensure the CLI command and arguments are correct',
    ],
  },
]

export function parsePipelineError(rawError: string): ParsedPipelineError {
  for (const entry of ERROR_PATTERNS) {
    if (entry.pattern.test(rawError)) {
      return {
        category: entry.category,
        friendlyMessage: entry.friendlyMessage,
        suggestedFixes: entry.suggestedFixes,
      }
    }
  }
  return {
    category: 'unknown',
    friendlyMessage: 'Pipeline failed',
    suggestedFixes: [
      'Check the agent log file for details',
      'Retry the task to see if the error persists',
      'Review the trigger configuration in column settings',
    ],
  }
}
