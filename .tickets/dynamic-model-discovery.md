# Dynamic Model Discovery

Automatically fetch available models from Anthropic/OpenAI APIs so new models (e.g., GPT-5.4, Claude 5) appear immediately without app updates.

## APIs

- **Anthropic:** `GET https://api.anthropic.com/v1/models`
  - Returns: `id`, `display_name`, `created_at`
- **OpenAI:** `GET https://api.openai.com/v1/models`
  - Returns: `id`, `created`, `owned_by`

## Strategy

**Cache + Background Refresh + Manual Button**

1. **On app startup:** Load cached models instantly (no blocking)
2. **If cache > 24h old:** Background refresh
3. **In settings:** "Check Now" button for manual refresh
4. **Show "last updated" timestamp**

## Storage

```
~/.bentoya/models-cache.json
{
  "lastFetched": "2024-03-05T12:00:00Z",
  "anthropic": [
    { "id": "claude-opus-4-5-20251101", "displayName": "Claude Opus 4.5", "createdAt": "..." }
  ],
  "openai": [...]
}
```

## Implementation

### Rust Backend

```rust
#[tauri::command]
async fn get_available_models(force_refresh: bool) -> Result<ModelsCache, Error> {
    let cache = load_cache()?;
    let is_stale = cache.last_fetched < (now() - 24h);

    if force_refresh || is_stale {
        tokio::spawn(async {
            let fresh = fetch_all_models().await;
            save_cache(&fresh);
            app.emit("models:updated", &fresh);
        });
    }
    Ok(cache)
}

async fn fetch_all_models() -> ModelsCache {
    let anthropic = fetch_anthropic_models().await;
    let openai = fetch_openai_models().await;
    ModelsCache { lastFetched: now(), anthropic, openai }
}
```

### Frontend

- On startup: `getAvailableModels(false)` - instant cached
- Settings page: Display cached, listen for `models:updated` event
- "Check Now" button: `getAvailableModels(true)` - shows spinner

### Local Metadata Merge

Since APIs don't return pricing/context window, merge with local metadata:

```typescript
const MODEL_METADATA: Record<string, ModelMeta> = {
  'claude-opus-4-5-20251101': {
    contextWindow: 200000,
    inputPrice: 15,    // per 1M tokens
    outputPrice: 75,
    capabilities: ['vision', 'tools', 'thinking'],
    tier: 'powerful'
  },
  // ... known models
}

// Unknown models get default metadata + "New" badge
```

## Files

- `src-tauri/src/models/mod.rs` - fetch + cache logic
- `src-tauri/src/commands/models.rs` - Tauri command
- `src/lib/models-cache.ts` - frontend cache access
- `src/components/settings/model-selector.tsx` - updated UI

## Effort

~200 lines, standalone feature
