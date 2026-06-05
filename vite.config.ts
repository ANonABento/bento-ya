import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Keep a single React instance — a duplicate copy (which the dep optimizer
    // can introduce when a new dependency is added) causes "Invalid hook call /
    // Cannot read properties of null (reading 'useState')" and a blank screen.
    dedupe: ['react', 'react-dom'],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**', '**/.worktrees/**', '**/node_modules/**'],
    },
  },
})
