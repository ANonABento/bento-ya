# Spec — Rate-limit-aware task parking + auto-resume

**Origin:** 2026-05-10, prompted by Slothing audit overnight run hitting Claude 5h usage limit. Retries succeeded but tasks stayed `idle` because the underlying agent was still rate-limited. User asked for a "park safely + auto-resume when rate limit clears" feature.

## Problem

When an agent (Claude / codex) hits a provider rate limit during a Setup / Plan / Working / Verify stage:

1. The agent process exits non-zero with a rate-limit error message in stderr
2. The pipeline marks the task as failed (or sometimes silently leaves `pipeline_state = idle`)
3. Manual `retry_task` clears the error but the next run hits the SAME rate limit
4. User has to babysit the pipeline, retrying every X hours until the window resets

Result: pipeline appears running but is wasting cycles, OR pipeline appears dead when it's just throttled.

## Goal

When a task's agent run fails due to a provider rate limit:
1. Detect that it's specifically a rate-limit error (not a code bug or other transient failure)
2. Park the task in a `rate_limited` state (new `pipeline_state` value)
3. Compute the reset time (from `Retry-After` header / API error body / heuristic floor)
4. Schedule auto-resume at reset time + small jitter
5. Surface state in the frontend (chip / tooltip / countdown)

## Detection signatures

Agents log to `last_output` (stderr captured). Regex patterns to detect rate-limited exits:

### Anthropic (Claude)
- `"rate_limit"` in error JSON
- `"You've reached your usage limit"` in plain text
- HTTP 429 + body containing `"error.type": "rate_limit_error"`
- Stderr contains `"Error: 429"` or `"rate-limited"` or `"reached your 5h limit"`

### OpenAI / OpenRouter (codex)
- HTTP 429 + body with `"error.code": "rate_limit_exceeded"`
- Stderr contains `"Rate limit reached"` or `"insufficient_quota"`

### Heuristic floor
- If detection fires but no concrete reset time → default park = **3 hours** (Claude 5h window divided to be cautious; agent retries earlier if available)

## Schema additions

`tasks` table:
- `pipeline_state` enum: add new value `rate_limited`
- New column `rate_limited_until: TEXT NULL` — ISO-8601 datetime when auto-resume should fire
- New column `rate_limited_reason: TEXT NULL` — short string ("anthropic-5h", "openrouter-quota") for UI

## Auto-resume mechanism

Every N seconds (e.g. 60s), the pipeline tick scans for tasks where:
```
pipeline_state = 'rate_limited' AND rate_limited_until <= NOW()
```

For each, set `pipeline_state = 'idle'` and re-fire the trigger for the current column (same as retry_task).

Add jitter (±60s) so 5 simultaneously-parked tasks don't all fire the same second and hit the limit again.

## Frontend surfacing

Task card chip:
- `Rate-limited` chip with countdown: "auto-resume in 2h 14m"
- On hover: full reason ("anthropic-5h limit hit at 14:31, resumes 19:31")
- Click → manual "retry now" button (force-fires regardless of countdown)

Board-level banner:
- "3 tasks rate-limited" → tap to filter board to show them

## Per-provider integration

The detection logic should live in `src-tauri/src/pipeline/agent_runner.rs` (or wherever agent stderr is parsed). Add a `RateLimitDetection` enum:
```rust
enum RateLimitDetection {
    None,
    Anthropic { resumes_at: DateTime<Utc> },
    OpenAI { resumes_at: DateTime<Utc> },
    Generic { resumes_at: DateTime<Utc> }, // heuristic floor
}
```

`resumes_at` parsing:
- Anthropic 5h windows reset at fixed wall-clock time per account → if API returns reset time, use it; otherwise add 5h to the failing run's start
- OpenAI returns `Retry-After` in seconds → add to NOW
- Generic floor → 3 hours from NOW

## Manual override

User should always be able to:
- Click "retry now" on a rate-limited card to force a re-attempt (in case the limit cleared early or it was a false-positive detection)
- Move the task to a different column (drag-drop) to change context — preserves rate-limited state if same agent

## Acceptance

- [ ] New `pipeline_state` value `rate_limited`
- [ ] New columns `rate_limited_until`, `rate_limited_reason` on tasks table
- [ ] DB migration adds columns
- [ ] Agent runner detects Anthropic + OpenAI rate-limit signatures in stderr
- [ ] Failed agent with rate-limit signature → task moved to `rate_limited` state, NOT `failed`
- [ ] Pipeline tick scans + auto-resumes tasks past their `rate_limited_until`
- [ ] Frontend renders the new state with countdown chip + reason tooltip
- [ ] Manual "retry now" button on rate-limited cards force-fires the trigger
- [ ] At least 2 unit tests for detection signatures (Anthropic 429, OpenAI 429)
- [ ] At least 1 integration test for auto-resume after the timer elapses
- [ ] `cargo build` clean
- [ ] No regression on existing pipeline tests

## Out of scope

- Cross-provider routing (if Claude is rate-limited, fail over to codex) — separate spec
- User-set rate-limit budgets (cap N tasks/hour) — separate
- Multi-account fan-out — separate
- Predictive throttling (slow down before hitting limit) — separate

## Severity

**High value, medium urgency** — current pipeline silently stalls under rate limits, requiring human babysitting. After this lands, the overnight runs are truly autonomous through provider limits. Slothing's audit pipeline (10+ in-flight tasks) directly benefits.
