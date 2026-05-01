export const COST_DASHBOARD_HASH = '#cost-dashboard'

export function isCostDashboardHash(): boolean {
  return window.location.hash === COST_DASHBOARD_HASH
}

export function openCostDashboard(): void {
  window.location.hash = COST_DASHBOARD_HASH
}

export function closeCostDashboard(): void {
  window.location.hash = ''
}
