import type { DatabaseSync } from "node:sqlite";

import { truncateUtf16Safe } from "../utils.js";
import { cosineSimilarity, parseEmbedding } from "./internal.js";

const vectorToBlob = (embedding: number[]): Buffer =>
  Buffer.from(new Float32Array(embedding).buffer);

export type SearchSource = string;

export type SearchRowResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: SearchSource;
};

export type RecencyConfig = {
  enabled: boolean;
  lambda: number;
  windowDays: number;
};

/**
 * Calculate recency penalty for a document based on its age.
 * Formula: lambda * min(1, daysSince(updatedAt) / windowDays)
 *
 * @param updatedAt - Unix timestamp (ms) of when the document was updated
 * @param now - Current Unix timestamp (ms)
 * @param lambda - Maximum penalty (0-1)
 * @param windowDays - Window in days for full penalty
 * @returns Penalty to subtract from score (0 to lambda)
 */
export function calculateRecencyPenalty(
  updatedAt: number | null | undefined,
  now: number,
  lambda: number,
  windowDays: number,
): number {
  // No penalty if updatedAt is null/undefined or in the future
  if (updatedAt == null || updatedAt > now) return 0;

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSince = (now - updatedAt) / msPerDay;
  const ratio = Math.min(1, daysSince / windowDays);
  return lambda * ratio;
}

export async function searchVector(params: {
  db: DatabaseSync;
  vectorTable: string;
  providerModel: string;
  queryVec: number[];
  limit: number;
  snippetMaxChars: number;
  ensureVectorReady: (dimensions: number) => Promise<boolean>;
  sourceFilterVec: { sql: string; params: SearchSource[] };
  sourceFilterChunks: { sql: string; params: SearchSource[] };
  recency?: RecencyConfig;
}): Promise<SearchRowResult[]> {
  if (params.queryVec.length === 0 || params.limit <= 0) return [];

  const now = Date.now();
  const recency = params.recency;

  if (await params.ensureVectorReady(params.queryVec.length)) {
    const rows = params.db
      .prepare(
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text,\n` +
          `       c.source, c.updated_at,\n` +
          `       vec_distance_cosine(v.embedding, ?) AS dist\n` +
          `  FROM ${params.vectorTable} v\n` +
          `  JOIN chunks c ON c.id = v.id\n` +
          ` WHERE c.model = ?${params.sourceFilterVec.sql}\n` +
          ` ORDER BY dist ASC\n` +
          ` LIMIT ?`,
      )
      .all(
        vectorToBlob(params.queryVec),
        params.providerModel,
        ...params.sourceFilterVec.params,
        params.limit,
      ) as Array<{
      id: string;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      source: SearchSource;
      dist: number;
      updated_at: number | null;
    }>;

    const results = rows.map((row) => {
      let score = 1 - row.dist;
      if (recency?.enabled) {
        const penalty = calculateRecencyPenalty(
          row.updated_at,
          now,
          recency.lambda,
          recency.windowDays,
        );
        score = Math.max(0, score - penalty);
      }
      return {
        id: row.id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        score,
        snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
        source: row.source,
      };
    });

    // Re-sort by score after applying recency penalty
    if (recency?.enabled) {
      results.sort((a, b) => b.score - a.score);
    }

    return results;
  }

  const candidates = listChunks({
    db: params.db,
    providerModel: params.providerModel,
    sourceFilter: params.sourceFilterChunks,
  });
  const scored = candidates
    .map((chunk) => {
      let score = cosineSimilarity(params.queryVec, chunk.embedding);
      if (recency?.enabled) {
        const penalty = calculateRecencyPenalty(
          chunk.updatedAt,
          now,
          recency.lambda,
          recency.windowDays,
        );
        score = Math.max(0, score - penalty);
      }
      return { chunk, score };
    })
    .filter((entry) => Number.isFinite(entry.score));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit)
    .map((entry) => ({
      id: entry.chunk.id,
      path: entry.chunk.path,
      startLine: entry.chunk.startLine,
      endLine: entry.chunk.endLine,
      score: entry.score,
      snippet: truncateUtf16Safe(entry.chunk.text, params.snippetMaxChars),
      source: entry.chunk.source,
    }));
}

export function listChunks(params: {
  db: DatabaseSync;
  providerModel: string;
  sourceFilter: { sql: string; params: SearchSource[] };
}): Array<{
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
  source: SearchSource;
  updatedAt: number | null;
}> {
  const rows = params.db
    .prepare(
      `SELECT id, path, start_line, end_line, text, embedding, source, updated_at\n` +
        `  FROM chunks\n` +
        ` WHERE model = ?${params.sourceFilter.sql}`,
    )
    .all(params.providerModel, ...params.sourceFilter.params) as Array<{
    id: string;
    path: string;
    start_line: number;
    end_line: number;
    text: string;
    embedding: string;
    source: SearchSource;
    updated_at: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    text: row.text,
    embedding: parseEmbedding(row.embedding),
    source: row.source,
    updatedAt: row.updated_at,
  }));
}

export async function searchKeyword(params: {
  db: DatabaseSync;
  ftsTable: string;
  providerModel: string;
  query: string;
  limit: number;
  snippetMaxChars: number;
  sourceFilter: { sql: string; params: SearchSource[] };
  buildFtsQuery: (raw: string) => string | null;
  bm25RankToScore: (rank: number) => number;
}): Promise<Array<SearchRowResult & { textScore: number }>> {
  if (params.limit <= 0) return [];
  const ftsQuery = params.buildFtsQuery(params.query);
  if (!ftsQuery) return [];

  const rows = params.db
    .prepare(
      `SELECT id, path, source, start_line, end_line, text,\n` +
        `       bm25(${params.ftsTable}) AS rank\n` +
        `  FROM ${params.ftsTable}\n` +
        ` WHERE ${params.ftsTable} MATCH ? AND model = ?${params.sourceFilter.sql}\n` +
        ` ORDER BY rank ASC\n` +
        ` LIMIT ?`,
    )
    .all(ftsQuery, params.providerModel, ...params.sourceFilter.params, params.limit) as Array<{
    id: string;
    path: string;
    source: SearchSource;
    start_line: number;
    end_line: number;
    text: string;
    rank: number;
  }>;

  return rows.map((row) => {
    const textScore = params.bm25RankToScore(row.rank);
    return {
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      score: textScore,
      textScore,
      snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
      source: row.source,
    };
  });
}
