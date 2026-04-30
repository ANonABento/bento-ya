import { describe, it, expect } from 'vitest'
import { parsePipelineError } from './pipeline-error-utils'

describe('parsePipelineError', () => {
  describe('rate_limit', () => {
    it('matches "rate limit" phrasing', () => {
      expect(parsePipelineError('Error: rate limit exceeded').category).toBe('rate_limit')
    })
    it('matches 429 status code', () => {
      expect(parsePipelineError('HTTP 429 Too Many Requests').category).toBe('rate_limit')
    })
    it('matches rate_limit_exceeded', () => {
      expect(parsePipelineError('rate_limit_exceeded on API call').category).toBe('rate_limit')
    })
  })

  describe('auth', () => {
    it('matches authentication error', () => {
      expect(parsePipelineError('authentication failed for request').category).toBe('auth')
    })
    it('matches invalid api key', () => {
      expect(parsePipelineError('Invalid API key provided').category).toBe('auth')
    })
    it('matches 401 status code', () => {
      expect(parsePipelineError('HTTP 401 Unauthorized').category).toBe('auth')
    })
    it('matches forbidden', () => {
      expect(parsePipelineError('403 Forbidden').category).toBe('auth')
    })
  })

  describe('syntax', () => {
    it('matches SyntaxError', () => {
      expect(parsePipelineError('SyntaxError: Unexpected token }').category).toBe('syntax')
    })
    it('matches parse error', () => {
      expect(parsePipelineError('JSON parse error at line 12').category).toBe('syntax')
    })
    it('matches invalid json', () => {
      expect(parsePipelineError('invalid JSON in response').category).toBe('syntax')
    })
  })

  describe('context_limit', () => {
    it('matches too many tokens', () => {
      expect(parsePipelineError('too many tokens in prompt').category).toBe('context_limit')
    })
    it('matches context length', () => {
      expect(parsePipelineError('context length exceeded').category).toBe('context_limit')
    })
    it('matches token limit', () => {
      expect(parsePipelineError('token limit reached').category).toBe('context_limit')
    })
    it('matches max token', () => {
      expect(parsePipelineError('max token count exceeded').category).toBe('context_limit')
    })
  })

  describe('timeout', () => {
    it('matches timeout', () => {
      expect(parsePipelineError('Process timeout after 7200s').category).toBe('timeout')
    })
    it('matches timed out', () => {
      expect(parsePipelineError('agent timed out waiting for response').category).toBe('timeout')
    })
    it('matches ETIMEDOUT', () => {
      expect(parsePipelineError('ETIMEDOUT connecting to API').category).toBe('timeout')
    })
  })

  describe('exit_code', () => {
    it('matches exit code N', () => {
      expect(parsePipelineError('exit code 1').category).toBe('exit_code')
    })
    it('matches exited with code', () => {
      expect(parsePipelineError('Process exited with code 2').category).toBe('exit_code')
    })
    it('matches non-zero exit', () => {
      expect(parsePipelineError('non-zero exit status').category).toBe('exit_code')
    })
    it('does not match exit code 0', () => {
      // exit code 0 is success — should fall through to unknown
      expect(parsePipelineError('exit code 0').category).toBe('unknown')
    })
  })

  describe('unknown fallback', () => {
    it('returns unknown for unrecognized errors', () => {
      const result = parsePipelineError('something went wrong')
      expect(result.category).toBe('unknown')
      expect(result.friendlyMessage).toBe('Pipeline failed')
      expect(result.suggestedFixes.length).toBeGreaterThan(0)
    })

    it('returns unknown for empty string', () => {
      expect(parsePipelineError('').category).toBe('unknown')
    })
  })

  describe('friendly messages', () => {
    it('returns correct friendly message for each category', () => {
      expect(parsePipelineError('rate limit').friendlyMessage).toBe('API rate limit reached')
      expect(parsePipelineError('401 unauthorized').friendlyMessage).toBe('Authentication failed')
      expect(parsePipelineError('SyntaxError').friendlyMessage).toBe('Syntax or parse error in agent output')
      expect(parsePipelineError('too many tokens').friendlyMessage).toBe('Context or token limit exceeded')
      expect(parsePipelineError('timed out').friendlyMessage).toBe('Agent timed out')
      expect(parsePipelineError('exit code 1').friendlyMessage).toBe('Agent exited with an error')
    })
  })
})
