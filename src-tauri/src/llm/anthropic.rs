//! Anthropic Claude API client with streaming support

use crate::llm::types::{LlmRequest, LlmResponse, Message, StreamChunk, TokenUsage};
use futures::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Anthropic Claude streaming client
pub struct AnthropicClient {
    client: Client,
    api_key: String,
}

impl AnthropicClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
        }
    }

    /// Stream a chat completion, sending chunks through the channel
    pub async fn stream_chat(
        &self,
        request: LlmRequest,
        tx: mpsc::Sender<StreamChunk>,
    ) -> Result<LlmResponse, String> {
        // Extract system message if present
        let (system_prompt, messages): (Option<String>, Vec<&Message>) = {
            let mut system = None;
            let msgs: Vec<_> = request
                .messages
                .iter()
                .filter(|m| {
                    if m.role == "system" {
                        system = Some(m.content.clone());
                        false
                    } else {
                        true
                    }
                })
                .collect();
            (system, msgs)
        };

        // Build request body
        let mut body = json!({
            "model": request.model,
            "messages": messages.iter().map(|m| json!({
                "role": m.role,
                "content": m.content,
            })).collect::<Vec<_>>(),
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "stream": true,
        });

        if let Some(system) = system_prompt {
            body["system"] = json!(system);
        }

        if let Some(temp) = request.temperature {
            body["temperature"] = json!(temp);
        }

        // Send request
        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {}: {}", status, body));
        }

        // Parse SSE stream
        let mut stream = response.bytes_stream();
        let mut accumulated = String::new();
        let mut usage = TokenUsage::default();
        let mut finish_reason = String::from("stop");
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            // Process complete SSE lines
            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }

                    match serde_json::from_str::<Value>(data) {
                        Ok(event) => {
                            self.process_sse_event(&event, &mut accumulated, &mut usage, &mut finish_reason, &tx).await;
                        }
                        Err(e) => {
                            log::warn!("Failed to parse SSE event: {} - data: {}", e, data);
                        }
                    }
                }
            }
        }

        // Send final chunk with finish reason
        let _ = tx
            .send(StreamChunk {
                delta: String::new(),
                finish_reason: Some(finish_reason.clone()),
            })
            .await;

        Ok(LlmResponse {
            content: accumulated,
            usage,
            model: request.model,
            finish_reason,
        })
    }

    async fn process_sse_event(
        &self,
        event: &Value,
        accumulated: &mut String,
        usage: &mut TokenUsage,
        finish_reason: &mut String,
        tx: &mpsc::Sender<StreamChunk>,
    ) {
        let event_type = event["type"].as_str().unwrap_or("");

        match event_type {
            "message_start" => {
                // Extract input tokens from message_start
                if let Some(msg_usage) = event["message"]["usage"].as_object() {
                    usage.input_tokens = msg_usage
                        .get("input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                }
            }
            "content_block_delta" => {
                // Extract text delta
                if let Some(delta_text) = event["delta"]["text"].as_str() {
                    accumulated.push_str(delta_text);
                    let _ = tx
                        .send(StreamChunk {
                            delta: delta_text.to_string(),
                            finish_reason: None,
                        })
                        .await;
                }
            }
            "message_delta" => {
                // Extract stop reason and output tokens
                if let Some(reason) = event["delta"]["stop_reason"].as_str() {
                    *finish_reason = reason.to_string();
                }
                if let Some(msg_usage) = event["usage"].as_object() {
                    usage.output_tokens = msg_usage
                        .get("output_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                }
            }
            "message_stop" => {
                // Stream complete
            }
            "error" => {
                if let Some(error) = event["error"].as_object() {
                    let msg = error
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    log::error!("Anthropic stream error: {}", msg);
                }
            }
            _ => {}
        }
    }
}

/// Get API key from environment
pub fn get_api_key() -> Result<String, String> {
    std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| "ANTHROPIC_API_KEY environment variable not set".to_string())
}

/// Calculate cost in USD for Anthropic models
pub fn calculate_cost(model: &str, usage: &TokenUsage) -> f64 {
    // Pricing per million tokens (as of 2025)
    let (input_price, output_price) = if model.contains("opus") {
        (15.0, 75.0)
    } else if model.contains("sonnet") {
        (3.0, 15.0)
    } else if model.contains("haiku") {
        (0.25, 1.25)
    } else {
        (3.0, 15.0) // Default to Sonnet pricing
    };

    let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * input_price;
    let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * output_price;

    input_cost + output_cost
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_cost() {
        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
        };

        let cost = calculate_cost("claude-sonnet-4-6-20260217", &usage);
        // 1000 input * 3/1M + 500 output * 15/1M = 0.003 + 0.0075 = 0.0105
        assert!((cost - 0.0105).abs() < 0.0001);
    }
}
