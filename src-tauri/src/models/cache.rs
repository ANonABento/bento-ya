//! File-based model cache at ~/.bentoya/models-cache.json

use std::fs;
use std::path::PathBuf;

use super::types::ModelsCache;

fn cache_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".bentoya").join("models-cache.json")
}

pub fn load_cache() -> ModelsCache {
    let path = cache_path();
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|e| {
            log::warn!("Failed to parse models cache: {}", e);
            ModelsCache::empty()
        }),
        Err(_) => ModelsCache::empty(),
    }
}

pub fn save_cache(cache: &ModelsCache) -> Result<(), String> {
    let path = cache_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("Failed to serialize models cache: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write models cache: {}", e))?;

    Ok(())
}

/// Check if cache is older than the given duration
pub fn is_stale(cache: &ModelsCache, max_age_hours: u64) -> bool {
    if cache.last_fetched.is_empty() {
        return true;
    }

    match chrono::DateTime::parse_from_rfc3339(&cache.last_fetched) {
        Ok(fetched) => {
            let age = chrono::Utc::now().signed_duration_since(fetched);
            age.num_hours() >= max_age_hours as i64
        }
        Err(_) => true,
    }
}
