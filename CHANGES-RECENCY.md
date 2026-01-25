# PR: Add Recency Boost for Vector Search

## Summary

This PR adds a configurable recency boost feature to Clawdbot's vector search. When enabled, recently updated documents receive a scoring advantage over older documents, helping ensure that fresh information surfaces more prominently in search results.

## Changes

### Configuration (`src/config/types.tools.ts`)

Added new `recency` configuration block under `memorySearch.query`:

```typescript
query?: {
  // ... existing options
  recency?: {
    /** Enable recency boost (default: false). */
    enabled?: boolean;
    /** Maximum penalty for old documents (default: 0.08). */
    lambda?: number;
    /** Window in days for full penalty (default: 14). */
    windowDays?: number;
  };
};
```

### Resolved Configuration (`src/agents/memory-search.ts`)

- Added `RecencyConfig` to `ResolvedMemorySearchConfig`
- Added default values:
  - `DEFAULT_RECENCY_ENABLED = false`
  - `DEFAULT_RECENCY_LAMBDA = 0.08`
  - `DEFAULT_RECENCY_WINDOW_DAYS = 14`
- Added merge logic with proper validation (lambda clamped 0-1, windowDays clamped 1-365)

### Search Implementation (`src/memory/manager-search.ts`)

- Added `RecencyConfig` type export
- Added `calculateRecencyPenalty()` function implementing the formula:
  ```
  penalty = lambda * min(1, daysSince(updatedAt) / windowDays)
  ```
- Updated `searchVector()` to:
  - Accept optional `recency` parameter
  - Fetch `updated_at` from chunks table
  - Apply recency penalty to vector scores
  - Re-sort results after penalty application
- Updated `listChunks()` to include `updatedAt` field

### Manager Integration (`src/memory/manager.ts`)

- Passes `recency` config from settings to `searchVector()`

## How It Works

The recency boost applies a **penalty** to older documents, which is **subtracted** from the vector similarity score:

```
final_score = max(0, vector_score - penalty)
```

Where:
- `penalty = lambda * min(1, days_since_update / windowDays)`
- Documents updated today: no penalty (0)
- Documents at half the window (7 days with default 14-day window): half penalty (0.04 with default lambda)
- Documents older than window: max penalty (lambda, default 0.08)

This approach:
- Gives recent documents a scoring advantage
- Still allows highly relevant old documents to surface (0.08 max penalty is modest)
- Degrades gracefully for null/missing timestamps (no penalty applied)
- Handles edge cases like future timestamps (no penalty)

## Configuration Example

```yaml
agents:
  main:
    memorySearch:
      query:
        recency:
          enabled: true
          lambda: 0.08      # Max penalty for old docs (0-1)
          windowDays: 14    # Days until max penalty
```

## Test Coverage

Added comprehensive tests in `src/memory/__tests__/recency-boost.test.ts`:

1. **Basic penalty calculations**:
   - Document updated today (0 penalty)
   - Document from 1 hour ago (~0 penalty)
   - Document from 7 days ago (half penalty = 0.04)
   - Document from 14+ days ago (max penalty = 0.08)

2. **Edge cases**:
   - Null updatedAt (0 penalty)
   - Undefined updatedAt (0 penalty)
   - Future timestamps (0 penalty)
   - Zero lambda (disabled)
   - Fractional days

3. **Custom configuration**:
   - Custom lambda values
   - Custom windowDays values
   - Small window edge cases

4. **Integration scenarios**:
   - Newer vs older documents with same similarity
   - High relevance old doc vs low relevance new doc
   - Score clamping to non-negative

## Breaking Changes

None. The feature is disabled by default (`enabled: false`).

## Notes

- The penalty is applied after vector similarity calculation but before final ranking
- When recency is enabled, results are re-sorted after penalty application
- Works with both sqlite-vec accelerated path and fallback cosine similarity path
