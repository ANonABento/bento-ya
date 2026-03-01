# T036: Metrics Data Collection

## Summary

The metrics dashboard UI is complete but no code creates usage records. Wire up data collection so the dashboard shows real data.

## Current State

- `src/components/usage/metrics-dashboard.tsx` — full UI implemented
- `usage_records` table exists in database
- **Zero code paths that INSERT into usage_records**
- Dashboard always shows "No usage data recorded yet"

## Acceptance Criteria

- [ ] Record LLM API calls: model, tokens (input/output), cost, latency
- [ ] Record per workspace and per task
- [ ] Record agent session metrics: duration, success/failure, iterations
- [ ] Record voice transcription usage (already has Whisper calls)
- [ ] Aggregate by time period (day/week/month)
- [ ] Cost calculation based on model pricing
- [ ] Dashboard queries and displays real data
- [ ] Export usage data as CSV/JSON

## Technical Notes

```rust
// After each LLM call in T033:
insert_usage_record(UsageRecord {
    workspace_id,
    task_id: Option<i64>,
    provider: "openai",
    model: "gpt-4",
    input_tokens: 1500,
    output_tokens: 500,
    cost_usd: 0.045,
    latency_ms: 2300,
    created_at: now(),
})
```

## Dependencies

- T033 (LLM Integration) — primary source of usage data

## Complexity

**S** — Simple inserts after API calls, aggregation queries
