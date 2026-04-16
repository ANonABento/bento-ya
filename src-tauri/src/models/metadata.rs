//! Local model metadata — enriches API-discovered models with pricing, capabilities, etc.
//! Updated with app releases but NOT required for new models to appear.

use std::collections::HashMap;
use std::sync::LazyLock;

use super::types::{ModelMetadata, ModelTier};

/// Known model metadata keyed by full API model ID.
/// New models without an entry here still appear — they just get inferred defaults.
static KNOWN_METADATA: LazyLock<HashMap<&'static str, ModelMetadata>> = LazyLock::new(|| {
    let mut m = HashMap::new();

    // ── Anthropic ────────────────────────────────────────────────────────
    m.insert("claude-opus-4-6-20260217", ModelMetadata {
        alias: Some("opus".into()),
        tier: ModelTier::Flagship,
        context_window: 200_000,
        supports_extended_context: true,
        max_output_tokens: 32_000,
        input_cost_per_m: Some(15.0),
        output_cost_per_m: Some(75.0),
        capabilities: vec!["vision".into(), "tools".into(), "thinking".into()],
    });
    m.insert("claude-sonnet-4-6-20260217", ModelMetadata {
        alias: Some("sonnet".into()),
        tier: ModelTier::Standard,
        context_window: 200_000,
        supports_extended_context: false,
        max_output_tokens: 16_000,
        input_cost_per_m: Some(3.0),
        output_cost_per_m: Some(15.0),
        capabilities: vec!["vision".into(), "tools".into(), "thinking".into()],
    });
    m.insert("claude-haiku-4-5-20251001", ModelMetadata {
        alias: Some("haiku".into()),
        tier: ModelTier::Fast,
        context_window: 200_000,
        supports_extended_context: false,
        max_output_tokens: 8_192,
        input_cost_per_m: Some(0.80),
        output_cost_per_m: Some(4.0),
        capabilities: vec!["vision".into(), "tools".into()],
    });

    // ── OpenAI ───────────────────────────────────────────────────────────
    m.insert("gpt-5.4", ModelMetadata {
        alias: None,
        tier: ModelTier::Flagship,
        context_window: 256_000,
        supports_extended_context: false,
        max_output_tokens: 32_000,
        input_cost_per_m: Some(10.0),
        output_cost_per_m: Some(30.0),
        capabilities: vec!["vision".into(), "tools".into(), "thinking".into()],
    });
    m.insert("gpt-5", ModelMetadata {
        alias: Some("gpt5".into()),
        tier: ModelTier::Flagship,
        context_window: 256_000,
        supports_extended_context: false,
        max_output_tokens: 32_000,
        input_cost_per_m: Some(10.0),
        output_cost_per_m: Some(30.0),
        capabilities: vec!["vision".into(), "tools".into(), "thinking".into()],
    });
    m.insert("gpt-4.1", ModelMetadata {
        alias: None,
        tier: ModelTier::Standard,
        context_window: 1_048_576,
        supports_extended_context: false,
        max_output_tokens: 32_768,
        input_cost_per_m: Some(2.0),
        output_cost_per_m: Some(8.0),
        capabilities: vec!["vision".into(), "tools".into()],
    });
    m.insert("gpt-4.1-mini", ModelMetadata {
        alias: None,
        tier: ModelTier::Fast,
        context_window: 1_048_576,
        supports_extended_context: false,
        max_output_tokens: 32_768,
        input_cost_per_m: Some(0.40),
        output_cost_per_m: Some(1.60),
        capabilities: vec!["vision".into(), "tools".into()],
    });
    m.insert("o3", ModelMetadata {
        alias: None,
        tier: ModelTier::Flagship,
        context_window: 200_000,
        supports_extended_context: false,
        max_output_tokens: 100_000,
        input_cost_per_m: Some(10.0),
        output_cost_per_m: Some(40.0),
        capabilities: vec!["vision".into(), "tools".into(), "thinking".into()],
    });
    m.insert("o3-mini", ModelMetadata {
        alias: None,
        tier: ModelTier::Fast,
        context_window: 200_000,
        supports_extended_context: false,
        max_output_tokens: 100_000,
        input_cost_per_m: Some(1.10),
        output_cost_per_m: Some(4.40),
        capabilities: vec!["tools".into(), "thinking".into()],
    });
    m.insert("o1", ModelMetadata {
        alias: None,
        tier: ModelTier::Standard,
        context_window: 200_000,
        supports_extended_context: false,
        max_output_tokens: 100_000,
        input_cost_per_m: Some(15.0),
        output_cost_per_m: Some(60.0),
        capabilities: vec!["vision".into(), "tools".into(), "thinking".into()],
    });
    m.insert("codex-5.3", ModelMetadata {
        alias: Some("codex".into()),
        tier: ModelTier::Standard,
        context_window: 192_000,
        supports_extended_context: false,
        max_output_tokens: 16_000,
        input_cost_per_m: Some(2.0),
        output_cost_per_m: Some(8.0),
        capabilities: vec!["tools".into()],
    });
    m.insert("codex-5.3-spark", ModelMetadata {
        alias: None,
        tier: ModelTier::Fast,
        context_window: 192_000,
        supports_extended_context: false,
        max_output_tokens: 16_000,
        input_cost_per_m: Some(0.50),
        output_cost_per_m: Some(2.0),
        capabilities: vec!["tools".into()],
    });
    m.insert("codex-5.2", ModelMetadata {
        alias: None,
        tier: ModelTier::Standard,
        context_window: 128_000,
        supports_extended_context: false,
        max_output_tokens: 16_000,
        input_cost_per_m: Some(2.0),
        output_cost_per_m: Some(8.0),
        capabilities: vec!["tools".into()],
    });

    m
});

/// Look up known metadata for a model ID
pub fn get_known_metadata(model_id: &str) -> Option<&'static ModelMetadata> {
    KNOWN_METADATA.get(model_id)
}

/// Infer model tier from the model ID string when no metadata is known
pub fn infer_tier(model_id: &str) -> ModelTier {
    let id = model_id.to_lowercase();
    if id.contains("opus") || id.contains("gpt-5") {
        ModelTier::Flagship
    } else if id.contains("haiku") || id.contains("spark") || id.contains("mini") {
        ModelTier::Fast
    } else {
        ModelTier::Standard
    }
}

/// Build default metadata for an unknown model
pub fn default_metadata(model_id: &str) -> ModelMetadata {
    let tier = infer_tier(model_id);
    ModelMetadata {
        alias: None,
        tier,
        context_window: 200_000,
        supports_extended_context: false,
        max_output_tokens: 16_000,
        input_cost_per_m: None,
        output_cost_per_m: None,
        capabilities: vec!["tools".into()],
    }
}

/// Resolve a model alias (e.g. "opus") to a full API model ID.
/// Searches known metadata for matching aliases.
pub fn resolve_alias(alias: &str) -> Option<&'static str> {
    for (id, meta) in KNOWN_METADATA.iter() {
        if meta.alias.as_deref() == Some(alias) {
            return Some(id);
        }
    }
    None
}

/// Get pricing for a model (input_cost_per_m, output_cost_per_m).
/// Returns None if model is unknown.
pub fn get_pricing(model_id: &str) -> Option<(f64, f64)> {
    get_known_metadata(model_id).and_then(|m| {
        match (m.input_cost_per_m, m.output_cost_per_m) {
            (Some(input), Some(output)) => Some((input, output)),
            _ => None,
        }
    })
}
