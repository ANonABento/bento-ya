//! Types for the dynamic model registry

use serde::{Deserialize, Serialize};

/// A model discovered from a provider API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiModel {
    pub id: String,
    pub display_name: String,
    pub provider: String,
    pub created_at: Option<String>,
}

/// Model tier inferred from name or metadata
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelTier {
    Flagship,
    Standard,
    Fast,
}

/// Local metadata for a model (pricing, capabilities, etc.)
/// APIs don't return this, so we maintain it locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetadata {
    pub alias: Option<String>,
    pub tier: ModelTier,
    pub context_window: u32,
    pub supports_extended_context: bool,
    pub max_output_tokens: u32,
    pub input_cost_per_m: Option<f64>,
    pub output_cost_per_m: Option<f64>,
    pub capabilities: Vec<String>,
}

/// A fully resolved model entry (API data + local metadata)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub display_name: String,
    pub provider: String,
    pub alias: Option<String>,
    pub tier: ModelTier,
    pub context_window: u32,
    pub supports_extended_context: bool,
    pub max_output_tokens: u32,
    pub input_cost_per_m: Option<f64>,
    pub output_cost_per_m: Option<f64>,
    pub capabilities: Vec<String>,
    /// True if this model has no known local metadata
    pub is_new: bool,
    pub created_at: Option<String>,
}

/// How the model list was obtained
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelSource {
    /// Fetched from provider REST APIs
    Api,
    /// Scanned from CLI binary
    Cli,
    /// Built-in metadata only (no detection)
    BuiltIn,
}

/// Cached models for all providers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsCache {
    pub last_fetched: String,
    pub source: ModelSource,
    pub models: Vec<ModelEntry>,
}

impl ModelsCache {
    pub fn empty() -> Self {
        Self {
            last_fetched: String::new(),
            source: ModelSource::BuiltIn,
            models: Vec::new(),
        }
    }
}
