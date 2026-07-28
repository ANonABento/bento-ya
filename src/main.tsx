import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'
import './index.css'
import { initializeAppearance } from './lib/appearance'
import { initializeTheme } from './lib/theme'
import { initializeWindowZoomState } from './lib/window-state'

// Opt-in React render profiler ("react doctor"): `npm run profile`, or
// `VITE_REACT_SCAN=1 npm run dev`. Dev-only — the `import.meta.env.DEV` guard
// makes this whole block dead-code-eliminated from production builds, so
// react-scan never ships.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN) {
  void import('react-scan').then(({ scan }) => { scan({ enabled: true }) })
}

// Apply saved theme and appearance settings before render
initializeTheme()
initializeAppearance()
void initializeWindowZoomState()

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
