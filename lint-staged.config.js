export default {
  '**/*.{ts,tsx}': 'eslint --fix',
  'src-tauri/**/*.{rs,toml}': () => 'cargo check --manifest-path src-tauri/Cargo.toml',
}
