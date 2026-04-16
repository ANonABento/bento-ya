# Dynamic Model Discovery — Implementation Plan

> **Status:** Planned
> **Existing ticket:** `.tickets/dynamic-model-discovery.md`
> **Priority:** High (blocks accurate cost tracking, UX quality)

## Problem

Model definitions are hardcoded in **5 separate locations** that drift independently:

| Location | What's hardcoded | Risk |
|----------|-----------------|------|
| `src-tauri/src/llm/types.rs` | Model IDs, aliases, pricing | Wrong cost calculations |
| `src-tauri/src/commands/cli_detect.rs` | Capabilities (context window, effort levels) | Missing features for new models |
| `src/components/settings/tabs/agent-tab.tsx` | Full model IDs per provider | Users can't select new models |
| `src/components/shared/model-selector.tsx` | Fallback model list | Stale defaults |
| `src/hooks/use-model-capabilities.ts` | Fallback capabilities | Same as above |

**Already broken:** Haiku ID mismatch — backend has `claude-haiku-3-5-20250615`, frontend has `claude-haiku-4-5-20251115`.

When a new model drops (e.g. Opus 4.7), users can't use it until we ship an app update. That's unacceptable.

---

## Phase 1: Dynamic Model Fetching (Core)

**Goal:** New models appear automatically. Zero code changes needed.

### 1.1 — Rust: Model Registry Service

**New module:** `src-tauri/src/models/`

```
src-tauri/src/models/
├── mod.rs          # Public API: get_models(), refresh_models()
├── cache.rs        # File-based cache (~/.bentoya/models-cache.json)
├── fetcher.rs      # API calls to Anthropic/OpenAI
├── metadata.rs     # Local metadata overlay (pricing, capabilities)
└── types.rs        # ModelEntry, ModelCache, ModelMetadata
```

**Core types:**
```rust
/// What we get from the API
struct ApiModel {
    id: String,              // "claude-opus-4-6-20260217"
    display_name: String,    // "Claude Opus 4.6"
    provider: Provider,      // Anthropic | OpenAI
    created_at: DateTime,
}

/// Local enrichment (things APIs don't tell us)
struct ModelMetadata {
    alias: Option<String>,          // "opus" — for CLI shorthand
    tier: ModelTier,                // Flagship | Standard | Fast
    context_window: u32,            // 200_000
    supports_extended_context: bool,
    max_output_tokens: u32,
    input_cost_per_m: f64,
    output_cost_per_m: f64,
    capabilities: Vec<String>,      // ["vision", "tools", "thinking"]
}

/// Merged result
struct ModelEntry {
    api: ApiModel,
    meta: Option<ModelMetadata>,    // None = unknown new model
    is_new: bool,                   // true if no local metadata match
}
```

**Cache strategy:**
- Startup: load from `~/.bentoya/models-cache.json` (instant, non-blocking)
- If cache > 24h old: background refresh via `tokio::spawn`
- On refresh: emit Tauri event `models:updated` so frontend reacts
- Manual: "Check Now" button in settings triggers `force_refresh`
- Cache includes `last_fetched` timestamp for display

**API calls:**
- Anthropic: `GET https://api.anthropic.com/v1/models` (header: `x-api-key`)
- OpenAI: `GET https://api.openai.com/v1/models` (header: `Authorization: Bearer`)
- Filter: only chat/completion models (skip embeddings, legacy, etc.)
- Timeout: 10s per provider, independent — one failing doesn't block the other

### 1.2 — Rust: Local Metadata Overlay

**File:** `src-tauri/src/models/metadata.rs`

Since APIs don't return pricing or capability details, maintain a local metadata map:

```rust
/// Known model metadata — updated with app releases but NOT required
static KNOWN_METADATA: LazyLock<HashMap<&str, ModelMetadata>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert("claude-opus-4-6-20260217", ModelMetadata {
        alias: Some("opus"),
        tier: ModelTier::Flagship,
        context_window: 200_000,
        supports_extended_context: true,
        max_output_tokens: 32_000,
        input_cost_per_m: 15.0,
        output_cost_per_m: 75.0,
        capabilities: vec!["vision", "tools", "thinking"],
    });
    // ... sonnet, haiku, codex models
    m
});
```

**Unknown model handling:**
- Models from API with no metadata match get sensible defaults:
  - Tier inferred from name ("opus" → Flagship, "haiku" → Fast, else Standard)
  - Context window: 200k (safe Anthropic default)
  - Pricing: `None` (show "pricing unavailable" in UI)
  - Capabilities: `["tools"]` (conservative default)
- Flagged as `is_new: true` → UI shows a "New" badge

### 1.3 — Tauri Commands

```rust
#[tauri::command]
async fn get_available_models(provider: Option<String>, force_refresh: bool)
    -> Result<Vec<ModelEntry>, Error>;

#[tauri::command]
async fn get_model_metadata(model_id: String) -> Result<Option<ModelMetadata>, Error>;
```

### 1.4 — Frontend: Hook Refactor

**Replace** `use-model-capabilities.ts` internals:

```typescript
// Before: hardcoded fallback
const FALLBACK_MODELS = [{ id: 'opus', ... }]

// After: calls backend, which handles cache + API
const { models, isLoading, lastUpdated, refresh } = useModels(provider)
```

- `useModels(provider?)` → calls `get_available_models` IPC
- Listens for `models:updated` Tauri event for background refreshes
- No more hardcoded fallbacks — the cache IS the fallback

### 1.5 — Frontend: Update Consumers

Remove hardcoded model lists from:
- `agent-tab.tsx` — replace `PROVIDER_INFO.models` with `useModels()`
- `model-selector.tsx` — remove `FALLBACK_MODELS`, use hook
- `chat-input.tsx` — use hook for capability checks
- `panel-input.tsx` — use hook for model list

### 1.6 — Remove Stale Hardcoding

- **Delete** `ANTHROPIC_MODELS` const from `types.rs` — replaced by metadata overlay
- **Refactor** `resolve_model_id()` to use registry instead of static array
- **Refactor** `build_claude_capabilities()` in `cli_detect.rs` to use registry
- **Keep** `calculate_cost()` but source pricing from metadata overlay

---

## Phase 2: Smart Defaults & UX Polish

**Goal:** The UI is helpful even for models we've never seen before.

### 2.1 — Model Tier Auto-Detection

Infer tier from model name patterns when metadata is missing:
- Contains "opus" → Flagship
- Contains "sonnet" or "codex-5.3" → Standard
- Contains "haiku" or "spark" → Fast
- Unknown → Standard (safe default)

This drives:
- Default thinking level (high/medium/low)
- Extended context availability
- Cost warnings

### 2.2 — "New Model" Badge + Notification

When a background refresh discovers a model not in cache:
- Toast notification: "New model available: Claude Opus 4.7"
- "New" badge on model selector until user selects it once
- Optional: Discord notification via Choomfie (for the choom who wants to know immediately)

### 2.3 — Model Comparison View

Settings page addition:
- Side-by-side capability comparison
- Pricing comparison table
- "Last used" and "total tokens" per model from usage tracking

### 2.4 — Settings: Refresh Controls

In the settings agent tab:
- "Last updated: 2h ago" timestamp
- "Check Now" button with spinner
- Toggle: "Auto-check for new models" (default: on)
- Cache TTL setting (default: 24h)

---

## Phase 3: Provider Extensibility (Future)

**Goal:** Support arbitrary LLM providers beyond Anthropic/OpenAI.

### 3.1 — Provider Plugin Interface

```rust
trait ModelProvider {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn fetch_models(&self, api_key: &str) -> Result<Vec<ApiModel>>;
    fn default_metadata(&self) -> ModelMetadata;  // provider-level defaults
}
```

Built-in: `AnthropicProvider`, `OpenAIProvider`

### 3.2 — OpenRouter / LiteLLM Support

- OpenRouter: `GET https://openrouter.ai/api/v1/models` (includes pricing!)
- LiteLLM: `GET /models` on configured proxy URL
- Advantage: these APIs return pricing data, reducing need for local metadata

### 3.3 — Custom Provider Registration

Settings UI to add custom providers:
- Base URL, API key env var, model list endpoint
- Custom header configuration
- Test connection button

### 3.4 — Model Aliasing

User-defined aliases in settings:
```json
{
  "aliases": {
    "fast": "claude-haiku-4-5-20251115",
    "smart": "claude-opus-4-6-20260217",
    "cheap": "codex-5.2"
  }
}
```

Usable in orchestrator chat: "use fast for this task"

---

## Phase 4: Cost Intelligence (Future)

**Goal:** Help users make informed model choices.

### 4.1 — Live Pricing Updates

For providers that expose pricing (OpenRouter), auto-update pricing data.
For Anthropic/OpenAI, check a community pricing JSON (or scrape docs).

### 4.2 — Cost Estimation Before Execution

Before running a task:
- Estimate token count from context
- Show projected cost per model
- Suggest cheaper model if task is simple

### 4.3 — Budget Alerts

- Per-session, per-day, per-workspace spending limits
- Warning at 80%, hard stop at 100% (configurable)
- Spending dashboard in settings

---

## Implementation Order

```
Phase 1 (Core)           ~1-2 days
├── 1.1 Model registry    Rust module + cache
├── 1.2 Metadata overlay   Local enrichment
├── 1.3 Tauri commands     IPC bridge
├── 1.4 Hook refactor      useModels()
├── 1.5 Update consumers   Remove hardcoded lists
└── 1.6 Cleanup            Delete stale constants

Phase 2 (Polish)         ~0.5 day
├── 2.1 Tier detection     Smart defaults
├── 2.2 New model badge    Notification
├── 2.3 Comparison view    Settings UI
└── 2.4 Refresh controls   Settings UI

Phase 3 (Extensibility)  ~1-2 days (future)
├── 3.1 Provider trait     Plugin interface
├── 3.2 OpenRouter         Extra provider
├── 3.3 Custom providers   Settings UI
└── 3.4 Model aliasing     User shortcuts

Phase 4 (Cost)           ~1 day (future)
├── 4.1 Live pricing       Auto-update
├── 4.2 Cost estimation    Pre-execution
└── 4.3 Budget alerts      Spending limits
```

---

## Files Changed (Phase 1)

### New
- `src-tauri/src/models/mod.rs`
- `src-tauri/src/models/cache.rs`
- `src-tauri/src/models/fetcher.rs`
- `src-tauri/src/models/metadata.rs`
- `src-tauri/src/models/types.rs`
- `src/hooks/use-models.ts`
- `src/lib/ipc/models.ts`

### Modified
- `src-tauri/src/main.rs` — register new commands
- `src-tauri/src/llm/types.rs` — remove hardcoded `ANTHROPIC_MODELS`, refactor `resolve_model_id()`
- `src-tauri/src/commands/cli_detect.rs` — refactor `build_claude_capabilities()`
- `src/components/settings/tabs/agent-tab.tsx` — remove `PROVIDER_INFO`, use `useModels()`
- `src/components/shared/model-selector.tsx` — remove `FALLBACK_MODELS`, use hook
- `src/hooks/use-model-capabilities.ts` — rewrite to use new backend
- `src/components/panel/shared/chat-input.tsx` — use hook for capabilities
- `src/components/panel/panel-input.tsx` — use hook for model list

### Deleted (cleanup)
- Nothing deleted, but large sections of hardcoded model data removed from existing files

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| API key not configured → can't fetch | Cache works offline; fallback to metadata-only mode (known models still work) |
| API rate limit / downtime | 24h cache TTL means one successful fetch per day is enough |
| New model with breaking API changes | Conservative defaults for unknown models; `is_new` flag for UI warning |
| Pricing data stale | Show "last updated" in UI; manual refresh available; Phase 4 automates this |
| OpenAI returns 1000+ models | Filter by capability (chat completions only), sort by created_at desc |
