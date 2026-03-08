// Pipeline template types

export type ColumnTemplate = {
  name: string
  icon: string
  color: string | null
  triggerConfig: string
  exitConfig: string
  autoAdvance: boolean
}

export type PipelineTemplate = {
  id: string
  name: string
  description: string
  columns: ColumnTemplate[]
  isBuiltIn: boolean
  createdAt: string
  updatedAt: string
}

// Community template metadata
export type CommunityTemplate = PipelineTemplate & {
  author: string
  downloads: number
  stars: number
  tags: string[]
}

// Featured community templates (simulated gallery)
export const COMMUNITY_TEMPLATES: CommunityTemplate[] = [
  {
    id: 'community-agile-scrum',
    name: 'Agile Scrum Board',
    description: 'Sprint-based workflow with story points and sprint backlog management',
    author: 'agile-dev',
    downloads: 1250,
    stars: 89,
    tags: ['agile', 'scrum', 'sprint'],
    columns: [
      { name: 'Sprint Backlog', icon: '📦', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'In Sprint', icon: '🏃', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Code Review', icon: '👀', color: null, triggerConfig: 'agent:review', exitConfig: 'pr:approved', autoAdvance: true },
      { name: 'QA', icon: '🧪', color: null, triggerConfig: 'cmd:npm test', exitConfig: 'exit:0', autoAdvance: true },
      { name: 'Ready for Release', icon: '🎁', color: '#60A5FA', triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Released', icon: '🚀', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: false,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-06-20T15:30:00Z',
  },
  {
    id: 'community-llm-dev',
    name: 'LLM App Development',
    description: 'Workflow optimized for AI/LLM application development with prompting stages',
    author: 'ai-builder',
    downloads: 890,
    stars: 67,
    tags: ['ai', 'llm', 'prompting'],
    columns: [
      { name: 'Ideas', icon: '💡', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Prompt Design', icon: '✍️', color: null, triggerConfig: 'agent:plan', exitConfig: 'file:prompt.md', autoAdvance: true },
      { name: 'Implementation', icon: '⚡', color: null, triggerConfig: 'agent:code', exitConfig: '', autoAdvance: false },
      { name: 'Eval', icon: '📊', color: null, triggerConfig: 'cmd:npm run eval', exitConfig: 'exit:0', autoAdvance: true },
      { name: 'Tuning', icon: '🎛️', color: '#FBBF24', triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Deployed', icon: '✅', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: false,
    createdAt: '2024-03-10T08:00:00Z',
    updatedAt: '2024-07-15T12:00:00Z',
  },
  {
    id: 'community-docs-pipeline',
    name: 'Documentation Pipeline',
    description: 'Structured workflow for technical documentation with review stages',
    author: 'docs-writer',
    downloads: 456,
    stars: 34,
    tags: ['docs', 'writing', 'technical'],
    columns: [
      { name: 'Topics', icon: '📚', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Drafting', icon: '📝', color: null, triggerConfig: 'agent:write', exitConfig: '', autoAdvance: false },
      { name: 'Technical Review', icon: '🔬', color: null, triggerConfig: 'agent:review', exitConfig: '', autoAdvance: false },
      { name: 'Editorial', icon: '✏️', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Published', icon: '📰', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: false,
    createdAt: '2024-02-20T14:00:00Z',
    updatedAt: '2024-05-10T09:00:00Z',
  },
  {
    id: 'community-security-review',
    name: 'Security Review',
    description: 'Security-focused workflow with vulnerability scanning and penetration testing stages',
    author: 'sec-ops',
    downloads: 678,
    stars: 52,
    tags: ['security', 'audit', 'devsecops'],
    columns: [
      { name: 'Triage', icon: '🔔', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Analysis', icon: '🔍', color: null, triggerConfig: 'agent:analyze', exitConfig: '', autoAdvance: false },
      { name: 'Remediation', icon: '🛠️', color: null, triggerConfig: 'agent:code', exitConfig: 'cmd:npm audit', autoAdvance: true },
      { name: 'Verification', icon: '✓', color: null, triggerConfig: 'cmd:npm run security-scan', exitConfig: 'exit:0', autoAdvance: true },
      { name: 'Closed', icon: '🔒', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: false,
    createdAt: '2024-04-05T11:00:00Z',
    updatedAt: '2024-08-01T16:00:00Z',
  },
]

// Built-in pipeline templates
export const BUILT_IN_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'Basic kanban workflow with Backlog, In Progress, Review, and Done columns',
    columns: [
      { name: 'Backlog', icon: '📋', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'In Progress', icon: '🔨', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Review', icon: '🔍', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Done', icon: '✅', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'full-ci',
    name: 'Full CI Pipeline',
    description: 'Complete CI/CD workflow with automated triggers for testing, review, deployment, and notifications',
    columns: [
      { name: 'Backlog', icon: '📋', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Spec', icon: '📝', color: null, triggerConfig: 'agent:plan', exitConfig: 'file:spec.md', autoAdvance: true },
      { name: 'Build', icon: '🔨', color: null, triggerConfig: 'agent:code', exitConfig: 'cmd:npm run build', autoAdvance: true },
      { name: 'Test', icon: '🧪', color: null, triggerConfig: 'cmd:npm test', exitConfig: 'exit:0', autoAdvance: true },
      { name: 'Review', icon: '🔍', color: null, triggerConfig: 'agent:review', exitConfig: 'pr:approved', autoAdvance: true },
      { name: 'Deploy', icon: '🚀', color: null, triggerConfig: 'cmd:npm run deploy', exitConfig: 'exit:0', autoAdvance: true },
      { name: 'Notify', icon: '📢', color: '#FBBF24', triggerConfig: '', exitConfig: 'notification:sent', autoAdvance: true },
      { name: 'Done', icon: '✅', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'quick-fix',
    name: 'Quick Fix',
    description: 'Streamlined workflow for bug fixes with minimal ceremony',
    columns: [
      { name: 'Todo', icon: '🐛', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Fixing', icon: '🔧', color: null, triggerConfig: 'agent:code', exitConfig: 'cmd:npm test', autoAdvance: true },
      { name: 'Done', icon: '✅', color: '#4ADE80', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'spike',
    name: 'Spike/Research',
    description: 'Exploration workflow for research spikes and prototyping',
    columns: [
      { name: 'Questions', icon: '❓', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Research', icon: '🔬', color: null, triggerConfig: 'agent:research', exitConfig: '', autoAdvance: false },
      { name: 'Prototype', icon: '🧪', color: null, triggerConfig: 'agent:code', exitConfig: '', autoAdvance: false },
      { name: 'Findings', icon: '💡', color: '#FBBF24', triggerConfig: '', exitConfig: '', autoAdvance: false },
    ],
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
