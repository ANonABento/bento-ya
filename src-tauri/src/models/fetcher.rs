//! Fetches available models from provider APIs

use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

use super::types::ApiModel;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

// ── Anthropic ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModel>,
}

#[derive(Deserialize)]
struct AnthropicModel {
    id: String,
    display_name: String,
    created_at: Option<String>,
    #[serde(rename = "type")]
    model_type: Option<String>,
}

pub async fn fetch_anthropic_models(api_key: &str) -> Result<Vec<ApiModel>, String> {
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Anthropic API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, body));
    }

    let data: AnthropicModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic models response: {}", e))?;

    Ok(data
        .data
        .into_iter()
        .filter(|m| {
            // Only include chat models, not embeddings/legacy
            m.model_type.as_deref() != Some("embedding")
        })
        .map(|m| ApiModel {
            id: m.id,
            display_name: m.display_name,
            provider: "anthropic".into(),
            created_at: m.created_at,
        })
        .collect())
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModel>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OpenAIModel {
    id: String,
    created: Option<i64>,
    owned_by: Option<String>,
}

pub async fn fetch_openai_models(api_key: &str) -> Result<Vec<ApiModel>, String> {
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, body));
    }

    let data: OpenAIModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI models response: {}", e))?;

    // Filter to relevant models (codex, gpt, o-series)
    Ok(data
        .data
        .into_iter()
        .filter(|m| {
            let id = m.id.to_lowercase();
            id.starts_with("codex") || id.starts_with("gpt") || id.starts_with("o1") || id.starts_with("o3")
        })
        .map(|m| {
            let display_name = humanize_model_id(&m.id);
            ApiModel {
                id: m.id,
                display_name,
                provider: "openai".into(),
                created_at: m.created.map(|ts| {
                    chrono::DateTime::from_timestamp(ts, 0)
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                        .unwrap_or_default()
                }),
            }
        })
        .collect())
}

/// Convert a model ID like "codex-5.3" into a display name like "Codex 5.3"
fn humanize_model_id(id: &str) -> String {
    id.split('-')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                let mut c = part.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().to_string() + c.as_str(),
                }
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
