// IPC module barrel export
// Re-exports all domain modules for backwards compatibility

// Core utilities
export { invoke, listen, type EventCallback, type UnlistenFn } from './core'

// Domain modules
export * from './workspace'
export * from './column'
export * from './task'
export * from './git'
export * from './agent'
export * from './pipeline'
export * from './orchestrator'
export * from './voice'
export * from './usage'
export * from './history'
export * from './checklist'
export * from './files'
export * from './siege'
export * from './pr-status'

// Re-export error type
export type { AppError } from '@/types/events'
