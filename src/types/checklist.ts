// Checklist types for production readiness tracking

// Detection types for auto-detect feature
export type DetectType = 'none' | 'file-exists' | 'file-contains' | 'file-absent' | 'command-succeeds'

export type DetectConfig = {
  pattern?: string      // File glob pattern or regex
  content?: string      // Content to search for (file-contains)
  command?: string      // Command to run (command-succeeds)
}

export type ChecklistItem = {
  id: string
  categoryId: string
  text: string
  checked: boolean
  notes: string | null
  position: number
  // Auto-detect fields
  detectType: DetectType | null
  detectConfig: string | null  // JSON-encoded DetectConfig
  autoDetected: boolean        // true if item was auto-checked
  linkedTaskId: string | null  // Task created via "Fix this"
  createdAt: string
  updatedAt: string
}

export type ChecklistCategory = {
  id: string
  checklistId: string
  name: string
  icon: string
  position: number
  progress: number
  totalItems: number
  collapsed: boolean
  items?: ChecklistItem[]
}

export type Checklist = {
  id: string
  workspaceId: string
  name: string
  description: string | null
  progress: number
  totalItems: number
  createdAt: string
  updatedAt: string
  categories?: ChecklistCategory[]
}

// Built-in checklist templates
export type ChecklistTemplateItem = {
  text: string
  detectType?: DetectType
  detectConfig?: DetectConfig
}

export type ChecklistTemplateCategory = {
  name: string
  icon: string
  items: ChecklistTemplateItem[]
}

export type ChecklistTemplate = {
  id: string
  name: string
  description: string
  categories: ChecklistTemplateCategory[]
}

export const BUILT_IN_CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    id: 'production-readiness',
    name: 'Production Readiness',
    description: 'Comprehensive checklist for production deployment',
    categories: [
      {
        name: 'Security',
        icon: '🔒',
        items: [
          { text: 'Authentication implemented and tested' },
          { text: 'Authorization checks on all endpoints' },
          { text: 'Input validation and sanitization' },
          { text: 'SQL injection protection verified' },
          { text: 'XSS protection in place' },
          { text: 'HTTPS enforced' },
          {
            text: 'Secrets stored securely (not in code)',
            detectType: 'file-absent',
            detectConfig: { pattern: '.env' },
          },
          { text: 'Security headers configured' },
        ],
      },
      {
        name: 'Testing',
        icon: '🧪',
        items: [
          {
            text: 'Unit tests pass',
            detectType: 'command-succeeds',
            detectConfig: { command: 'npm test' },
          },
          { text: 'Integration tests pass' },
          { text: 'E2E tests pass' },
          { text: 'Edge cases covered' },
          { text: 'Error scenarios tested' },
          { text: 'Load/performance testing done' },
        ],
      },
      {
        name: 'Code Quality',
        icon: '✨',
        items: [
          {
            text: 'No lint errors or warnings',
            detectType: 'command-succeeds',
            detectConfig: { command: 'npm run lint' },
          },
          {
            text: 'Type checking passes',
            detectType: 'command-succeeds',
            detectConfig: { command: 'npm run type-check' },
          },
          { text: 'Code reviewed and approved' },
          { text: 'No TODO/FIXME comments in production code' },
          {
            text: 'Documentation updated',
            detectType: 'file-exists',
            detectConfig: { pattern: 'README.md' },
          },
        ],
      },
      {
        name: 'Infrastructure',
        icon: '🏗️',
        items: [
          { text: 'Database migrations ready' },
          {
            text: 'Environment variables configured',
            detectType: 'file-exists',
            detectConfig: { pattern: '.env.example' },
          },
          {
            text: 'CI configured',
            detectType: 'file-exists',
            detectConfig: { pattern: '.github/workflows/*.yml' },
          },
          { text: 'Monitoring/alerting set up' },
          { text: 'Logging configured' },
          { text: 'Backup strategy in place' },
          { text: 'Rollback plan documented' },
        ],
      },
      {
        name: 'Performance',
        icon: '⚡',
        items: [
          { text: 'No N+1 queries' },
          { text: 'Caching implemented where needed' },
          { text: 'Bundle size acceptable' },
          { text: 'Image optimization done' },
          { text: 'Database indexes added' },
        ],
      },
    ],
  },
  {
    id: 'quick-ship',
    name: 'Quick Ship',
    description: 'Minimal checklist for fast deployments',
    categories: [
      {
        name: 'Must Have',
        icon: '✅',
        items: [
          { text: 'Tests pass' },
          { text: 'No build errors' },
          { text: 'Code reviewed' },
          { text: 'Feature flag enabled (if applicable)' },
        ],
      },
    ],
  },
  {
    id: 'api-service',
    name: 'API Service',
    description: 'Checklist for API/backend services',
    categories: [
      {
        name: 'API Design',
        icon: '📝',
        items: [
          { text: 'OpenAPI/Swagger documentation' },
          { text: 'Consistent error responses' },
          { text: 'Rate limiting configured' },
          { text: 'API versioning strategy' },
        ],
      },
      {
        name: 'Reliability',
        icon: '🛡️',
        items: [
          { text: 'Health check endpoint' },
          { text: 'Graceful shutdown handling' },
          { text: 'Circuit breakers for external calls' },
          { text: 'Retry logic for transient failures' },
        ],
      },
    ],
  },
]
