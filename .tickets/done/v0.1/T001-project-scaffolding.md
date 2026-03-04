# T001: Project Scaffolding

## Summary

Initialize the Bento-ya project with Tauri v2, React, TypeScript, Tailwind CSS, Vite, and pnpm. Set up the foundational project structure, build tooling, and dev environment so all subsequent tickets can start working immediately.

## Acceptance Criteria

- [ ] Tauri v2 project initialized (`create-tauri-app` or manual setup)
- [ ] React 19 + TypeScript frontend with Vite bundler
- [ ] Tailwind CSS v4 configured with CSS variable-based theming
- [ ] pnpm as package manager with lockfile
- [ ] Rust backend compiles with `cargo build`
- [ ] Frontend builds with `pnpm build`
- [ ] `pnpm tauri dev` launches a window with "Hello Bento-ya" placeholder
- [ ] ESLint configured (strict TS rules, React hooks, import ordering)
- [ ] Prettier configured (single quotes, no semicolons, 100 char width)
- [ ] `tsconfig.json` with strict mode, `@/` path alias
- [ ] Clippy configured with `#[deny(clippy::all)]`
- [ ] `.gitignore` covers Tauri build artifacts, node_modules, target/
- [ ] Directory structure matches PRODUCT.md file structure (empty placeholder files OK)
- [ ] Tauri v2 capabilities directory created with minimal permissions
- [ ] `tauri.conf.json` configured (app name: "Bento-ya", window title, default size 1280x800)

## Dependencies

- None — this is the first ticket

## Can Parallelize With

- Nothing — everything else depends on this

## Key Files to Create

```
bento-ya/
  src-tauri/
    src/main.rs
    src/lib.rs
    Cargo.toml
    tauri.conf.json
    capabilities/
  src/
    main.tsx
    app.tsx
  public/
    fonts/
    icons/
  package.json
  pnpm-lock.yaml
  tailwind.config.ts
  vite.config.ts
  tsconfig.json
  .eslintrc.cjs (or eslint.config.js)
  .prettierrc
  .gitignore
```

## Complexity

**L** — Many moving parts to configure correctly (Tauri + React + Tailwind + Vite + Rust toolchain).

## Notes

- Use Tauri v2 (not v1). The API surface is different.
- Rust edition 2021, minimum Rust version 1.77+
- React 19 with the new JSX transform
- Tailwind v4 uses CSS-first config (not `tailwind.config.js` for everything)
- Vite 6 with `@vitejs/plugin-react`
- Install core dependencies now (will be needed soon):
  - Frontend: `zustand`, `motion`, `@dnd-kit/core`, `@dnd-kit/sortable`, `xterm`, `xterm-addon-webgl`, `xterm-addon-fit`, `shiki`
  - Rust: `rusqlite`, `portable-pty`, `serde`, `serde_json`, `tokio`, `git2`, `tauri` (v2 features)
- JetBrains Mono font file in `public/fonts/`
- Don't build features yet — just get the shell running
