/**
 * Skeleton loading UI - shows placeholder columns and cards while data loads
 */

function SkeletonCard() {
  return (
    <div className="rounded border border-border-default bg-surface p-3 animate-pulse">
      {/* Title */}
      <div className="h-4 w-3/4 rounded bg-surface-hover" />
      {/* Meta */}
      <div className="mt-2 flex gap-2">
        <div className="h-3 w-12 rounded bg-surface-hover" />
        <div className="h-3 w-16 rounded bg-surface-hover" />
      </div>
    </div>
  )
}

function SkeletonColumn({ cardCount }: { cardCount: number }) {
  return (
    <div className="flex w-[300px] min-w-[280px] shrink-0 flex-col border-r border-border-default bg-surface/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="h-5 w-5 rounded bg-surface-hover animate-pulse" />
        <div className="h-3 w-20 rounded bg-surface-hover animate-pulse" />
        <div className="ml-auto h-4 w-6 rounded bg-surface-hover animate-pulse" />
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {Array.from({ length: cardCount }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonLoader() {
  return (
    <div className="flex h-full overflow-hidden">
      <SkeletonColumn cardCount={3} />
      <SkeletonColumn cardCount={2} />
      <SkeletonColumn cardCount={1} />
      <SkeletonColumn cardCount={0} />
    </div>
  )
}
