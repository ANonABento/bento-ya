//! ChefSession — orchestrator layer on top of UnifiedChatSession.
//!
//! Adds workspace-aware capabilities:
//! - Board context injection (columns, tasks, workspace state)
//! - System prompt building (API mode vs CLI mode variants)
//! - Tool execution after response (create/update/move/delete tasks)
//! - Action block parsing (CLI mode: `\`\`\`action` blocks)
//!
//! The chef is a layer, not a replacement — it delegates message sending
//! to an underlying `UnifiedChatSession` and adds orchestration on top.

use rusqlite::Connection;
use tauri::AppHandle;

use crate::db::{self, Column, Task, Workspace};
use crate::error::AppError;
use crate::llm::context;
use crate::llm::tools::ToolResult;

use super::events::ChatEvent;
use super::session::{SessionConfig, TransportType, UnifiedChatSession};

/// Execution mode for the chef session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChefMode {
    /// CLI pipe mode — uses action blocks for tool execution
    Cli,
    /// API mode — uses native tool calls (AnthropicClient, not UnifiedChatSession)
    Api,
}

/// Chef session — orchestrator with board awareness.
///
/// Wraps a `UnifiedChatSession` and adds:
/// - Board context (workspace + columns + tasks)
/// - System prompt building with board state
/// - Tool execution / action block parsing after response
///
/// For API mode, the chef builds context but delegates streaming to
/// `AnthropicClient` directly (not through UnifiedChatSession).
/// For CLI mode, the chef uses `UnifiedChatSession::send_message()`.
pub struct ChefSession {
    /// Underlying chat session (CLI mode)
    session: UnifiedChatSession,
    /// Workspace this chef manages
    workspace_id: String,
    /// Execution mode
    mode: ChefMode,
}

impl ChefSession {
    /// Create a new chef session for CLI mode.
    pub fn new_cli(workspace_id: String, config: SessionConfig) -> Self {
        Self {
            session: UnifiedChatSession::new(config, TransportType::Pipe),
            workspace_id,
            mode: ChefMode::Cli,
        }
    }

    /// Create a new chef session for API mode.
    /// Note: API mode uses AnthropicClient directly for streaming,
    /// but ChefSession still provides context building and tool execution.
    pub fn new_api(workspace_id: String, config: SessionConfig) -> Self {
        Self {
            session: UnifiedChatSession::new(config, TransportType::Pipe),
            workspace_id,
            mode: ChefMode::Api,
        }
    }

    // -- Accessors --

    pub fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    pub fn mode(&self) -> ChefMode {
        self.mode
    }

    /// Access the underlying session (for state queries, resume ID, etc.)
    pub fn session(&self) -> &UnifiedChatSession {
        &self.session
    }

    /// Mutable access to the underlying session.
    pub fn session_mut(&mut self) -> &mut UnifiedChatSession {
        &mut self.session
    }

    // -- Context Building --

    /// Build the system prompt for this chef session.
    /// Uses the appropriate variant based on mode (API vs CLI).
    pub fn build_system_prompt(
        &self,
        workspace: &Workspace,
        columns: &[Column],
    ) -> String {
        match self.mode {
            ChefMode::Api => context::build_system_prompt(workspace, columns),
            ChefMode::Cli => context::build_cli_system_prompt(workspace, columns),
        }
    }

    /// Build the board context JSON for injection into messages.
    pub fn build_board_context(
        &self,
        workspace: &Workspace,
        columns: &[Column],
        tasks: &[Task],
    ) -> serde_json::Value {
        context::build_board_context(workspace, columns, tasks)
    }

    /// Format board context as a string for prepending to user messages.
    pub fn format_context_message(
        &self,
        workspace: &Workspace,
        columns: &[Column],
        tasks: &[Task],
    ) -> String {
        let ctx = self.build_board_context(workspace, columns, tasks);
        context::format_board_context_message(&ctx)
    }

    /// Augment a user message with board context.
    /// Prepends the current board state so the LLM has full awareness.
    pub fn augment_message(
        &self,
        message: &str,
        workspace: &Workspace,
        columns: &[Column],
        tasks: &[Task],
    ) -> String {
        let context_str = self.format_context_message(workspace, columns, tasks);
        format!("{}\n\n{}", context_str, message)
    }

    // -- CLI Mode: Send with Context --

    /// Send a message in CLI mode with board context injection.
    ///
    /// 1. Loads workspace state from DB
    /// 2. Builds system prompt with board awareness
    /// 3. Augments message with board context
    /// 4. Delegates to UnifiedChatSession::send_message()
    /// 5. Returns (response, session_id) for tool parsing
    pub async fn send_message_with_context<F>(
        &mut self,
        conn: &Connection,
        message: &str,
        on_event: F,
    ) -> Result<(String, Option<String>), String>
    where
        F: FnMut(ChatEvent),
    {
        // Load workspace state
        let workspace = db::get_workspace(conn, &self.workspace_id)
            .map_err(|e| format!("Failed to get workspace: {}", e))?;
        let columns = db::list_columns(conn, &self.workspace_id)
            .map_err(|e| format!("Failed to list columns: {}", e))?;
        let tasks = db::list_tasks(conn, &self.workspace_id)
            .map_err(|e| format!("Failed to list tasks: {}", e))?;

        // Update system prompt with current board state
        let system_prompt = self.build_system_prompt(&workspace, &columns);
        self.session.set_system_prompt(system_prompt);

        // Augment message with board context
        let augmented = self.augment_message(message, &workspace, &columns, &tasks);

        // Delegate to base session
        self.session.send_message(&augmented, on_event).await
    }

    // -- Tool Execution --

    /// Parse action blocks from a CLI response and execute them.
    ///
    /// CLI mode responses may contain `\`\`\`action` blocks with JSON arrays
    /// of board operations. This parses and executes them.
    ///
    /// Returns the list of executed tool results.
    pub fn execute_response_actions(
        &self,
        conn: &Connection,
        app: &AppHandle,
        response: &str,
    ) -> Result<Vec<ToolResult>, AppError> {
        let tool_uses = crate::llm::tools::parse_cli_action_blocks(response);
        if tool_uses.is_empty() {
            return Ok(Vec::new());
        }

        let columns = db::list_columns(conn, &self.workspace_id)?;

        let execution = crate::llm::executor::execute_tools(
            conn,
            app,
            &self.workspace_id,
            &tool_uses,
            &columns,
        )?;

        Ok(execution.results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> SessionConfig {
        SessionConfig {
            cli_path: "/usr/bin/claude".to_string(),
            model: "sonnet".to_string(),
            system_prompt: String::new(),
            working_dir: None,
            effort_level: None,
        }
    }

    #[test]
    fn test_new_cli_chef() {
        let chef = ChefSession::new_cli("ws-1".to_string(), test_config());
        assert_eq!(chef.workspace_id(), "ws-1");
        assert_eq!(chef.mode(), ChefMode::Cli);
        assert_eq!(chef.session().transport_type(), TransportType::Pipe);
    }

    #[test]
    fn test_new_api_chef() {
        let chef = ChefSession::new_api("ws-2".to_string(), test_config());
        assert_eq!(chef.workspace_id(), "ws-2");
        assert_eq!(chef.mode(), ChefMode::Api);
    }

    #[test]
    fn test_augment_message() {
        let chef = ChefSession::new_cli("ws-1".to_string(), test_config());

        let workspace = Workspace {
            id: "ws-1".to_string(),
            name: "Test".to_string(),
            repo_path: "/test".to_string(),
            tab_order: 0,
            is_active: true,
            config: "{}".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            discord_guild_id: None,
            discord_category_id: None,
            discord_chef_channel_id: None,
            discord_notifications_channel_id: None,
            discord_enabled: None,
        };
        let columns = vec![];
        let tasks = vec![];

        let augmented = chef.augment_message("create a task", &workspace, &columns, &tasks);
        assert!(augmented.contains("board state"));
        assert!(augmented.contains("create a task"));
    }

    #[test]
    fn test_build_system_prompt_cli_vs_api() {
        let workspace = Workspace {
            id: "ws-1".to_string(),
            name: "Test".to_string(),
            repo_path: "/test".to_string(),
            tab_order: 0,
            is_active: true,
            config: "{}".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            discord_guild_id: None,
            discord_category_id: None,
            discord_chef_channel_id: None,
            discord_notifications_channel_id: None,
            discord_enabled: None,
        };
        let columns = vec![];

        let cli_chef = ChefSession::new_cli("ws-1".to_string(), test_config());
        let api_chef = ChefSession::new_api("ws-1".to_string(), test_config());

        let cli_prompt = cli_chef.build_system_prompt(&workspace, &columns);
        let api_prompt = api_chef.build_system_prompt(&workspace, &columns);

        // CLI mode has action block instructions
        assert!(cli_prompt.contains("```action"));
        // API mode uses native tools
        assert!(!api_prompt.contains("```action"));
        // Both mention orchestrator
        assert!(cli_prompt.contains("orchestrator"));
        assert!(api_prompt.contains("orchestrator"));
    }
}
