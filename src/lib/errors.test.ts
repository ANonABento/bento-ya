import { describe, it, expect } from 'vitest'
import { getErrorMessage } from './errors'

describe('getErrorMessage', () => {
  it('extracts message from Error objects', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error')
  })

  it('returns strings as-is', () => {
    expect(getErrorMessage('plain string')).toBe('plain string')
  })

  it('extracts message from Tauri-style error objects', () => {
    expect(getErrorMessage({ message: 'tauri error' })).toBe('tauri error')
  })

  it('stringifies plain objects', () => {
    expect(getErrorMessage({ code: 404 })).toBe('{"code":404}')
  })

  it('converts numbers to string', () => {
    expect(getErrorMessage(42)).toBe('42')
  })

  it('handles null', () => {
    expect(getErrorMessage(null)).toBe('null')
  })

  it('handles undefined', () => {
    expect(getErrorMessage(undefined)).toBe('undefined')
  })
})
