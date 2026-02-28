import { useEffect } from 'react'
import { setTheme } from '@/lib/theme'
import { Board } from '@/components/layout/board'

function App() {
  useEffect(() => {
    setTheme('dark')
  }, [])

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Top bar — tab bar area */}
      <header className="flex h-10 shrink-0 items-center justify-center border-b border-border-default bg-surface">
        <span className="text-sm font-medium text-text-secondary">Bento-ya</span>
      </header>

      {/* Main content — board area */}
      <main className="flex-1 overflow-hidden">
        <Board />
      </main>

      {/* Bottom bar — chat input area */}
      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-border-default bg-surface px-4">
        <input
          type="text"
          placeholder='Type or speak... "fix the login validation bug"'
          className="flex-1 rounded-lg border border-border-default bg-bg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </footer>
    </div>
  )
}

export default App
