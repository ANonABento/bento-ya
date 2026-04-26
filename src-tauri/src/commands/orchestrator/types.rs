use std::collections::HashMap;

use crate::db::{ChatMessage, Column, Task};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorContext {
    pub workspace_id: String,
    pub workspace_name: String,
    pub columns: Vec<Column>,
    pub tasks: Vec<Task>,
    pub recent_messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorAction {
    pub action_type: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub column_id: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorResponse {
    pub message: String,
    pub actions: Vec<OrchestratorAction>,
    pub tasks_created: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorEvent {
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub event_type: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamChunkPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub delta: String,
    pub finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use: Option<ToolUsePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolUsePayload {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolResultPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub tool_use_id: String,
    pub result: String,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ThinkingPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub content: String,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolCallPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Default)]
pub struct ApiStreamRegistry {
    handles: Mutex<HashMap<String, AbortHandle>>,
}

impl ApiStreamRegistry {
    pub(super) async fn insert(&self, key: String, handle: AbortHandle) {
        let mut handles = self.handles.lock().await;
        if let Some(previous) = handles.insert(key, handle) {
            previous.abort();
        }
    }

    pub(super) async fn abort(&self, key: &str) -> bool {
        let mut handles = self.handles.lock().await;
        if let Some(handle) = handles.remove(key) {
            handle.abort();
            true
        } else {
            false
        }
    }

    pub(super) async fn remove(&self, key: &str) {
        self.handles.lock().await.remove(key);
    }

    #[cfg(test)]
    async fn len(&self) -> usize {
        self.handles.lock().await.len()
    }
}

pub(super) fn api_stream_key(workspace_id: &str, session_id: &str) -> String {
    format!("chef-api:{}:{}", workspace_id, session_id)
}

#[cfg(test)]
mod tests {
    use super::{api_stream_key, ApiStreamRegistry};

    #[test]
    fn test_api_stream_key() {
        assert_eq!(
            api_stream_key("ws-1", "session-1"),
            "chef-api:ws-1:session-1"
        );
    }

    #[tokio::test]
    async fn test_api_stream_registry_abort() {
        let registry = ApiStreamRegistry::default();
        let handle = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });

        registry
            .insert("stream-1".to_string(), handle.abort_handle())
            .await;
        assert_eq!(registry.len().await, 1);

        assert!(registry.abort("stream-1").await);
        assert_eq!(registry.len().await, 0);
        assert!(handle.await.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn test_api_stream_registry_replaces_existing_handle() {
        let registry = ApiStreamRegistry::default();
        let first = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        let second = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });

        registry
            .insert("stream-1".to_string(), first.abort_handle())
            .await;
        registry
            .insert("stream-1".to_string(), second.abort_handle())
            .await;

        assert_eq!(registry.len().await, 1);
        assert!(first.await.unwrap_err().is_cancelled());

        assert!(registry.abort("stream-1").await);
        assert!(second.await.unwrap_err().is_cancelled());
    }
}
