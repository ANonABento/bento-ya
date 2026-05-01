export function formatUsageCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function formatUsageTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

export function formatPricePerMillion(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '--'
  return `$${value.toFixed(value < 1 ? 2 : 0)}`
}

export function formatTokenLimit(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '--'
  return formatUsageTokens(value)
}
