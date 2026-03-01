import { motion, AnimatePresence } from 'motion/react'
import { useVoiceInput, type VoiceInputState } from '@/hooks/use-voice-input'

type Props = {
  onTranscript: (text: string) => void
  disabled?: boolean
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins)}:${String(secs).padStart(2, '0')}`
}

function StateIcon({ state }: { state: VoiceInputState }) {
  switch (state) {
    case 'recording':
      return (
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="h-4 w-4 rounded-full bg-error"
        />
      )
    case 'processing':
      return (
        <motion.svg
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
        >
          <path
            fillRule="evenodd"
            d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.43l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
            clipRule="evenodd"
          />
        </motion.svg>
      )
    default:
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
        >
          <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
          <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
        </svg>
      )
  }
}

export function VoiceInputButton({ onTranscript, disabled }: Props) {
  const {
    state,
    error,
    duration,
    isAvailable,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceInput(onTranscript)

  if (!isAvailable) {
    return null
  }

  const isRecording = state === 'recording'
  const isProcessing = state === 'processing'
  const isActive = isRecording || isProcessing

  const handleClick = () => {
    if (isRecording) {
      stopRecording()
    } else if (!isProcessing) {
      void startRecording()
    }
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (isRecording) {
      cancelRecording()
    }
  }

  return (
    <div className="relative flex items-center">
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="mr-2 flex items-center gap-2 overflow-hidden"
          >
            <span className="text-sm font-medium text-error">
              {formatDuration(duration)}
            </span>
            <button
              onClick={cancelRecording}
              className="rounded p-1 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
              title="Cancel recording"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={handleClick}
        onContextMenu={handleRightClick}
        disabled={disabled || isProcessing}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
          isActive
            ? 'bg-error/20 text-error hover:bg-error/30'
            : 'text-text-secondary hover:bg-surface hover:text-text-primary'
        }`}
        title={
          isRecording
            ? 'Click to stop, right-click to cancel'
            : isProcessing
              ? 'Processing...'
              : 'Voice input (hold to record)'
        }
      >
        <StateIcon state={state} />
      </motion.button>

      {/* Error tooltip */}
      <AnimatePresence>
        {error && state === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-full right-0 mb-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error shadow-lg"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
