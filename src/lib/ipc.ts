// Typed invoke() and listen() wrappers for Tauri IPC.
// Provides type-safe communication between React frontend and Rust backend.
// Falls back to browser mocks when Tauri is not available (E2E testing).
//
// This file re-exports from modular domain files for backwards compatibility.
// For new code, prefer importing directly from '@/lib/ipc/<domain>'

export * from './ipc/index'
