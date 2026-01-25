export type HybridSource = string;

export type HybridVectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  vectorScore: number;
};

export type HybridKeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  textScore: number;
};

export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Calculates the dynamic relevance threshold based on the top result score.
 *
 * The threshold adapts to query confidence:
 * - High confidence (topScore >= 0.7): threshold = topScore * 0.5
 * - Medium confidence (topScore >= 0.3): threshold = topScore * 0.6
 * - Low confidence (topScore < 0.3): threshold = 0.15 (absolute floor)
 *
 * @param topScore - The score of the highest-ranked result
 * @returns The calculated threshold value
 */
export function calculateDynamicThreshold(topScore: number): number {
  if (topScore >= 0.7) {
    return topScore * 0.5;
  }
  if (topScore >= 0.3) {
    return topScore * 0.6;
  }
  return 0.15;
}

/**
 * Applies dynamic threshold filtering to search results.
 * Filters out results below the calculated threshold based on the top score.
 *
 * @param results - Sorted array of search results (highest score first)
 * @param dynamicThreshold - Whether to apply dynamic threshold filtering
 * @returns Filtered results array
 */
export function applyDynamicThreshold<T extends { score: number }>(
  results: T[],
  dynamicThreshold: boolean,
): T[] {
  if (!dynamicThreshold || results.length === 0) {
    return results;
  }

  const topScore = results[0].score;
  const threshold = calculateDynamicThreshold(topScore);

  return results.filter((r) => r.score >= threshold);
}

export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
  dynamicThreshold?: boolean;
}): Array<{
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: HybridSource;
}> {
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: HybridSource;
      snippet: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) existing.snippet = r.snippet;
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  const merged = Array.from(byId.values()).map((entry) => {
    const score = params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore;
    return {
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
      source: entry.source,
    };
  });

  const sorted = merged.sort((a, b) => b.score - a.score);

  // Apply dynamic threshold filtering
  return applyDynamicThreshold(sorted, params.dynamicThreshold ?? false);
}
