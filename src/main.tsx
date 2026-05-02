import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'
import './index.css'
import { initializeAppearance } from './lib/appearance'
import { initializeTheme } from './lib/theme'
import { initializeWindowZoomState } from './lib/window-state'

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
