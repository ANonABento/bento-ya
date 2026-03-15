/**
 * Error boundary for chat panel components.
 * Catches rendering errors and provides recovery options.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ChatErrorBoundaryProps {
  children: ReactNode
  panelName?: string
  onReset?: () => void
}

interface ChatErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ChatErrorBoundary extends Component<
  ChatErrorBoundaryProps,
  ChatErrorBoundaryState
> {
  constructor(props: ChatErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[ChatErrorBoundary] ${this.props.panelName ?? 'Chat'} crashed:`,
      error,
      errorInfo.componentStack
    )
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="rounded-lg bg-red-500/10 p-4">
            <h3 className="text-lg font-semibold text-red-400">
              {this.props.panelName ?? 'Chat'} encountered an error
            </h3>
            <p className="mt-2 text-sm text-neutral-400">
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="rounded-md bg-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-600"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
