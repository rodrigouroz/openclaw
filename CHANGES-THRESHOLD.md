# Dynamic Relevance Threshold for Memory Search

## Overview

This PR adds dynamic threshold filtering to Clawdbot's hybrid search system. Instead of returning all search results regardless of quality, the system now intelligently filters out low-relevance results based on the quality of the top match.

## Problem

Previously, memory search would return all results up to the limit, even if many were only loosely relevant. This led to context pollution where the agent would receive low-quality matches that could mislead or distract from the actual relevant information.

## Solution

Implement a dynamic threshold that adapts based on query confidence (as measured by the top result's score):

| Query Confidence | Top Score Range | Threshold Formula | Example |
|-----------------|-----------------|-------------------|---------|
| High | ≥ 0.7 | `topScore × 0.5` | 0.8 → 0.40 |
| Medium | 0.3 - 0.7 | `topScore × 0.6` | 0.5 → 0.30 |
| Low | < 0.3 | `0.15` (floor) | 0.2 → 0.15 |

### Why these thresholds?

- **High confidence (50% of top)**: When we have a strong match, we can be more aggressive about filtering. A result scoring half of the top is likely still relevant.
- **Medium confidence (60% of top)**: More conservative filtering since even the top result isn't a slam dunk.
- **Low confidence (absolute floor)**: When everything scores low, use a fixed floor to avoid filtering everything out while still removing noise.

## Changes

### `src/memory/hybrid.ts`

- Added `calculateDynamicThreshold(topScore: number): number` - Pure function implementing the threshold logic
- Added `applyDynamicThreshold<T>(results: T[], enabled: boolean): T[]` - Generic filter function
- Modified `mergeHybridResults()` to accept optional `dynamicThreshold?: boolean` parameter
- Threshold filtering is applied after hybrid merge, before returning results

### `src/memory/__tests__/dynamic-threshold.test.ts`

Comprehensive test suite covering:
- Threshold calculation for all confidence tiers
- Edge cases (zero scores, negative scores, scores > 1.0)
- Filter behavior when enabled/disabled
- Empty result handling
- Integration with `mergeHybridResults()`
- Full pipeline realistic scenarios

## Usage

```typescript
const results = mergeHybridResults({
  vector: vectorResults,
  keyword: keywordResults,
  vectorWeight: 0.7,
  textWeight: 0.3,
  dynamicThreshold: true, // Enable filtering
});
```

When `dynamicThreshold` is `false` or omitted, behavior is unchanged (all results returned).

## Testing

```bash
pnpm test src/memory/__tests__/dynamic-threshold.test.ts
```

## Future Considerations

- Make threshold multipliers configurable via memory manager options
- Add telemetry to measure filter effectiveness
- Consider per-source thresholds (e.g., different thresholds for conversation vs. knowledge base)
