//! Database model structs for all domain entities.
//!
//! Each struct maps 1:1 to a database table and uses camelCase serialization
//! for frontend compatibility via Tauri IPC.

use serde::{Deserialize, Serialize};

// ─── Core Entities ──────────────────────────────────────────────────────────

/// A workspace represents a project directory with its kanban board.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub tab_order: i64,
    pub is_active: bool,
    pub active_task_count: i64,
    pub config: String,
    pub created_at: String,
    pub updated_at: String,
    // Discord integration fields
    pub discord_guild_id: Option<String>,
    pub discord_category_id: Option<String>,
    pub discord_chef_channel_id: Option<String>,
    pub discord_notifications_channel_id: Option<String>,
    pub discord_enabled: Option<i64>,
}

/// A column in the kanban board (pipeline stage).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub icon: String,
    pub position: i64,
    pub color: Option<String>,
    pub visible: bool,
    /// Unified triggers config (JSON string)
    pub triggers: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A task on the kanban board.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub position: i64,
    pub priority: String,
    pub agent_mode: Option<String>,
    pub agent_status: Option<String>,
    pub queued_at: Option<String>,
    pub branch_name: Option<String>,
    pub files_touched: String,
    pub checklist: Option<String>,
    pub pipeline_state: String,
    pub pipeline_triggered_at: Option<String>,
    pub pipeline_error: Option<String>,
    pub retry_count: i64,
    pub model: Option<String>,
    pub agent_session_id: Option<String>,
    pub last_script_exit_code: Option<i64>,
    pub review_status: Option<String>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    // Siege loop fields
    pub siege_iteration: i64,
    pub siege_active: bool,
    pub siege_max_iterations: i64,
    pub siege_last_checked: Option<String>,
    // PR/CI status fields (from GitHub API)
    pub pr_mergeable: Option<String>,
    pub pr_ci_status: Option<String>,
    pub pr_review_decision: Option<String>,
    pub pr_comment_count: i64,
    pub pr_is_draft: bool,
    pub pr_labels: String,
    pub pr_last_fetched: Option<String>,
    pub pr_head_sha: Option<String>,
    // Notification fields
    pub notify_stakeholders: Option<String>,
    pub notification_sent_at: Option<String>,
    // Trigger override fields
    pub trigger_overrides: Option<String>,
    pub trigger_prompt: Option<String>,
    pub last_output: Option<String>,
    pub dependencies: Option<String>,
    pub blocked: bool,
    /// Per-task git worktree path (absolute). When set, agents use this as cwd instead of workspace.repo_path.
    pub worktree_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Agent Entities ─────────────────────────────────────────────────────────

/// A PTY/CLI session for an agent working on a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub task_id: String,
    pub pid: Option<i64>,
    pub status: String,
    pub pty_cols: i64,
    pub pty_rows: i64,
    pub last_output: Option<String>,
    pub exit_code: Option<i64>,
    pub agent_type: String,
    pub working_dir: Option<String>,
    pub scrollback: Option<String>,
    pub resumable: bool,
    pub cli_session_id: Option<String>,
    pub model: Option<String>,
    pub effort_level: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A message in agent chat (per-task conversation).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub task_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub effort_level: Option<String>,
    pub tool_calls: Option<String>,
    pub thinking_content: Option<String>,
    pub created_at: String,
}

// ─── Chat/Orchestrator Entities ─────────────────────────────────────────────

/// A chat session in the orchestrator panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub cli_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A message in an orchestrator chat session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

/// Internal orchestrator session state (tracks status, last error).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSession {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Checklist Entities ─────────────────────────────────────────────────────

/// A production checklist attached to a workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checklist {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: Option<String>,
    pub progress: i64,
    pub total_items: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A category grouping checklist items.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistCategory {
    pub id: String,
    pub checklist_id: String,
    pub name: String,
    pub icon: String,
    pub position: i64,
    pub progress: i64,
    pub total_items: i64,
    pub collapsed: bool,
}

/// An individual checklist item with optional auto-detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub category_id: String,
    pub text: String,
    pub checked: bool,
    pub notes: Option<String>,
    pub position: i64,
    pub detect_type: Option<String>,
    pub detect_config: Option<String>,
    pub auto_detected: bool,
    pub linked_task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Script Entities ──────────────────────────────────────────────────────

/// A reusable automation recipe for column triggers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    pub id: String,
    pub name: String,
    pub description: String,
    /// JSON array of steps (BashStep | AgentStep | CheckStep)
    pub steps: String,
    pub is_built_in: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Pipeline Timing Entities ───────────────────────────────────────────────

/// Tracks how long a task spends in each column for bottleneck analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineTiming {
    pub id: String,
    pub task_id: String,
    pub column_id: String,
    pub column_name: String,
    pub entered_at: String,
    pub exited_at: Option<String>,
    pub duration_seconds: Option<i64>,
    pub success: Option<bool>,
    pub retry_count: i64,
}

/// Average timing per column for workspace-level analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnTimingAverage {
    pub column_id: String,
    pub column_name: String,
    pub avg_duration_seconds: f64,
    pub task_count: i64,
    pub success_count: i64,
    pub failure_count: i64,
}

// ─── Usage Tracking Entities ────────────────────────────────────────────────

/// A record of LLM token usage (per-request).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub column_name: Option<String>,
    pub duration_seconds: i64,
    pub created_at: String,
}

/// Aggregated usage summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
    pub record_count: i64,
}

// ─── Session History Entities ───────────────────────────────────────────────

/// A snapshot of an agent session at a point in time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub id: String,
    pub session_id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub snapshot_type: String,
    pub scrollback_snapshot: Option<String>,
    pub command_history: String,
    pub files_modified: String,
    pub duration_ms: i64,
    pub created_at: String,
}
