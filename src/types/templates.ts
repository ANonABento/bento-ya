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
    description: 'Complete CI/CD workflow with automated triggers for testing, review, and deployment',
    columns: [
      { name: 'Backlog', icon: '📋', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
      { name: 'Spec', icon: '📝', color: null, triggerConfig: 'agent:plan', exitConfig: 'file:spec.md', autoAdvance: true },
      { name: 'Build', icon: '🔨', color: null, triggerConfig: 'agent:code', exitConfig: 'cmd:npm run build', autoAdvance: true },
      { name: 'Test', icon: '🧪', color: null, triggerConfig: 'cmd:npm test', exitConfig: 'exit:0', autoAdvance: true },
      { name: 'Review', icon: '🔍', color: null, triggerConfig: 'agent:review', exitConfig: 'pr:approved', autoAdvance: true },
      { name: 'Deploy', icon: '🚀', color: null, triggerConfig: 'cmd:npm run deploy', exitConfig: 'exit:0', autoAdvance: true },
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
