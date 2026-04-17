//! Dynamic model registry — fetches available models from provider APIs,
//! enriches with local metadata, caches to disk.

pub mod cache;
pub mod cli_scan;
pub mod fetcher;
pub mod metadata;
pub mod types;

use tauri::Emitter;
use types::{ApiModel, ModelEntry, ModelsCache};

const CACHE_MAX_AGE_HOURS: u64 = 24;

/// Get all available models. Returns cached data immediately.
/// If cache is stale and `force_refresh` is true, fetches fresh data.
#[tauri::command]
pub async fn get_available_models(
    provider: Option<String>,
    force_refresh: bool,
    app: tauri::AppHandle,
) -> Result<ModelsCache, String> {
    let mut cached = cache::load_cache();
    let is_stale = cache::is_stale(&cached, CACHE_MAX_AGE_HOURS);

    if force_refresh || (is_stale && cached.models.is_empty()) {
        // Synchronous refresh — block until we have data
        match refresh_models_inner().await {
            Ok(fresh) => {
                if let Err(e) = cache::save_cache(&fresh) {
                    log::warn!("Failed to save models cache: {}", e);
                }
                // Emit event so frontend knows about the update
                let _ = app.emit("models:updated", &fresh);
                cached = fresh;
            }
            Err(e) => {
                log::warn!("Failed to fetch models: {}", e);
                // If cache is empty, populate with known metadata as fallback
                if cached.models.is_empty() {
                    cached = fallback_from_metadata();
                }
            }
        }
    } else if is_stale {
        // Background refresh — return cached data now, update later
        let app_clone = app.clone();
        tokio::spawn(async move {
            match refresh_models_inner().await {
                Ok(fresh) => {
                    let _ = cache::save_cache(&fresh);
                    let _ = app_clone.emit("models:updated", &fresh);
                }
                Err(e) => log::warn!("Background model refresh failed: {}", e),
            }
        });
    }

    // Filter by provider if requested
    if let Some(ref p) = provider {
        cached.models.retain(|m| m.provider == *p);
    }

    Ok(cached)
}

/// Force refresh models from all configured providers
#[tauri::command]
pub async fn refresh_models(app: tauri::AppHandle) -> Result<ModelsCache, String> {
    let fresh = refresh_models_inner().await?;
    cache::save_cache(&fresh)?;
    let _ = app.emit("models:updated", &fresh);
    Ok(fresh)
}

/// Internal: fetch from all providers and merge with metadata
async fn refresh_models_inner() -> Result<ModelsCache, String> {
    let mut all_models: Vec<ApiModel> = Vec::new();

    // Fetch from Anthropic (if key available)
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        match fetcher::fetch_anthropic_models(&key).await {
            Ok(models) => {
                log::info!("Fetched {} models from Anthropic", models.len());
                all_models.extend(models);
            }
            Err(e) => log::warn!("Anthropic model fetch failed: {}", e),
        }
    }

    // Fetch from OpenAI (if key available)
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        match fetcher::fetch_openai_models(&key).await {
            Ok(models) => {
                log::info!("Fetched {} models from OpenAI", models.len());
                all_models.extend(models);
            }
            Err(e) => log::warn!("OpenAI model fetch failed: {}", e),
        }
    }

    // If API keys returned models, use them
    if !all_models.is_empty() {
        let entries: Vec<ModelEntry> = all_models
            .into_iter()
            .map(|api| {
                let meta = metadata::get_known_metadata(&api.id);
                let is_new = meta.is_none();
                let defaults = metadata::default_metadata(&api.id);
                let m = meta.unwrap_or(&defaults);

                ModelEntry {
                    id: api.id,
                    display_name: api.display_name,
                    provider: api.provider,
                    alias: m.alias.clone(),
                    tier: m.tier,
                    context_window: m.context_window,
                    supports_extended_context: m.supports_extended_context,
                    max_output_tokens: m.max_output_tokens,
                    input_cost_per_m: m.input_cost_per_m,
                    output_cost_per_m: m.output_cost_per_m,
                    capabilities: m.capabilities.clone(),
                    is_new,
                    created_at: api.created_at,
                }
            })
            .collect();

        return Ok(ModelsCache {
            last_fetched: chrono::Utc::now().to_rfc3339(),
            source: types::ModelSource::Api,
            models: entries,
        });
    }

    // No API keys — try CLI binary scan
    let cli_models = scan_cli_binaries();
    if !cli_models.is_empty() {
        log::info!("Discovered {} models from CLI binaries", cli_models.len());
        return Ok(ModelsCache {
            last_fetched: chrono::Utc::now().to_rfc3339(),
            source: types::ModelSource::Cli,
            models: cli_models,
        });
    }

    // Last resort: built-in metadata
    Ok(fallback_from_metadata())
}

/// Scan detected CLI binaries for embedded model IDs.
fn scan_cli_binaries() -> Vec<ModelEntry> {
    use crate::commands::cli_detect;

    let mut models = Vec::new();
    let clis = cli_detect::detect_clis();

    for cli in &clis {
        if !cli.is_available {
            continue;
        }
        let provider = match cli.id.as_str() {
            "claude" => "anthropic",
            "codex" => "openai",
            _ => continue,
        };
        let found = cli_scan::scan_cli_models(&cli.path, provider);
        log::info!("{} CLI scan: {} models from {}", cli.name, found.len(), cli.path);
        models.extend(found);
    }

    models
}

/// Build a cache from known metadata only (no API call).
/// Used when no API keys are configured.
fn fallback_from_metadata() -> ModelsCache {
    use metadata::get_known_metadata;

    let known_ids = [
        ("claude-opus-4-6-20260217", "Claude Opus 4.6", "anthropic"),
        ("claude-sonnet-4-6-20260217", "Claude Sonnet 4.6", "anthropic"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "anthropic"),
        ("gpt-5.4", "GPT-5.4", "openai"),
        ("gpt-5", "GPT-5", "openai"),
        ("gpt-4.1", "GPT-4.1", "openai"),
        ("gpt-4.1-mini", "GPT-4.1 Mini", "openai"),
        ("o3", "o3", "openai"),
        ("o3-mini", "o3 Mini", "openai"),
        ("o1", "o1", "openai"),
        ("codex-5.3", "Codex 5.3", "openai"),
        ("codex-5.3-spark", "Codex 5.3 Spark", "openai"),
        ("codex-5.2", "Codex 5.2", "openai"),
    ];

    let models = known_ids
        .iter()
        .filter_map(|(id, name, provider)| {
            let meta = get_known_metadata(id)?;
            Some(ModelEntry {
                id: id.to_string(),
                display_name: name.to_string(),
                provider: provider.to_string(),
                alias: meta.alias.clone(),
                tier: meta.tier,
                context_window: meta.context_window,
                supports_extended_context: meta.supports_extended_context,
                max_output_tokens: meta.max_output_tokens,
                input_cost_per_m: meta.input_cost_per_m,
                output_cost_per_m: meta.output_cost_per_m,
                capabilities: meta.capabilities.clone(),
                is_new: false,
                created_at: None,
            })
        })
        .collect();

    ModelsCache {
        last_fetched: String::new(),
        source: types::ModelSource::BuiltIn,
        models,
    }
}
