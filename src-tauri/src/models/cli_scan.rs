//! Scan CLI binaries for embedded model IDs.
//! This discovers models without needing API keys — works offline.

use std::collections::HashSet;
use std::process::Command;

use super::metadata;
use super::types::{ModelEntry, ModelTier};

/// Scan a CLI binary for embedded model IDs and return discovered models.
/// Uses `strings` to extract printable strings and regex-matches model patterns.
pub fn scan_cli_models(cli_path: &str, provider: &str) -> Vec<ModelEntry> {
    let raw = match extract_strings(cli_path) {
        Some(s) => s,
        None => return Vec::new(),
    };

    match provider {
        "anthropic" => parse_anthropic_models(&raw),
        "openai" => parse_openai_models(&raw),
        _ => Vec::new(),
    }
}

/// Run `strings` on a binary and return the output
fn extract_strings(path: &str) -> Option<String> {
    let output = Command::new("strings")
        .arg(path)
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

/// Parse Anthropic model IDs from strings output.
/// Matches patterns like `claude-opus-4-6-20260217` and deduplicates.
fn parse_anthropic_models(raw: &str) -> Vec<ModelEntry> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();

        // Match full model IDs: claude-{family}-{version}[-date]
        // Skip: -v1 suffixes, internal/legacy models, partial matches
        if !trimmed.starts_with("claude-") {
            continue;
        }

        // Filter out noise
        if trimmed.contains("code-") || trimmed.contains("instant-") {
            continue;
        }
        // Skip -v1 variants (same model, different endpoint)
        if trimmed.ends_with("-v1") {
            continue;
        }
        // Must contain a version number after the family name
        let parts: Vec<&str> = trimmed.split('-').collect();
        if parts.len() < 3 {
            continue;
        }
        // The third part should be a number (version)
        if !parts[2].chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            continue;
        }
        // Skip very short partial matches like "claude-sonnet-4-"
        if trimmed.ends_with('-') {
            continue;
        }

        if seen.contains(trimmed) {
            continue;
        }
        seen.insert(trimmed.to_string());

        // Build display name from the ID
        let display_name = humanize_claude_id(trimmed);

        // Check metadata for enrichment
        let meta = metadata::get_known_metadata(trimmed);
        let defaults = metadata::default_metadata(trimmed);
        let m = meta.unwrap_or(&defaults);

        models.push(ModelEntry {
            id: trimmed.to_string(),
            display_name,
            provider: "anthropic".to_string(),
            alias: m.alias.clone(),
            tier: m.tier,
            context_window: m.context_window,
            supports_extended_context: m.supports_extended_context,
            max_output_tokens: m.max_output_tokens,
            input_cost_per_m: m.input_cost_per_m,
            output_cost_per_m: m.output_cost_per_m,
            capabilities: m.capabilities.clone(),
            is_new: meta.is_none(),
            created_at: None,
        });
    }

    // Sort: flagship first, then by name
    models.sort_by(|a, b| {
        let tier_ord = |t: &ModelTier| match t {
            ModelTier::Flagship => 0,
            ModelTier::Standard => 1,
            ModelTier::Fast => 2,
        };
        tier_ord(&a.tier).cmp(&tier_ord(&b.tier)).then(b.id.cmp(&a.id))
    });

    models
}

/// Parse OpenAI/Codex model IDs from strings output.
/// Model IDs are often embedded in JSON-like strings (e.g. `"slug": "gpt-5.3-codex"`),
/// so we scan for patterns anywhere in the text, not just line starts.
fn parse_openai_models(raw: &str) -> Vec<ModelEntry> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for candidate in extract_openai_ids(raw) {
        let normalized = normalize_openai_id(&candidate);

        if seen.contains(&normalized) {
            continue;
        }
        seen.insert(normalized.clone());

        let display_name = humanize_openai_id(&normalized);

        let meta = metadata::get_known_metadata(&normalized);
        let defaults = metadata::default_metadata(&normalized);
        let m = meta.unwrap_or(&defaults);

        models.push(ModelEntry {
            id: normalized,
            display_name,
            provider: "openai".to_string(),
            alias: m.alias.clone(),
            tier: m.tier,
            context_window: m.context_window,
            supports_extended_context: m.supports_extended_context,
            max_output_tokens: m.max_output_tokens,
            input_cost_per_m: m.input_cost_per_m,
            output_cost_per_m: m.output_cost_per_m,
            capabilities: m.capabilities.clone(),
            is_new: meta.is_none(),
            created_at: None,
        });
    }

    models.sort_by(|a, b| {
        let tier_ord = |t: &ModelTier| match t {
            ModelTier::Flagship => 0,
            ModelTier::Standard => 1,
            ModelTier::Fast => 2,
        };
        tier_ord(&a.tier).cmp(&tier_ord(&b.tier)).then(b.id.cmp(&a.id))
    });

    models
}

/// Normalize OpenAI model IDs.
/// "gpt-5.3-codex" → "codex-5.3", "gpt-5.1-codex-mini" → "codex-5.1-mini"
fn normalize_openai_id(id: &str) -> String {
    // gpt-X.Y-codex[-suffix] → codex-X.Y[-suffix]
    if id.starts_with("gpt-") && id.contains("-codex") {
        let without_gpt = &id[4..]; // "5.3-codex" or "5.3-codex-mini"
        if let Some(codex_pos) = without_gpt.find("-codex") {
            let version = &without_gpt[..codex_pos]; // "5.3"
            let suffix = &without_gpt[codex_pos + 6..]; // "" or "-mini" or "-max"
            return format!("codex-{}{}", version, suffix);
        }
    }
    id.to_string()
}

/// Convert "claude-opus-4-6-20260217" → "Claude Opus 4.6"
fn humanize_claude_id(id: &str) -> String {
    let without_prefix = id.strip_prefix("claude-").unwrap_or(id);
    let parts: Vec<&str> = without_prefix.split('-').collect();

    if parts.len() >= 3 {
        let family = capitalize(parts[0]);
        // Check if there's a minor version
        let version = if parts[1].len() == 1 && parts.len() > 2 && parts[2].len() == 1 {
            format!("{}.{}", parts[1], parts[2])
        } else {
            parts[1].to_string()
        };
        // If there's a date suffix, include it in parens
        let date = parts.iter().find(|p| p.len() == 8 && p.chars().all(|c| c.is_ascii_digit()));
        if let Some(d) = date {
            format!("Claude {} {} ({})", family, version, d)
        } else {
            format!("Claude {} {}", family, version)
        }
    } else {
        format!("Claude {}", capitalize(without_prefix))
    }
}

/// Convert "codex-5.3" → "Codex 5.3", "o3" → "o3"
fn humanize_openai_id(id: &str) -> String {
    if id.starts_with("o1") || id.starts_with("o3") {
        return id.to_string();
    }
    id.split('-')
        .enumerate()
        .map(|(i, part)| if i == 0 { capitalize(part) } else { part.to_string() })
        .collect::<Vec<_>>()
        .join(" ")
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().to_string() + c.as_str(),
    }
}

/// Extract OpenAI model IDs from raw strings output.
/// Scans for `gpt-*` and `o3`/`o1` patterns anywhere in the text,
/// since they may be embedded in JSON (e.g. `"slug": "gpt-5.3-codex"`).
fn extract_openai_ids(raw: &str) -> Vec<String> {
    let mut ids = Vec::new();

    // Find all gpt-* patterns
    for (i, _) in raw.match_indices("gpt-") {
        let rest = &raw[i..];
        let end = rest
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '.')
            .unwrap_or(rest.len());
        let candidate = &rest[..end];

        // Validate
        if candidate.len() > 4
            && candidate.len() < 25
            && !candidate.contains("oss")
            && !candidate.ends_with('-')
            && !candidate.ends_with('.')
            && !candidate.contains("transcribe")
        {
            ids.push(candidate.to_string());
        }
    }

    // Find o3/o1 patterns — look for quoted versions to avoid false positives
    for pattern in &["\"o3\"", "\"o1\"", "\"o3-", "\"o1-"] {
        for (i, _) in raw.match_indices(pattern) {
            let start = i + 1; // skip opening quote
            let rest = &raw[start..];
            let end = rest.find('"').unwrap_or(rest.len());
            let candidate = &rest[..end];
            if candidate.len() <= 10
                && !candidate.is_empty()
                && candidate
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                ids.push(candidate.to_string());
            }
        }
    }

    ids
}
