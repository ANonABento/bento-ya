export default {
  '**/*.{ts,tsx}': 'eslint --fix',
  '{Cargo.toml,Cargo.lock,src-tauri/**/*.{rs,toml},mcp-server/**/*.{rs,toml}}': () => 'cargo check',
}
