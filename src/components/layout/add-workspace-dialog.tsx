import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useWorkspaceStore } from '@/stores/workspace-store'

type AddWorkspaceDialogProps = {
  onClose: () => void
}

export function AddWorkspaceDialog({ onClose }: AddWorkspaceDialogProps) {
  const add = useWorkspaceStore((s) => s.add)
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!name.trim() || !repoPath.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      await add(name.trim(), repoPath.trim())
      onClose()
    } catch (err) {
      console.error('Failed to add workspace:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => { e.stopPropagation() }}
        className="w-full max-w-md rounded-xl border border-border-default bg-surface p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Add Workspace</h2>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-text-secondary">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              placeholder="My Project"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-text-secondary">Repository Path</label>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => { setRepoPath(e.target.value) }}
              placeholder="/path/to/repo"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !repoPath.trim() || isSubmitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
