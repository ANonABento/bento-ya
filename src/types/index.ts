export type { Workspace } from './workspace'
export type {
  Column,
  ColumnTriggers,
  TriggerAction,
  SpawnCliAction,
  MoveColumnAction,
  TriggerTaskAction,
  NoneAction,
  ExitCriteria,
  ExitCriteriaType,
  ActionType,
  CliType,
  /* eslint-disable @typescript-eslint/no-deprecated -- legacy re-exports for backward compat */
  TriggerConfig,
  ExitConfig,
  TriggerType,
  ExitType,
  /* eslint-enable @typescript-eslint/no-deprecated */
} from './column'
export type { Task, TaskChecklistItem, PipelineState, ReviewStatus, PrCiStatus, PrReviewDecision, PrMergeable } from './task'
export type { AgentSession, AgentStatus, AgentMode, AgentMessage } from './agent'
export type { Attachment, AttachmentType, AttachmentError } from './attachment'
export {
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_TYPES,
  SUPPORTED_TEXT_TYPES,
  SUPPORTED_EXTENSIONS,
  MAX_IMAGE_SIZE,
  MAX_DOCUMENT_SIZE,
  MAX_ATTACHMENTS,
  getAttachmentType,
  isFileSupported,
  getMaxSize,
  formatFileSize,
  buildPromptWithAttachments,
} from './attachment'
