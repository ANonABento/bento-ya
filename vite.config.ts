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
  build: {
    // Vite's default 'modules' target, with Safari raised 14 -> 15: esbuild >=0.28
    // works around a Safari 14 destructuring bug via a transform it cannot apply to
    // @dnd-kit's code, so a safari14 target fails the build. Safari 15 shipped for
    // macOS Big Sur, so this does not narrow real support.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari15'],
    rollupOptions: {
      output: {
        // Split heavy vendors out of the single ~1.5 MB app chunk so the webview
        // parses them in parallel and they cache across app updates. NOTE: do not
        // match shiki here — it is dynamically imported (per-language async
        // chunks) and a static rule would defeat that lazy load.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/](react-markdown|remark-|micromark|mdast|hast|unist|unified|vfile|property-information|character-entities|decode-named-character|trim-lines|markdown-table|space-separated-tokens|comma-separated-tokens|ccount|longest-streak|zwitch|html-url-attributes)/.test(id)) {
            return 'markdown'
          }
          if (/[\\/](react-dom|scheduler)[\\/]/.test(id) || /[\\/]react[\\/]/.test(id)) {
            return 'react-vendor'
          }
          if (id.includes('@xterm')) return 'xterm'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (/[\\/]motion[\\/]|framer-motion/.test(id)) return 'motion'
          return undefined
        },
      },
    },
  },
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
