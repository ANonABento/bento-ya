import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

// Vite's default 'modules' target, with Safari raised 14 -> 15: esbuild >=0.28
// works around a Safari 14 destructuring bug via a transform it cannot apply to
// @dnd-kit's code, so a safari14 target fails. Safari 15 shipped for macOS Big
// Sur, so this does not narrow real support.
//
// This MUST be applied to the dep optimizer as well as the build: optimizeDeps
// has its own esbuild target and does NOT inherit build.target, so setting only
// the latter leaves `vite dev` failing on @dnd-kit while `vite build` passes.
const ESBUILD_TARGET = ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari15']

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
  // Dev-mode dependency pre-bundling. Without this, `vite dev` (and therefore
  // `tauri dev` and the WebDriver E2E harness) dies on @dnd-kit.
  optimizeDeps: {
    // Scan ONLY the real entry point. Vite's default dep scan globs every HTML
    // file in the project root, which here means docs/ mockups, the Playwright
    // report, site/, and Tauri's codegen assets — any of which can kill the dev
    // server with an unrelated parse error (a docs page using top-level await
    // did exactly that). None of them are app entry points.
    entries: ['index.html'],
    esbuildOptions: { target: ESBUILD_TARGET },
  },
  build: {
    target: ESBUILD_TARGET,
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
