import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { ProcessingIndicator } from './orchestrator-processing-indicator'
import type { OrchestratorSidebarMode } from './orchestrator-panel-shared'

type OrchestratorPanelHeaderProps = {
  isPanelCollapsed: boolean
  isRightDock: boolean
  sidebarMode: OrchestratorSidebarMode | null
  isProcessing: boolean
  processingStartTime: number | null
  canCreateNewChat: boolean
  onHeaderClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onToggleSidebar?: (mode: OrchestratorSidebarMode) => void
  onToggleHistory?: () => void
  onToggleFiles?: () => void
  onToggleDashboard?: () => void
  onNewChat: () => void
  onToggleDock: () => void
  onTogglePanel: () => void
}

export function OrchestratorPanelHeader({
  isPanelCollapsed,
  isRightDock,
  sidebarMode,
  isProcessing,
  processingStartTime,
  canCreateNewChat,
  onHeaderClick,
  onToggleSidebar,
  onToggleHistory,
  onToggleFiles,
  onToggleDashboard,
  onNewChat,
  onToggleDock,
  onTogglePanel,
}: OrchestratorPanelHeaderProps) {
  const handleSidebarToggle = (mode: OrchestratorSidebarMode) => {
    onToggleSidebar?.(mode)

    if (mode === 'history') onToggleHistory?.()
    if (mode === 'files') onToggleFiles?.()
    if (mode === 'dashboard') onToggleDashboard?.()
  }

  return (
    <div
      onClick={onHeaderClick}
      className="relative flex select-none items-center justify-between px-3 py-1.5"
      style={{ cursor: 'pointer' }}
    >
      <div className="flex items-center gap-1">
        {!isPanelCollapsed && (
          <>
            <SidebarToggleButton
              isActive={sidebarMode === 'history'}
              onClick={() => { handleSidebarToggle('history') }}
              label="History"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
              </svg>
            </SidebarToggleButton>
            <SidebarToggleButton
              isActive={sidebarMode === 'files'}
              onClick={() => { handleSidebarToggle('files') }}
              label="Files"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z" />
                <path fillRule="evenodd" d="M2 9.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 .75.75v5a1.75 1.75 0 0 1-1.75 1.75H3.75A1.75 1.75 0 0 1 2 14.25v-5Z" clipRule="evenodd" />
              </svg>
            </SidebarToggleButton>
            <SidebarToggleButton
              isActive={sidebarMode === 'dashboard'}
              onClick={() => { handleSidebarToggle('dashboard') }}
              label="Pipeline dashboard"
              title="Pipeline dashboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM10 7a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 3 0v-8A1.5 1.5 0 0 0 10 7ZM4.5 12A1.5 1.5 0 0 0 3 13.5v3a1.5 1.5 0 0 0 3 0v-3A1.5 1.5 0 0 0 4.5 12Z" />
              </svg>
            </SidebarToggleButton>
          </>
        )}
      </div>

      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
        <span className="text-sm font-medium text-text-primary">Chef</span>
        {isProcessing && <ProcessingIndicator startTime={processingStartTime} />}
      </div>

      <div className="flex items-center gap-2">
        {!isPanelCollapsed && (
          <HeaderActionButton
            onClick={onNewChat}
            disabled={!canCreateNewChat}
            cursor={canCreateNewChat ? 'pointer' : 'not-allowed'}
            className="px-2 text-xs"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
            </svg>
            New
          </HeaderActionButton>
        )}
        <span className="text-xs text-text-secondary">
          {isPanelCollapsed ? 'Cmd+J to expand' : 'Cmd+J'}
        </span>
        {!isPanelCollapsed && (
          <HeaderActionButton
            onClick={onToggleDock}
            title={isRightDock ? 'Dock to bottom' : 'Dock to right'}
            className="w-6"
          >
            {isRightDock ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v7.5h13V4.25a.75.75 0 0 0-.75-.75H4.25ZM3.5 13.25v2.5c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75v-2.5h-13Z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h7.5V3.5H4.25Zm9 0v13h2.5a.75.75 0 0 0 .75-.75V4.25a.75.75 0 0 0-.75-.75h-2.5Z" clipRule="evenodd" />
              </svg>
            )}
          </HeaderActionButton>
        )}
        <HeaderActionButton onClick={onTogglePanel} className="w-6">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            {isRightDock ? (
              <path
                fillRule="evenodd"
                d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            ) : (
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            )}
          </svg>
        </HeaderActionButton>
      </div>
    </div>
  )
}

type SidebarToggleButtonProps = {
  children: ReactNode
  isActive: boolean
  label: string
  onClick: () => void
  title?: string
}

function SidebarToggleButton({
  children,
  isActive,
  label,
  onClick,
  title,
}: SidebarToggleButtonProps) {
  return (
    <HeaderActionButton
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={isActive}
      className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
        isActive
          ? 'bg-surface-hover text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      {children}
    </HeaderActionButton>
  )
}

type HeaderActionButtonProps = {
  'aria-label'?: string
  'aria-pressed'?: boolean
  children: ReactNode
  className?: string
  cursor?: 'pointer' | 'not-allowed'
  disabled?: boolean
  onClick: () => void
  title?: string
}

function HeaderActionButton({
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  children,
  className = '',
  cursor = 'pointer',
  disabled = false,
  onClick,
  title,
}: HeaderActionButtonProps) {
  return (
    <button
      type="button"
      data-orchestrator-header-action="true"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{ cursor }}
      className={`flex h-6 items-center justify-center gap-1 rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary ${className}`}
    >
      {children}
    </button>
  )
}
