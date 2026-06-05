/**
 * Shared panel-tab icons — one source of truth for the small glyphs used in
 * panel view-switchers (Chat, Activity, Terminal, Files, Changes). Hand-drawn
 * stroke SVGs (the project has no icon dependency) at a consistent 16×16 grid
 * so they sit evenly in the tab row. Reused by the orchestrator and per-task
 * agent panels via `PanelTabs`.
 */

type IconProps = { className?: string }

const BASE = 'h-3.5 w-3.5 shrink-0'

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? BASE}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ChatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 7.2c0-2.3 2.3-4.2 5.5-4.2s5.5 1.9 5.5 4.2-2.3 4.2-5.5 4.2c-.7 0-1.4-.1-2-.3L3 12.5l.8-2.2c-.8-.8-1.3-1.8-1.3-3.1Z" />
    </Svg>
  )
}

export function ActivityIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.5 8h2.2l1.8 4.5 2.4-9 1.8 6 1.3-2.5h2" />
    </Svg>
  )
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path d="M4.5 6l2 2-2 2M8.5 10.2h3" />
    </Svg>
  )
}

export function FilesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 1.8h4.5L12 5.3V13a1.2 1.2 0 0 1-1.2 1.2H4A1.2 1.2 0 0 1 2.8 13V3A1.2 1.2 0 0 1 4 1.8Z" />
      <path d="M8.3 2v3.2h3.2M5.2 8.3h5.6M5.2 10.6h3.6" />
    </Svg>
  )
}

export function ChangesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10.5 2.2l3.3 3.3-3.3 3.3M5.5 13.8L2.2 10.5l3.3-3.3M13.4 5.5H6.2M9.8 10.5H2.6" />
    </Svg>
  )
}
