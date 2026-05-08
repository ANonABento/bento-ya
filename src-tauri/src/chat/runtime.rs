//! Universal agent runtime contract.
//!
//! Runtime adapters translate provider-specific execution streams (Claude CLI,
//! Codex JSONL, generic tmux commands, API model loops, remote agents) into
//! one semantic event stream. The transcript UI and persistence layer should
//! depend on these events, not on raw terminal scrollback.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::events::{parse_json_event, ChatEvent, TokenUsage, ToolStatus};
use crate::db::{self, AgentTranscriptEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAdapterKind {
    ClaudeCli,
    CodexCli,
    GenericCli,
    Api,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeMode {
    Managed,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentInputSource {
    UserChat,
    UserVoice,
    TriggerColumn,
    TriggerUserCommand,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentInputDelivery {
    Live,
    Queued,
    NewTurn,
    ResumeTurn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeInput {
    pub task_id: String,
    pub session_id: Option<String>,
    pub source: AgentInputSource,
    pub content: String,
    pub model: Option<String>,
    pub effort_level: Option<String>,
    pub workdir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRef {
    pub session_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub tmux_session_name: Option<String>,
}

pub type AgentRuntimeResult<T> = Result<T, AgentRuntimeError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRuntimeError {
    pub message: String,
}

impl AgentRuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// Adapter boundary for current and future agent runtimes.
///
/// The first concrete slices can use this trait synchronously as a contract.
/// Long-running implementations should spawn their own async work and emit
/// `AgentRuntimeEvent`s through the runtime event sink.
pub trait AgentRuntimeAdapter: Send {
    fn adapter_kind(&self) -> AgentAdapterKind;
    fn runtime_mode(&self) -> AgentRuntimeMode;
    fn start_turn(&mut self, input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery>;
    fn send_input(&mut self, input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery>;
    fn cancel_turn(&mut self) -> AgentRuntimeResult<()>;
    fn kill_session(&mut self) -> AgentRuntimeResult<()>;
    fn resume_session(&mut self, session_ref: AgentSessionRef) -> AgentRuntimeResult<()>;
}

pub fn decide_input_delivery(
    is_running: bool,
    has_provider_session: bool,
    supports_live_input: bool,
) -> AgentInputDelivery {
    if is_running {
        if supports_live_input {
            AgentInputDelivery::Live
        } else {
            AgentInputDelivery::Queued
        }
    } else if has_provider_session {
        AgentInputDelivery::ResumeTurn
    } else {
        AgentInputDelivery::NewTurn
    }
}

pub fn build_queued_input_turn_prompt(
    queued_inputs: &[db::AgentRuntimeQueuedInput],
) -> Option<String> {
    let pending: Vec<&db::AgentRuntimeQueuedInput> = queued_inputs
        .iter()
        .filter(|input| !input.content.trim().is_empty())
        .collect();
    if pending.is_empty() {
        return None;
    }

    let mut prompt =
        String::from("The user sent the following steering while you were running:\n\n");
    for (index, input) in pending.iter().enumerate() {
        if pending.len() > 1 {
            prompt.push_str(&format!("{}.\n", index + 1));
        }
        prompt.push_str(input.content.trim());
        prompt.push_str("\n\n");
    }
    prompt.push_str("Please continue from the current task state and account for this steering.");
    Some(prompt)
}

pub fn drain_pending_runtime_inputs_for_turn(
    conn: &Connection,
    task_id: &str,
) -> rusqlite::Result<Option<(String, Vec<db::AgentRuntimeQueuedInput>)>> {
    let pending = db::list_pending_agent_runtime_inputs(conn, task_id)?;
    let prompt = match build_queued_input_turn_prompt(&pending) {
        Some(prompt) => prompt,
        None => return Ok(None),
    };
    let ids: Vec<String> = pending.iter().map(|input| input.id.clone()).collect();
    db::mark_agent_runtime_inputs_delivered(conn, &ids)?;
    Ok(Some((prompt, pending)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedCliTurnInvocation {
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub delivery: AgentInputDelivery,
}

#[derive(Debug, Clone)]
pub struct ClaudeCliAdapter {
    pub cli_path: String,
    pub model: String,
    pub system_prompt: String,
    pub effort_level: Option<String>,
    pub working_dir: Option<String>,
    pub resume_id: Option<String>,
}

impl ClaudeCliAdapter {
    pub fn new(
        cli_path: impl Into<String>,
        model: impl Into<String>,
        system_prompt: impl Into<String>,
        effort_level: Option<String>,
        working_dir: Option<String>,
        resume_id: Option<String>,
    ) -> Self {
        Self {
            cli_path: cli_path.into(),
            model: model.into(),
            system_prompt: system_prompt.into(),
            effort_level,
            working_dir,
            resume_id,
        }
    }

    pub fn managed_turn_invocation(&self, message: &str) -> ManagedCliTurnInvocation {
        ManagedCliTurnInvocation {
            command: self.cli_path.clone(),
            args: Self::managed_turn_args(
                &self.model,
                &self.system_prompt,
                self.effort_level.as_deref(),
                self.resume_id.as_deref(),
                message,
            ),
            working_dir: self.working_dir.clone(),
            delivery: if self.resume_id.is_some() {
                AgentInputDelivery::ResumeTurn
            } else {
                AgentInputDelivery::NewTurn
            },
        }
    }

    pub fn managed_turn_args(
        model: &str,
        system_prompt: &str,
        effort_level: Option<&str>,
        resume_id: Option<&str>,
        message: &str,
    ) -> Vec<String> {
        let mut args = vec![
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--model".to_string(),
            model.to_string(),
            "--system-prompt".to_string(),
            system_prompt.to_string(),
        ];

        if let Some(effort) = effort_level {
            args.push("--effort".to_string());
            args.push(effort.to_string());
        }

        if let Some(id) = resume_id {
            args.push("--resume".to_string());
            args.push(id.to_string());
        }

        args.push(message.to_string());
        args
    }
}

impl AgentRuntimeAdapter for ClaudeCliAdapter {
    fn adapter_kind(&self) -> AgentAdapterKind {
        AgentAdapterKind::ClaudeCli
    }

    fn runtime_mode(&self) -> AgentRuntimeMode {
        AgentRuntimeMode::Managed
    }

    fn start_turn(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        Ok(if self.resume_id.is_some() {
            AgentInputDelivery::ResumeTurn
        } else {
            AgentInputDelivery::NewTurn
        })
    }

    fn send_input(&mut self, input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        self.start_turn(input)
    }

    fn cancel_turn(&mut self) -> AgentRuntimeResult<()> {
        Ok(())
    }

    fn kill_session(&mut self) -> AgentRuntimeResult<()> {
        self.resume_id = None;
        Ok(())
    }

    fn resume_session(&mut self, session_ref: AgentSessionRef) -> AgentRuntimeResult<()> {
        self.resume_id = session_ref.provider_session_id.or(session_ref.session_id);
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct CodexCliAdapter {
    pub cli_path: String,
    pub model: String,
    pub working_dir: Option<String>,
    pub thread_id: Option<String>,
}

impl CodexCliAdapter {
    pub fn new(
        cli_path: impl Into<String>,
        model: impl Into<String>,
        working_dir: Option<String>,
        thread_id: Option<String>,
    ) -> Self {
        Self {
            cli_path: cli_path.into(),
            model: model.into(),
            working_dir,
            thread_id,
        }
    }

    pub fn managed_turn_invocation(&self, message: &str) -> ManagedCliTurnInvocation {
        ManagedCliTurnInvocation {
            command: self.cli_path.clone(),
            args: Self::managed_turn_args(&self.model, self.thread_id.as_deref(), message),
            working_dir: self.working_dir.clone(),
            delivery: if self.thread_id.is_some() {
                AgentInputDelivery::ResumeTurn
            } else {
                AgentInputDelivery::NewTurn
            },
        }
    }

    pub fn managed_turn_args(model: &str, thread_id: Option<&str>, message: &str) -> Vec<String> {
        let mut args = vec!["exec".to_string()];
        if thread_id.is_some() {
            args.push("resume".to_string());
        }

        args.push("--json".to_string());
        args.push("--skip-git-repo-check".to_string());
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());

        if !model.trim().is_empty() {
            args.push("--model".to_string());
            args.push(model.to_string());
        }

        if let Some(id) = thread_id {
            args.push(id.to_string());
        }

        args.push(message.to_string());
        args
    }
}

impl AgentRuntimeAdapter for CodexCliAdapter {
    fn adapter_kind(&self) -> AgentAdapterKind {
        AgentAdapterKind::CodexCli
    }

    fn runtime_mode(&self) -> AgentRuntimeMode {
        AgentRuntimeMode::Managed
    }

    fn start_turn(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        Ok(if self.thread_id.is_some() {
            AgentInputDelivery::ResumeTurn
        } else {
            AgentInputDelivery::NewTurn
        })
    }

    fn send_input(&mut self, input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        self.start_turn(input)
    }

    fn cancel_turn(&mut self) -> AgentRuntimeResult<()> {
        Ok(())
    }

    fn kill_session(&mut self) -> AgentRuntimeResult<()> {
        self.thread_id = None;
        Ok(())
    }

    fn resume_session(&mut self, session_ref: AgentSessionRef) -> AgentRuntimeResult<()> {
        self.thread_id = session_ref.provider_session_id.or(session_ref.session_id);
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct GenericCliAdapter {
    pub cli_path: String,
    pub working_dir: Option<String>,
    pub tmux_session_name: Option<String>,
    pub is_running: bool,
}

impl GenericCliAdapter {
    pub fn new(
        cli_path: impl Into<String>,
        working_dir: Option<String>,
        tmux_session_name: Option<String>,
    ) -> Self {
        Self {
            cli_path: cli_path.into(),
            working_dir,
            tmux_session_name,
            is_running: false,
        }
    }

    pub fn terminal_turn_invocation(&self, message: &str) -> ManagedCliTurnInvocation {
        ManagedCliTurnInvocation {
            command: self.cli_path.clone(),
            args: if message.trim().is_empty() {
                Vec::new()
            } else {
                vec![message.to_string()]
            },
            working_dir: self.working_dir.clone(),
            delivery: AgentInputDelivery::NewTurn,
        }
    }
}

impl AgentRuntimeAdapter for GenericCliAdapter {
    fn adapter_kind(&self) -> AgentAdapterKind {
        AgentAdapterKind::GenericCli
    }

    fn runtime_mode(&self) -> AgentRuntimeMode {
        AgentRuntimeMode::Terminal
    }

    fn start_turn(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        self.is_running = true;
        Ok(AgentInputDelivery::NewTurn)
    }

    fn send_input(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        Ok(if self.is_running {
            AgentInputDelivery::Live
        } else {
            self.is_running = true;
            AgentInputDelivery::NewTurn
        })
    }

    fn cancel_turn(&mut self) -> AgentRuntimeResult<()> {
        self.is_running = false;
        Ok(())
    }

    fn kill_session(&mut self) -> AgentRuntimeResult<()> {
        self.is_running = false;
        self.tmux_session_name = None;
        Ok(())
    }

    fn resume_session(&mut self, session_ref: AgentSessionRef) -> AgentRuntimeResult<()> {
        self.tmux_session_name = session_ref.tmux_session_name;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct ApiAgentAdapter {
    pub endpoint: Option<String>,
    pub is_running: bool,
}

impl ApiAgentAdapter {
    pub fn new(endpoint: Option<String>) -> Self {
        Self {
            endpoint,
            is_running: false,
        }
    }
}

impl AgentRuntimeAdapter for ApiAgentAdapter {
    fn adapter_kind(&self) -> AgentAdapterKind {
        AgentAdapterKind::Api
    }

    fn runtime_mode(&self) -> AgentRuntimeMode {
        AgentRuntimeMode::Managed
    }

    fn start_turn(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        if self
            .endpoint
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            return Err(AgentRuntimeError::new(
                "API adapter endpoint is not configured",
            ));
        }
        self.is_running = true;
        Ok(AgentInputDelivery::NewTurn)
    }

    fn send_input(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        Ok(if self.is_running {
            AgentInputDelivery::Queued
        } else {
            self.is_running = true;
            AgentInputDelivery::NewTurn
        })
    }

    fn cancel_turn(&mut self) -> AgentRuntimeResult<()> {
        self.is_running = false;
        Ok(())
    }

    fn kill_session(&mut self) -> AgentRuntimeResult<()> {
        self.is_running = false;
        Ok(())
    }

    fn resume_session(&mut self, _session_ref: AgentSessionRef) -> AgentRuntimeResult<()> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct RemoteAgentAdapter {
    pub handle: Option<String>,
    pub is_running: bool,
}

impl RemoteAgentAdapter {
    pub fn new(handle: Option<String>) -> Self {
        Self {
            handle,
            is_running: false,
        }
    }
}

impl AgentRuntimeAdapter for RemoteAgentAdapter {
    fn adapter_kind(&self) -> AgentAdapterKind {
        AgentAdapterKind::Remote
    }

    fn runtime_mode(&self) -> AgentRuntimeMode {
        AgentRuntimeMode::Managed
    }

    fn start_turn(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        if self.handle.as_deref().unwrap_or_default().trim().is_empty() {
            return Err(AgentRuntimeError::new(
                "Remote adapter handle is not configured",
            ));
        }
        self.is_running = true;
        Ok(AgentInputDelivery::NewTurn)
    }

    fn send_input(&mut self, _input: AgentRuntimeInput) -> AgentRuntimeResult<AgentInputDelivery> {
        Ok(if self.is_running {
            AgentInputDelivery::Queued
        } else {
            self.is_running = true;
            AgentInputDelivery::NewTurn
        })
    }

    fn cancel_turn(&mut self) -> AgentRuntimeResult<()> {
        self.is_running = false;
        Ok(())
    }

    fn kill_session(&mut self) -> AgentRuntimeResult<()> {
        self.is_running = false;
        Ok(())
    }

    fn resume_session(&mut self, _session_ref: AgentSessionRef) -> AgentRuntimeResult<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentRuntimeEvent {
    SessionStarted {
        adapter: AgentAdapterKind,
        mode: AgentRuntimeMode,
        provider_session_id: Option<String>,
        model: Option<String>,
        workdir: Option<String>,
    },
    UserInput {
        source: AgentInputSource,
        delivery: AgentInputDelivery,
        content: String,
    },
    AgentStarted {
        adapter: AgentAdapterKind,
        mode: AgentRuntimeMode,
        model: Option<String>,
        cli: Option<String>,
        workdir: Option<String>,
        resumed: bool,
    },
    AgentTextDelta {
        content: String,
    },
    AgentThinkingDelta {
        content: String,
    },
    ToolStarted {
        id: String,
        name: String,
        input: Option<Value>,
    },
    ToolOutput {
        id: String,
        name: Option<String>,
        output: String,
        is_error: bool,
    },
    ToolCompleted {
        id: String,
        name: Option<String>,
        is_error: bool,
    },
    CommandStarted {
        id: String,
        command: String,
    },
    CommandOutput {
        id: String,
        command: Option<String>,
        output: String,
        source: Option<String>,
    },
    CommandCompleted {
        id: String,
        command: Option<String>,
        exit_code: Option<i32>,
        timed_out: bool,
    },
    AgentCompleted {
        exit_code: Option<i32>,
        usage: Option<Value>,
    },
    AgentFailed {
        exit_code: Option<i32>,
        error: Option<String>,
    },
    AgentCancelled {
        reason: Option<String>,
    },
}

impl AgentRuntimeEvent {
    pub fn into_transcript_parts(self) -> (&'static str, Option<String>, Option<String>) {
        match self {
            Self::SessionStarted {
                adapter,
                mode,
                provider_session_id,
                model,
                workdir,
            } => (
                db::EVENT_SESSION_STARTED,
                None,
                Some(metadata_json(json!({
                    "adapter": adapter,
                    "mode": mode,
                    "providerSessionId": provider_session_id,
                    "model": model,
                    "workdir": workdir,
                }))),
            ),
            Self::UserInput {
                source,
                delivery,
                content,
            } => (
                db::EVENT_USER_INPUT,
                Some(content),
                Some(metadata_json(json!({
                    "source": source,
                    "delivery": delivery,
                }))),
            ),
            Self::AgentStarted {
                adapter,
                mode,
                model,
                cli,
                workdir,
                resumed,
            } => (
                db::EVENT_AGENT_STARTED,
                None,
                Some(metadata_json(json!({
                    "adapter": adapter,
                    "mode": mode,
                    "model": model,
                    "cli": cli,
                    "workdir": workdir,
                    "resumeAvailable": resumed,
                }))),
            ),
            Self::AgentTextDelta { content } => (db::EVENT_AGENT_TEXT_DELTA, Some(content), None),
            Self::AgentThinkingDelta { content } => {
                (db::EVENT_AGENT_THINKING_DELTA, Some(content), None)
            }
            Self::ToolStarted { id, name, input } => (
                db::EVENT_TOOL_STARTED,
                None,
                Some(metadata_json(json!({
                    "toolId": id,
                    "toolName": name,
                    "toolInput": input,
                }))),
            ),
            Self::ToolOutput {
                id,
                name,
                output,
                is_error,
            } => (
                db::EVENT_TOOL_OUTPUT,
                Some(output),
                Some(metadata_json(json!({
                    "toolId": id,
                    "toolName": name,
                    "isError": is_error,
                }))),
            ),
            Self::ToolCompleted { id, name, is_error } => (
                db::EVENT_TOOL_COMPLETED,
                None,
                Some(metadata_json(json!({
                    "toolId": id,
                    "toolName": name,
                    "isError": is_error,
                }))),
            ),
            Self::CommandStarted { id, command } => (
                db::EVENT_COMMAND_STARTED,
                None,
                Some(metadata_json(json!({
                    "commandId": id,
                    "command": command,
                }))),
            ),
            Self::CommandOutput {
                id,
                command,
                output,
                source,
            } => (
                db::EVENT_COMMAND_OUTPUT,
                Some(output),
                Some(metadata_json(json!({
                    "commandId": id,
                    "command": command,
                    "source": source,
                }))),
            ),
            Self::CommandCompleted {
                id,
                command,
                exit_code,
                timed_out,
            } => (
                db::EVENT_COMMAND_COMPLETED,
                None,
                Some(metadata_json(json!({
                    "commandId": id,
                    "command": command,
                    "exitCode": exit_code,
                    "timedOut": timed_out,
                }))),
            ),
            Self::AgentCompleted { exit_code, usage } => (
                db::EVENT_AGENT_COMPLETED,
                None,
                Some(metadata_json(json!({
                    "exitCode": exit_code,
                    "usage": usage,
                }))),
            ),
            Self::AgentFailed { exit_code, error } => (
                db::EVENT_AGENT_FAILED,
                error.clone(),
                Some(metadata_json(json!({
                    "exitCode": exit_code,
                    "error": error,
                }))),
            ),
            Self::AgentCancelled { reason } => (
                db::EVENT_AGENT_CANCELLED,
                reason.clone(),
                Some(metadata_json(json!({
                    "reason": reason,
                }))),
            ),
        }
    }
}

pub fn persist_runtime_event(
    conn: &Connection,
    task_id: &str,
    session_id: Option<&str>,
    event: AgentRuntimeEvent,
) -> rusqlite::Result<AgentTranscriptEvent> {
    let (event_type, content, metadata_json) = event.into_transcript_parts();
    db::insert_agent_transcript_event(
        conn,
        task_id,
        session_id,
        event_type,
        content.as_deref(),
        metadata_json.as_deref(),
    )
}

pub fn runtime_events_from_chat_event(event: &ChatEvent) -> Vec<AgentRuntimeEvent> {
    match event {
        ChatEvent::TextContent(content) => vec![AgentRuntimeEvent::AgentTextDelta {
            content: content.clone(),
        }],
        ChatEvent::ThinkingContent {
            content,
            is_complete,
        } => {
            if *is_complete || content.is_empty() {
                Vec::new()
            } else {
                vec![AgentRuntimeEvent::AgentThinkingDelta {
                    content: content.clone(),
                }]
            }
        }
        ChatEvent::ToolUse {
            id,
            name,
            input,
            status,
        } => match status {
            ToolStatus::Running => vec![AgentRuntimeEvent::ToolStarted {
                id: id.clone(),
                name: name.clone(),
                input: input
                    .as_deref()
                    .and_then(|value| serde_json::from_str(value).ok())
                    .or_else(|| input.as_ref().map(|value| json!(value))),
            }],
            ToolStatus::Complete => {
                let mut events = Vec::new();
                if name == "tool_result" {
                    if let Some(output) = input.as_ref().filter(|value| !value.trim().is_empty()) {
                        events.push(AgentRuntimeEvent::ToolOutput {
                            id: id.clone(),
                            name: Some(name.clone()),
                            output: output.clone(),
                            is_error: false,
                        });
                    }
                }
                events.push(AgentRuntimeEvent::ToolCompleted {
                    id: id.clone(),
                    name: Some(name.clone()),
                    is_error: false,
                });
                events
            }
        },
        ChatEvent::CommandStarted { id, command } => vec![AgentRuntimeEvent::CommandStarted {
            id: id.clone(),
            command: command.clone(),
        }],
        ChatEvent::CommandOutput {
            id,
            command,
            output,
            exit_code,
        } => {
            let mut events = Vec::new();
            if !output.is_empty() {
                events.push(AgentRuntimeEvent::CommandOutput {
                    id: id.clone(),
                    command: command.clone(),
                    output: output.clone(),
                    source: Some("structured_runtime".to_string()),
                });
            }
            if exit_code.is_some() {
                events.push(AgentRuntimeEvent::CommandCompleted {
                    id: id.clone(),
                    command: command.clone(),
                    exit_code: *exit_code,
                    timed_out: false,
                });
            }
            events
        }
        ChatEvent::CommandCompleted {
            id,
            command,
            exit_code,
        } => vec![AgentRuntimeEvent::CommandCompleted {
            id: id.clone(),
            command: command.clone(),
            exit_code: *exit_code,
            timed_out: false,
        }],
        ChatEvent::Result(usage) => vec![AgentRuntimeEvent::AgentCompleted {
            exit_code: Some(0),
            usage: usage_json_from_chat_usage(usage),
        }],
        ChatEvent::Complete
        | ChatEvent::SessionId(_)
        | ChatEvent::TurnStarted
        | ChatEvent::RawOutput(_)
        | ChatEvent::Unknown => Vec::new(),
    }
}

pub fn runtime_events_from_provider_json_line(
    adapter: AgentAdapterKind,
    line: &str,
) -> Vec<AgentRuntimeEvent> {
    match provider_runtime_line_from_json(adapter, line) {
        ProviderRuntimeLine::Events(events) => events,
        ProviderRuntimeLine::Completed { exit_code, usage } => {
            vec![AgentRuntimeEvent::AgentCompleted { exit_code, usage }]
        }
        ProviderRuntimeLine::Failed { exit_code, error } => {
            vec![AgentRuntimeEvent::AgentFailed { exit_code, error }]
        }
        ProviderRuntimeLine::Ignored => Vec::new(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderRuntimeLine {
    Events(Vec<AgentRuntimeEvent>),
    Completed {
        exit_code: Option<i32>,
        usage: Option<Value>,
    },
    Failed {
        exit_code: Option<i32>,
        error: Option<String>,
    },
    Ignored,
}

#[derive(Debug, Clone)]
struct ManagedRuntimeStreamParser {
    adapter: AgentAdapterKind,
    claude_blocks: HashMap<i64, ClaudeContentBlock>,
}

#[derive(Debug, Clone)]
enum ClaudeContentBlock {
    Tool {
        id: String,
        name: String,
        input_json: String,
    },
    Other,
}

impl ManagedRuntimeStreamParser {
    fn new(adapter: AgentAdapterKind) -> Self {
        Self {
            adapter,
            claude_blocks: HashMap::new(),
        }
    }

    fn process_line(&mut self, line: &str) -> ProviderRuntimeLine {
        if self.adapter != AgentAdapterKind::ClaudeCli {
            return provider_runtime_line_from_json(self.adapter, line);
        }

        let json: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return ProviderRuntimeLine::Ignored,
        };

        let event = if json.get("type").and_then(Value::as_str) == Some("stream_event") {
            json.get("event").unwrap_or(&json)
        } else {
            &json
        };

        match event.get("type").and_then(Value::as_str) {
            Some("content_block_start") => self.process_claude_content_block_start(event),
            Some("content_block_delta") => self.process_claude_content_block_delta(event),
            Some("content_block_stop") => self.process_claude_content_block_stop(event),
            _ => provider_runtime_line_from_json(self.adapter, line),
        }
    }

    fn process_claude_content_block_start(&mut self, event: &Value) -> ProviderRuntimeLine {
        let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
        let Some(content_block) = event.get("content_block") else {
            return provider_runtime_line_from_json(self.adapter, &event.to_string());
        };

        if content_block.get("type").and_then(Value::as_str) != Some("tool_use") {
            self.claude_blocks.insert(index, ClaudeContentBlock::Other);
            return provider_runtime_line_from_json(self.adapter, &event.to_string());
        }

        let id = content_block
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let name = content_block
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .to_string();
        let input = content_block.get("input").cloned();
        self.claude_blocks.insert(
            index,
            ClaudeContentBlock::Tool {
                id: id.clone(),
                name: name.clone(),
                input_json: String::new(),
            },
        );

        ProviderRuntimeLine::Events(vec![AgentRuntimeEvent::ToolStarted { id, name, input }])
    }

    fn process_claude_content_block_delta(&mut self, event: &Value) -> ProviderRuntimeLine {
        let Some(delta) = event.get("delta") else {
            return provider_runtime_line_from_json(self.adapter, &event.to_string());
        };

        if delta.get("type").and_then(Value::as_str) != Some("input_json_delta") {
            return provider_runtime_line_from_json(self.adapter, &event.to_string());
        }

        let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
        let partial = delta
            .get("partial_json")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(ClaudeContentBlock::Tool { input_json, .. }) =
            self.claude_blocks.get_mut(&index)
        {
            input_json.push_str(partial);
        }
        ProviderRuntimeLine::Ignored
    }

    fn process_claude_content_block_stop(&mut self, event: &Value) -> ProviderRuntimeLine {
        let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
        let Some(block) = self.claude_blocks.remove(&index) else {
            return provider_runtime_line_from_json(self.adapter, &event.to_string());
        };

        match block {
            ClaudeContentBlock::Tool {
                id,
                name,
                input_json,
            } => {
                let mut events = Vec::new();
                if let Some(output) = pretty_tool_input(&input_json) {
                    events.push(AgentRuntimeEvent::ToolOutput {
                        id: id.clone(),
                        name: Some(name.clone()),
                        output,
                        is_error: false,
                    });
                }
                events.push(AgentRuntimeEvent::ToolCompleted {
                    id,
                    name: Some(name),
                    is_error: false,
                });
                ProviderRuntimeLine::Events(events)
            }
            ClaudeContentBlock::Other => {
                provider_runtime_line_from_json(self.adapter, &event.to_string())
            }
        }
    }
}

fn pretty_tool_input(input_json: &str) -> Option<String> {
    let trimmed = input_json.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(trimmed)
        .ok()
        .and_then(|value| serde_json::to_string_pretty(&value).ok())
        .or_else(|| Some(trimmed.to_string()))
}

pub fn provider_runtime_line_from_json(
    adapter: AgentAdapterKind,
    line: &str,
) -> ProviderRuntimeLine {
    let json: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return ProviderRuntimeLine::Ignored,
    };

    match json.get("type").and_then(Value::as_str) {
        Some("system") => {
            let provider_session_id = json
                .get("session_id")
                .or_else(|| json.get("conversation_id"))
                .and_then(Value::as_str)
                .map(str::to_string);
            ProviderRuntimeLine::Events(vec![AgentRuntimeEvent::SessionStarted {
                adapter,
                mode: AgentRuntimeMode::Managed,
                provider_session_id,
                model: json
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                workdir: None,
            }])
        }
        Some("thread.started") => {
            ProviderRuntimeLine::Events(vec![AgentRuntimeEvent::SessionStarted {
                adapter,
                mode: AgentRuntimeMode::Managed,
                provider_session_id: json
                    .get("thread_id")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                model: None,
                workdir: None,
            }])
        }
        Some("turn.started") => {
            ProviderRuntimeLine::Events(vec![AgentRuntimeEvent::AgentStarted {
                adapter,
                mode: AgentRuntimeMode::Managed,
                model: None,
                cli: Some(adapter.default_cli_name().to_string()),
                workdir: None,
                resumed: false,
            }])
        }
        Some("turn.failed") => ProviderRuntimeLine::Failed {
            exit_code: None,
            error: provider_error_message(&json),
        },
        Some("turn.completed") => ProviderRuntimeLine::Completed {
            exit_code: Some(0),
            usage: usage_json_from_value(json.get("usage"), None),
        },
        Some("item.started") | Some("item.completed") if adapter == AgentAdapterKind::CodexCli => {
            match codex_runtime_events_from_item_event(&json) {
                Some(events) => ProviderRuntimeLine::Events(events),
                None => ProviderRuntimeLine::Events(runtime_events_from_chat_event(
                    &parse_json_event(line),
                )),
            }
        }
        Some("result") if provider_result_is_failure(&json) => ProviderRuntimeLine::Failed {
            exit_code: None,
            error: provider_error_message(&json),
        },
        Some("result") => ProviderRuntimeLine::Completed {
            exit_code: Some(0),
            usage: usage_json_from_value(
                json.get("usage"),
                json.get("model").and_then(Value::as_str),
            ),
        },
        Some("message_stop") => ProviderRuntimeLine::Completed {
            exit_code: Some(0),
            usage: None,
        },
        _ => ProviderRuntimeLine::Events(runtime_events_from_chat_event(&parse_json_event(line))),
    }
}

fn codex_runtime_events_from_item_event(json: &Value) -> Option<Vec<AgentRuntimeEvent>> {
    let event_type = json.get("type").and_then(Value::as_str)?;
    let item = json.get("item")?;
    let item_type = item.get("type").and_then(Value::as_str)?;
    let id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    match (event_type, item_type) {
        ("item.completed", "agent_message") => text_from_codex_item(item)
            .map(|content| vec![AgentRuntimeEvent::AgentTextDelta { content }]),
        ("item.started", "command_execution") => {
            let command = item
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Some(vec![AgentRuntimeEvent::CommandStarted { id, command }])
        }
        ("item.completed", "command_execution") => {
            let output = item
                .get("aggregated_output")
                .or_else(|| item.get("output"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let command = item
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_string);
            let exit_code = item
                .get("exit_code")
                .and_then(Value::as_i64)
                .and_then(|value| i32::try_from(value).ok());
            let mut events = Vec::new();
            if !output.is_empty() {
                events.push(AgentRuntimeEvent::CommandOutput {
                    id: id.clone(),
                    command: command.clone(),
                    output,
                    source: Some("codex_jsonl".to_string()),
                });
            }
            events.push(AgentRuntimeEvent::CommandCompleted {
                id,
                command,
                exit_code,
                timed_out: false,
            });
            Some(events)
        }
        ("item.completed", "reasoning") => text_from_codex_item(item)
            .map(|content| vec![AgentRuntimeEvent::AgentThinkingDelta { content }]),
        ("item.started", "tool_call" | "function_call" | "mcp_tool_call") => {
            let name = codex_tool_name(item);
            Some(vec![AgentRuntimeEvent::ToolStarted {
                id,
                name,
                input: codex_tool_input(item),
            }])
        }
        ("item.completed", "tool_call" | "function_call" | "mcp_tool_call") => {
            let name = codex_tool_name(item);
            let mut events = Vec::new();
            if let Some(output) = codex_tool_output(item) {
                events.push(AgentRuntimeEvent::ToolOutput {
                    id: id.clone(),
                    name: Some(name.clone()),
                    output,
                    is_error: provider_result_is_failure(item),
                });
            }
            events.push(AgentRuntimeEvent::ToolCompleted {
                id,
                name: Some(name),
                is_error: provider_result_is_failure(item),
            });
            Some(events)
        }
        _ => None,
    }
}

fn text_from_codex_item(item: &Value) -> Option<String> {
    for key in ["text", "message", "content", "summary"] {
        if let Some(text) = item.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }

    item.get("content")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    part.as_str()
                        .map(str::to_string)
                        .or_else(|| part.get("text").and_then(Value::as_str).map(str::to_string))
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.trim().is_empty())
}

fn codex_tool_name(item: &Value) -> String {
    item.get("name")
        .or_else(|| item.get("tool_name"))
        .or_else(|| {
            item.get("function")
                .and_then(|function| function.get("name"))
        })
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string()
}

fn codex_tool_input(item: &Value) -> Option<Value> {
    item.get("input")
        .or_else(|| item.get("arguments"))
        .or_else(|| {
            item.get("function")
                .and_then(|function| function.get("arguments"))
        })
        .cloned()
}

fn codex_tool_output(item: &Value) -> Option<String> {
    item.get("output")
        .or_else(|| item.get("result"))
        .or_else(|| item.get("content"))
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .filter(|output| !output.trim().is_empty())
}

#[derive(Debug, Clone)]
pub struct ManagedRuntimeTurnConfig {
    pub adapter: AgentAdapterKind,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ManagedRuntimeTurnResult {
    pub exit_code: Option<i32>,
    pub provider_completed: bool,
    pub provider_failed: bool,
}

pub async fn run_managed_runtime_turn<F>(
    config: ManagedRuntimeTurnConfig,
    mut on_event: F,
) -> AgentRuntimeResult<ManagedRuntimeTurnResult>
where
    F: FnMut(AgentRuntimeEvent) + Send,
{
    let mut command = Command::new(&config.command);
    command.args(&config.args);
    if let Some(workdir) = &config.working_dir {
        command.current_dir(workdir);
    }
    command.stdin(std::process::Stdio::null());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        AgentRuntimeError::new(format!("Failed to spawn managed runtime: {}", error))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AgentRuntimeError::new("Failed to capture managed runtime stdout"))?;

    let mut reader = BufReader::new(stdout);
    let mut provider_completion: Option<(Option<i32>, Option<Value>)> = None;
    let mut provider_failure: Option<(Option<i32>, Option<String>)> = None;
    let mut parser = ManagedRuntimeStreamParser::new(config.adapter);

    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).await.map_err(|error| {
            AgentRuntimeError::new(format!("Failed to read managed runtime stdout: {}", error))
        })?;
        if read == 0 {
            break;
        }

        match parser.process_line(&line) {
            ProviderRuntimeLine::Events(events) => {
                for event in events {
                    on_event(event);
                }
            }
            ProviderRuntimeLine::Completed { exit_code, usage } => {
                provider_completion = Some((exit_code, usage));
            }
            ProviderRuntimeLine::Failed { exit_code, error } => {
                provider_failure = Some((exit_code, error));
            }
            ProviderRuntimeLine::Ignored => {}
        }
    }

    let status = child.wait().await.map_err(|error| {
        AgentRuntimeError::new(format!("Failed to wait for managed runtime: {}", error))
    })?;
    let exit_code = status.code();
    let success = status.success();

    if success {
        let (_, usage) = provider_completion.clone().unwrap_or((Some(0), None));
        on_event(AgentRuntimeEvent::AgentCompleted { exit_code, usage });
    } else {
        let (_, error) = provider_failure.clone().unwrap_or((
            exit_code,
            Some(format!("process exited with {:?}", exit_code)),
        ));
        on_event(AgentRuntimeEvent::AgentFailed { exit_code, error });
    }

    Ok(ManagedRuntimeTurnResult {
        exit_code,
        provider_completed: provider_completion.is_some(),
        provider_failed: provider_failure.is_some(),
    })
}

pub async fn run_and_persist_managed_runtime_turn(
    app: &AppHandle,
    task_id: &str,
    session_id: Option<&str>,
    config: ManagedRuntimeTurnConfig,
) -> AgentRuntimeResult<ManagedRuntimeTurnResult> {
    let session_id_for_update = session_id.map(str::to_string);
    run_managed_runtime_turn(config, |event| {
        if let (
            Some(session_id),
            AgentRuntimeEvent::SessionStarted {
                provider_session_id: Some(provider_session_id),
                ..
            },
        ) = (&session_id_for_update, &event)
        {
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                let _ = db::update_agent_session_runtime(
                    &conn,
                    session_id,
                    None,
                    Some("managed"),
                    Some(Some(provider_session_id)),
                    None,
                );
            }
        }
        let _ =
            crate::events::persist_and_emit_agent_runtime_event(app, task_id, session_id, event);
    })
    .await
}

impl AgentAdapterKind {
    fn default_cli_name(self) -> &'static str {
        match self {
            Self::ClaudeCli => "claude",
            Self::CodexCli => "codex",
            Self::GenericCli => "generic",
            Self::Api => "api",
            Self::Remote => "remote",
        }
    }
}

fn usage_json_from_value(usage: Option<&Value>, model: Option<&str>) -> Option<Value> {
    let Some(usage) = usage else {
        return model.map(|model| json!({ "model": model }));
    };
    let mut value = usage.clone();
    if let Some(model) = model {
        if let Value::Object(map) = &mut value {
            map.insert("model".to_string(), Value::String(model.to_string()));
        }
    }
    Some(value)
}

fn usage_json_from_chat_usage(usage: &TokenUsage) -> Option<Value> {
    if usage.input_tokens == 0 && usage.output_tokens == 0 && usage.model.is_none() {
        return None;
    }
    Some(json!({
        "inputTokens": usage.input_tokens,
        "outputTokens": usage.output_tokens,
        "model": usage.model,
    }))
}

fn provider_result_is_failure(json: &Value) -> bool {
    json.get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || matches!(
            json.get("subtype").and_then(Value::as_str),
            Some("error" | "error_max_turns" | "error_during_execution")
        )
}

fn provider_error_message(json: &Value) -> Option<String> {
    json.get("error")
        .or_else(|| json.get("message"))
        .or_else(|| json.get("reason"))
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .or_else(|| {
            json.get("subtype")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn metadata_json(value: Value) -> String {
    let mut object = match value {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("value".to_string(), other);
            map
        }
    };
    object.retain(|_, value| !value.is_null());
    Value::Object(object).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task_with_session(conn: &Connection) -> (String, String) {
        let workspace = db::insert_workspace(conn, "WS", "/tmp").unwrap();
        let column = db::insert_column(conn, &workspace.id, "Working", 0).unwrap();
        let task = db::insert_task(conn, &workspace.id, &column.id, "Task", None).unwrap();
        let session = db::insert_agent_session(conn, &task.id, "claude", Some("/tmp")).unwrap();
        (task.id, session.id)
    }

    #[test]
    fn runtime_events_persist_as_transcript_events() {
        let conn = db::init_test().unwrap();
        let (task_id, session_id) = task_with_session(&conn);

        let started = persist_runtime_event(
            &conn,
            &task_id,
            Some(&session_id),
            AgentRuntimeEvent::SessionStarted {
                adapter: AgentAdapterKind::ClaudeCli,
                mode: AgentRuntimeMode::Managed,
                provider_session_id: Some("claude-session".to_string()),
                model: Some("claude-sonnet-4-6".to_string()),
                workdir: Some("/tmp".to_string()),
            },
        )
        .unwrap();
        let input = persist_runtime_event(
            &conn,
            &task_id,
            Some(&session_id),
            AgentRuntimeEvent::UserInput {
                source: AgentInputSource::UserChat,
                delivery: AgentInputDelivery::ResumeTurn,
                content: "continue".to_string(),
            },
        )
        .unwrap();

        assert_eq!(started.event_type, db::EVENT_SESSION_STARTED);
        assert_eq!(input.event_type, db::EVENT_USER_INPUT);
        assert_eq!(input.content.as_deref(), Some("continue"));

        let events = db::list_agent_transcript_events(&conn, &task_id).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].sequence, 1);
        assert_eq!(events[1].sequence, 2);
        assert!(events[0]
            .metadata_json
            .as_deref()
            .unwrap()
            .contains("claude-session"));
        assert!(events[1]
            .metadata_json
            .as_deref()
            .unwrap()
            .contains("resume_turn"));
    }

    #[test]
    fn runtime_event_mapping_covers_commands_and_cancel() {
        let (event_type, content, metadata) = AgentRuntimeEvent::CommandCompleted {
            id: "cmd-1".to_string(),
            command: Some("cargo test".to_string()),
            exit_code: Some(0),
            timed_out: false,
        }
        .into_transcript_parts();

        assert_eq!(event_type, db::EVENT_COMMAND_COMPLETED);
        assert!(content.is_none());
        let metadata = metadata.unwrap();
        assert!(metadata.contains("cargo test"));
        assert!(metadata.contains("\"exitCode\":0"));

        let (event_type, content, metadata) = AgentRuntimeEvent::AgentCancelled {
            reason: Some("user_stop".to_string()),
        }
        .into_transcript_parts();

        assert_eq!(event_type, db::EVENT_AGENT_CANCELLED);
        assert_eq!(content.as_deref(), Some("user_stop"));
        assert!(metadata.unwrap().contains("user_stop"));
    }

    #[test]
    fn claude_adapter_builds_managed_stream_json_turns() {
        let adapter = ClaudeCliAdapter::new(
            "claude",
            "claude-sonnet-4-6",
            "system",
            Some("medium".to_string()),
            Some("/tmp/ws".to_string()),
            Some("session-123".to_string()),
        );

        let invocation = adapter.managed_turn_invocation("continue");
        assert_eq!(invocation.command, "claude");
        assert_eq!(invocation.working_dir.as_deref(), Some("/tmp/ws"));
        assert_eq!(invocation.delivery, AgentInputDelivery::ResumeTurn);
        assert!(invocation.args.contains(&"--print".to_string()));
        assert!(invocation.args.contains(&"--output-format".to_string()));
        assert!(invocation.args.contains(&"stream-json".to_string()));
        assert!(invocation.args.contains(&"--verbose".to_string()));
        assert!(invocation.args.contains(&"--system-prompt".to_string()));
        assert!(invocation.args.contains(&"--effort".to_string()));
        assert!(invocation.args.contains(&"--resume".to_string()));
        assert!(invocation.args.contains(&"session-123".to_string()));
        assert_eq!(invocation.args.last().unwrap(), "continue");
    }

    #[test]
    fn codex_adapter_builds_managed_jsonl_resume_turns() {
        let adapter = CodexCliAdapter::new(
            "codex",
            "gpt-5.4",
            Some("/tmp/ws".to_string()),
            Some("thread-123".to_string()),
        );

        let invocation = adapter.managed_turn_invocation("continue");
        assert_eq!(invocation.command, "codex");
        assert_eq!(invocation.working_dir.as_deref(), Some("/tmp/ws"));
        assert_eq!(invocation.delivery, AgentInputDelivery::ResumeTurn);
        assert_eq!(&invocation.args[0..2], ["exec", "resume"]);
        assert!(invocation.args.contains(&"--json".to_string()));
        assert!(invocation
            .args
            .contains(&"--skip-git-repo-check".to_string()));
        assert!(invocation
            .args
            .contains(&"--dangerously-bypass-approvals-and-sandbox".to_string()));
        assert!(invocation.args.contains(&"--model".to_string()));
        assert!(invocation.args.contains(&"gpt-5.4".to_string()));
        assert!(invocation.args.contains(&"thread-123".to_string()));
        assert_eq!(invocation.args.last().unwrap(), "continue");
    }

    #[test]
    fn generic_adapter_models_terminal_live_input() {
        let mut adapter = GenericCliAdapter::new(
            "my-agent",
            Some("/tmp/ws".to_string()),
            Some("bentoya_task-1".to_string()),
        );

        assert_eq!(adapter.adapter_kind(), AgentAdapterKind::GenericCli);
        assert_eq!(adapter.runtime_mode(), AgentRuntimeMode::Terminal);
        let invocation = adapter.terminal_turn_invocation("hello");
        assert_eq!(invocation.command, "my-agent");
        assert_eq!(invocation.args, vec!["hello"]);
        assert_eq!(invocation.working_dir.as_deref(), Some("/tmp/ws"));

        let input = AgentRuntimeInput {
            task_id: "task-1".to_string(),
            session_id: Some("session-1".to_string()),
            source: AgentInputSource::UserChat,
            content: "hello".to_string(),
            model: None,
            effort_level: None,
            workdir: Some("/tmp/ws".to_string()),
        };
        assert_eq!(
            adapter.send_input(input.clone()).unwrap(),
            AgentInputDelivery::NewTurn
        );
        assert_eq!(adapter.send_input(input).unwrap(), AgentInputDelivery::Live);
        adapter.kill_session().unwrap();
        assert!(!adapter.is_running);
        assert!(adapter.tmux_session_name.is_none());
    }

    #[test]
    fn api_and_remote_adapters_reserve_managed_queue_semantics() {
        let input = AgentRuntimeInput {
            task_id: "task-1".to_string(),
            session_id: Some("session-1".to_string()),
            source: AgentInputSource::UserChat,
            content: "hello".to_string(),
            model: None,
            effort_level: None,
            workdir: None,
        };

        let mut api = ApiAgentAdapter::new(Some("https://agent.example.test".to_string()));
        assert_eq!(api.adapter_kind(), AgentAdapterKind::Api);
        assert_eq!(api.runtime_mode(), AgentRuntimeMode::Managed);
        assert_eq!(
            api.start_turn(input.clone()).unwrap(),
            AgentInputDelivery::NewTurn
        );
        assert_eq!(
            api.send_input(input.clone()).unwrap(),
            AgentInputDelivery::Queued
        );

        let mut remote = RemoteAgentAdapter::new(Some("remote-worker-1".to_string()));
        assert_eq!(remote.adapter_kind(), AgentAdapterKind::Remote);
        assert_eq!(remote.runtime_mode(), AgentRuntimeMode::Managed);
        assert_eq!(
            remote.start_turn(input.clone()).unwrap(),
            AgentInputDelivery::NewTurn
        );
        assert_eq!(
            remote.send_input(input).unwrap(),
            AgentInputDelivery::Queued
        );
    }

    #[test]
    fn parses_claude_stream_json_to_runtime_events() {
        let session = runtime_events_from_provider_json_line(
            AgentAdapterKind::ClaudeCli,
            r#"{"type":"system","session_id":"claude-session","model":"claude-sonnet"}"#,
        );
        assert!(matches!(
            &session[0],
            AgentRuntimeEvent::SessionStarted {
                provider_session_id,
                adapter: AgentAdapterKind::ClaudeCli,
                ..
            } if provider_session_id.as_deref() == Some("claude-session")
        ));

        let text = runtime_events_from_provider_json_line(
            AgentAdapterKind::ClaudeCli,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}}"#,
        );
        assert!(matches!(
            &text[0],
            AgentRuntimeEvent::AgentTextDelta { content } if content == "hello"
        ));

        let thinking = runtime_events_from_provider_json_line(
            AgentAdapterKind::ClaudeCli,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"plan"}}}"#,
        );
        assert!(matches!(
            &thinking[0],
            AgentRuntimeEvent::AgentThinkingDelta { content } if content == "plan"
        ));

        let result = runtime_events_from_provider_json_line(
            AgentAdapterKind::ClaudeCli,
            r#"{"type":"result","model":"claude-sonnet","usage":{"input_tokens":10,"output_tokens":5}}"#,
        );
        assert!(matches!(
            &result[0],
            AgentRuntimeEvent::AgentCompleted {
                exit_code: Some(0),
                usage: Some(_)
            }
        ));
    }

    #[test]
    fn managed_stream_parser_reconstructs_claude_tool_input_delta() {
        let mut parser = ManagedRuntimeStreamParser::new(AgentAdapterKind::ClaudeCli);

        let started = parser.process_line(
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}}"#,
        );
        assert!(matches!(
            started,
            ProviderRuntimeLine::Events(events)
                if matches!(&events[0], AgentRuntimeEvent::ToolStarted { id, name, .. } if id == "toolu_1" && name == "Read")
        ));

        let delta = parser.process_line(
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\":\"/tmp/task.md\"}"}}}"#,
        );
        assert_eq!(delta, ProviderRuntimeLine::Ignored);

        let stopped = parser.process_line(
            r#"{"type":"stream_event","event":{"type":"content_block_stop","index":1}}"#,
        );
        match stopped {
            ProviderRuntimeLine::Events(events) => {
                assert_eq!(events.len(), 2);
                assert!(matches!(
                    &events[0],
                    AgentRuntimeEvent::ToolOutput {
                        id,
                        name: Some(name),
                        output,
                        is_error: false,
                    } if id == "toolu_1" && name == "Read" && output.contains("file_path")
                ));
                assert!(matches!(
                    &events[1],
                    AgentRuntimeEvent::ToolCompleted {
                        id,
                        name: Some(name),
                        is_error: false,
                    } if id == "toolu_1" && name == "Read"
                ));
            }
            other => panic!("expected tool events, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn managed_runner_emits_claude_tool_details_from_stream_json() {
        use std::sync::{Arc, Mutex};

        let events = Arc::new(Mutex::new(Vec::new()));
        let events_for_callback = Arc::clone(&events);
        let script = concat!(
            "printf '%s\n' '{\"type\":\"system\",\"session_id\":\"claude-session\"}'; ",
            "printf '%s\n' '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"Bash\",\"input\":{}}}}'; ",
            "printf '%s\n' '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}}'; ",
            "printf '%s\n' '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_stop\",\"index\":1}}'; ",
            "printf '%s\n' '{\"type\":\"result\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}'"
        );

        let result = run_managed_runtime_turn(
            ManagedRuntimeTurnConfig {
                adapter: AgentAdapterKind::ClaudeCli,
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), script.to_string()],
                working_dir: None,
            },
            move |event| {
                events_for_callback.lock().unwrap().push(event);
            },
        )
        .await
        .unwrap();

        assert_eq!(result.exit_code, Some(0));
        let events = events.lock().unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            AgentRuntimeEvent::ToolOutput {
                id,
                name: Some(name),
                output,
                is_error: false,
            } if id == "toolu_1" && name == "Bash" && output.contains("pwd")
        )));
        assert!(matches!(
            events.last(),
            Some(AgentRuntimeEvent::AgentCompleted { .. })
        ));
    }

    #[test]
    fn parses_codex_jsonl_to_runtime_events_without_fake_failed_completion() {
        let thread = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"thread.started","thread_id":"thread-1"}"#,
        );
        assert!(matches!(
            &thread[0],
            AgentRuntimeEvent::SessionStarted {
                provider_session_id,
                adapter: AgentAdapterKind::CodexCli,
                ..
            } if provider_session_id.as_deref() == Some("thread-1")
        ));

        let started = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"turn.started"}"#,
        );
        assert!(matches!(
            &started[0],
            AgentRuntimeEvent::AgentStarted {
                adapter: AgentAdapterKind::CodexCli,
                cli,
                ..
            } if cli.as_deref() == Some("codex")
        ));

        let command = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"item.completed","item":{"id":"cmd","type":"command_execution","command":"pwd","aggregated_output":"/tmp\n","exit_code":0}}"#,
        );
        assert_eq!(command.len(), 2);
        assert!(matches!(
            command[0],
            AgentRuntimeEvent::CommandOutput { .. }
        ));
        assert!(matches!(
            command[1],
            AgentRuntimeEvent::CommandCompleted {
                exit_code: Some(0),
                ..
            }
        ));

        let reasoning = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"item.completed","item":{"id":"reasoning-1","type":"reasoning","summary":"checking files"}}"#,
        );
        assert!(matches!(
            &reasoning[0],
            AgentRuntimeEvent::AgentThinkingDelta { content } if content == "checking files"
        ));

        let tool_started = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"item.started","item":{"id":"tool-1","type":"function_call","name":"read_file","arguments":{"path":"/tmp/task.md"}}}"#,
        );
        assert!(matches!(
            &tool_started[0],
            AgentRuntimeEvent::ToolStarted {
                id,
                name,
                input: Some(input),
            } if id == "tool-1" && name == "read_file" && input["path"] == "/tmp/task.md"
        ));

        let tool_completed = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"item.completed","item":{"id":"tool-1","type":"function_call","name":"read_file","output":"file contents"}}"#,
        );
        assert_eq!(tool_completed.len(), 2);
        assert!(matches!(
            &tool_completed[0],
            AgentRuntimeEvent::ToolOutput {
                id,
                name: Some(name),
                output,
                is_error: false,
            } if id == "tool-1" && name == "read_file" && output == "file contents"
        ));
        assert!(matches!(
            &tool_completed[1],
            AgentRuntimeEvent::ToolCompleted {
                id,
                name: Some(name),
                is_error: false,
            } if id == "tool-1" && name == "read_file"
        ));

        let failed = runtime_events_from_provider_json_line(
            AgentAdapterKind::CodexCli,
            r#"{"type":"turn.failed","error":"model error"}"#,
        );
        assert!(matches!(
            &failed[0],
            AgentRuntimeEvent::AgentFailed {
                error: Some(error),
                ..
            } if error == "model error"
        ));
        assert!(!failed
            .iter()
            .any(|event| matches!(event, AgentRuntimeEvent::AgentCompleted { .. })));
    }

    #[tokio::test]
    async fn managed_runner_emits_completion_only_after_process_exit() {
        use std::sync::{Arc, Mutex};

        let events = Arc::new(Mutex::new(Vec::new()));
        let events_for_callback = Arc::clone(&events);
        let script = concat!(
            "printf '%s\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}'; ",
            "printf '%s\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}'"
        );

        let result = run_managed_runtime_turn(
            ManagedRuntimeTurnConfig {
                adapter: AgentAdapterKind::CodexCli,
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), script.to_string()],
                working_dir: None,
            },
            move |event| {
                events_for_callback.lock().unwrap().push(event);
            },
        )
        .await
        .unwrap();

        assert_eq!(result.exit_code, Some(0));
        assert!(result.provider_completed);
        let events = events.lock().unwrap();
        assert!(matches!(
            events[0],
            AgentRuntimeEvent::SessionStarted { .. }
        ));
        assert!(matches!(
            events.last(),
            Some(AgentRuntimeEvent::AgentCompleted { .. })
        ));
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, AgentRuntimeEvent::AgentCompleted { .. }))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn managed_runner_emits_failure_on_process_exit() {
        use std::sync::{Arc, Mutex};

        let events = Arc::new(Mutex::new(Vec::new()));
        let events_for_callback = Arc::clone(&events);
        let script = "printf '%s\n' '{\"type\":\"turn.failed\",\"error\":\"bad turn\"}'; exit 7";

        let result = run_managed_runtime_turn(
            ManagedRuntimeTurnConfig {
                adapter: AgentAdapterKind::CodexCli,
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), script.to_string()],
                working_dir: None,
            },
            move |event| {
                events_for_callback.lock().unwrap().push(event);
            },
        )
        .await
        .unwrap();

        assert_eq!(result.exit_code, Some(7));
        assert!(result.provider_failed);
        let events = events.lock().unwrap();
        assert!(matches!(
            events.last(),
            Some(AgentRuntimeEvent::AgentFailed {
                exit_code: Some(7),
                error: Some(error),
            }) if error == "bad turn"
        ));
    }

    #[test]
    fn maps_chat_events_to_runtime_events() {
        let events = runtime_events_from_chat_event(&ChatEvent::ToolUse {
            id: "tool-1".to_string(),
            name: "Read".to_string(),
            input: Some(r#"{"file":"task.md"}"#.to_string()),
            status: ToolStatus::Running,
        });
        match &events[0] {
            AgentRuntimeEvent::ToolStarted { id, name, input } => {
                assert_eq!(id, "tool-1");
                assert_eq!(name, "Read");
                assert_eq!(input.as_ref().unwrap()["file"], "task.md");
            }
            _ => panic!("expected tool started runtime event"),
        }

        let events = runtime_events_from_chat_event(&ChatEvent::CommandOutput {
            id: "cmd-1".to_string(),
            command: Some("pwd".to_string()),
            output: "/tmp\n".to_string(),
            exit_code: Some(0),
        });
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], AgentRuntimeEvent::CommandOutput { .. }));
        assert!(matches!(
            events[1],
            AgentRuntimeEvent::CommandCompleted { .. }
        ));

        let events = runtime_events_from_chat_event(&ChatEvent::ToolUse {
            id: "tool-result-1".to_string(),
            name: "tool_result".to_string(),
            input: Some("file contents".to_string()),
            status: ToolStatus::Complete,
        });
        assert!(matches!(events[0], AgentRuntimeEvent::ToolOutput { .. }));
        assert!(matches!(events[1], AgentRuntimeEvent::ToolCompleted { .. }));
    }

    #[test]
    fn decides_input_delivery_for_live_queue_resume_and_new_turns() {
        assert_eq!(
            decide_input_delivery(true, true, true),
            AgentInputDelivery::Live
        );
        assert_eq!(
            decide_input_delivery(true, true, false),
            AgentInputDelivery::Queued
        );
        assert_eq!(
            decide_input_delivery(false, true, false),
            AgentInputDelivery::ResumeTurn
        );
        assert_eq!(
            decide_input_delivery(false, false, true),
            AgentInputDelivery::NewTurn
        );
    }

    #[test]
    fn builds_and_drains_queued_input_turn_prompt() {
        let conn = db::init_test().unwrap();
        let (task_id, session_id) = task_with_session(&conn);
        db::enqueue_agent_runtime_input(
            &conn,
            &task_id,
            Some(&session_id),
            "user_chat",
            "please focus on tests",
            Some("sonnet"),
            Some("medium"),
            "queued",
        )
        .unwrap();
        db::enqueue_agent_runtime_input(
            &conn,
            &task_id,
            Some(&session_id),
            "user_chat",
            "also keep the UI compact",
            None,
            None,
            "queued",
        )
        .unwrap();

        let (prompt, inputs) = drain_pending_runtime_inputs_for_turn(&conn, &task_id)
            .unwrap()
            .expect("queued prompt");

        assert_eq!(inputs.len(), 2);
        assert!(prompt.contains("1."));
        assert!(prompt.contains("please focus on tests"));
        assert!(prompt.contains("also keep the UI compact"));
        assert!(db::list_pending_agent_runtime_inputs(&conn, &task_id)
            .unwrap()
            .is_empty());
    }
}
