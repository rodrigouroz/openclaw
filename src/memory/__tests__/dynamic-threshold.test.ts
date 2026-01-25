import { describe, expect, it } from "vitest";
import {
  applyDynamicThreshold,
  calculateDynamicThreshold,
  mergeHybridResults,
  type HybridKeywordResult,
  type HybridVectorResult,
} from "../hybrid.js";

describe("calculateDynamicThreshold", () => {
  describe("high confidence queries (topScore >= 0.7)", () => {
    it("returns topScore * 0.5 for score of 0.7", () => {
      expect(calculateDynamicThreshold(0.7)).toBe(0.35);
    });

    it("returns topScore * 0.5 for score of 0.8", () => {
      expect(calculateDynamicThreshold(0.8)).toBe(0.4);
    });

    it("returns topScore * 0.5 for score of 0.9", () => {
      expect(calculateDynamicThreshold(0.9)).toBe(0.45);
    });

    it("returns topScore * 0.5 for perfect score of 1.0", () => {
      expect(calculateDynamicThreshold(1.0)).toBe(0.5);
    });
  });

  describe("medium confidence queries (topScore >= 0.3 and < 0.7)", () => {
    it("returns topScore * 0.6 for score of 0.3", () => {
      expect(calculateDynamicThreshold(0.3)).toBeCloseTo(0.18);
    });

    it("returns topScore * 0.6 for score of 0.5", () => {
      expect(calculateDynamicThreshold(0.5)).toBe(0.3);
    });

    it("returns topScore * 0.6 for score of 0.6", () => {
      expect(calculateDynamicThreshold(0.6)).toBeCloseTo(0.36);
    });

    it("returns topScore * 0.6 for score just below 0.7", () => {
      expect(calculateDynamicThreshold(0.69)).toBeCloseTo(0.414);
    });
  });

  describe("low confidence queries (topScore < 0.3)", () => {
    it("returns absolute floor of 0.15 for score of 0.2", () => {
      expect(calculateDynamicThreshold(0.2)).toBe(0.15);
    });

    it("returns absolute floor of 0.15 for score of 0.1", () => {
      expect(calculateDynamicThreshold(0.1)).toBe(0.15);
    });

    it("returns absolute floor of 0.15 for score of 0.29", () => {
      expect(calculateDynamicThreshold(0.29)).toBe(0.15);
    });

    it("returns absolute floor of 0.15 for zero score", () => {
      expect(calculateDynamicThreshold(0)).toBe(0.15);
    });
  });

  describe("edge cases", () => {
    it("handles negative scores by returning absolute floor", () => {
      expect(calculateDynamicThreshold(-0.5)).toBe(0.15);
    });

    it("handles scores above 1.0", () => {
      expect(calculateDynamicThreshold(1.5)).toBe(0.75);
    });
  });
});

describe("applyDynamicThreshold", () => {
  const makeResult = (score: number) => ({
    path: `/test/${score}`,
    startLine: 1,
    endLine: 10,
    score,
    snippet: `snippet for ${score}`,
    source: "test",
  });

  describe("when dynamicThreshold is disabled", () => {
    it("returns all results unchanged", () => {
      const results = [makeResult(0.8), makeResult(0.3), makeResult(0.1)];
      const filtered = applyDynamicThreshold(results, false);
      expect(filtered).toHaveLength(3);
      expect(filtered).toEqual(results);
    });

    it("returns empty array unchanged", () => {
      const results: Array<{ score: number }> = [];
      const filtered = applyDynamicThreshold(results, false);
      expect(filtered).toHaveLength(0);
    });
  });

  describe("when dynamicThreshold is enabled", () => {
    it("handles empty results gracefully", () => {
      const results: Array<{ score: number }> = [];
      const filtered = applyDynamicThreshold(results, true);
      expect(filtered).toHaveLength(0);
    });

    describe("high confidence query (top score 0.8+)", () => {
      it("filters results below threshold (topScore * 0.5)", () => {
        // Top score 0.8 → threshold = 0.4
        const results = [
          makeResult(0.8), // keep (>= 0.4)
          makeResult(0.5), // keep (>= 0.4)
          makeResult(0.4), // keep (= 0.4)
          makeResult(0.3), // filter (< 0.4)
          makeResult(0.1), // filter (< 0.4)
        ];
        const filtered = applyDynamicThreshold(results, true);
        expect(filtered).toHaveLength(3);
        expect(filtered.map((r) => r.score)).toEqual([0.8, 0.5, 0.4]);
      });

      it("keeps all results if all above threshold", () => {
        const results = [makeResult(0.9), makeResult(0.7), makeResult(0.5)];
        // Top score 0.9 → threshold = 0.45
        const filtered = applyDynamicThreshold(results, true);
        expect(filtered).toHaveLength(3);
      });
    });

    describe("medium confidence query (top score 0.4-0.6)", () => {
      it("filters results below threshold (topScore * 0.6)", () => {
        // Top score 0.5 → threshold = 0.3
        const results = [
          makeResult(0.5), // keep (>= 0.3)
          makeResult(0.35), // keep (>= 0.3)
          makeResult(0.3), // keep (= 0.3)
          makeResult(0.25), // filter (< 0.3)
          makeResult(0.1), // filter (< 0.3)
        ];
        const filtered = applyDynamicThreshold(results, true);
        expect(filtered).toHaveLength(3);
        expect(filtered.map((r) => r.score)).toEqual([0.5, 0.35, 0.3]);
      });
    });

    describe("low confidence query (top score 0.2)", () => {
      it("uses absolute floor threshold of 0.15", () => {
        // Top score 0.2 → threshold = 0.15 (floor)
        const results = [
          makeResult(0.2), // keep (>= 0.15)
          makeResult(0.15), // keep (= 0.15)
          makeResult(0.14), // filter (< 0.15)
          makeResult(0.1), // filter (< 0.15)
        ];
        const filtered = applyDynamicThreshold(results, true);
        expect(filtered).toHaveLength(2);
        expect(filtered.map((r) => r.score)).toEqual([0.2, 0.15]);
      });
    });

    describe("all results below threshold", () => {
      it("returns only results at or above the floor", () => {
        // Top score 0.1 → threshold = 0.15 (floor)
        // Even top result is below floor, but we keep what passes
        const results = [
          makeResult(0.1), // filter (< 0.15)
          makeResult(0.05), // filter (< 0.15)
        ];
        const filtered = applyDynamicThreshold(results, true);
        expect(filtered).toHaveLength(0);
      });
    });

    it("preserves result objects without modification", () => {
      const original = makeResult(0.8);
      const results = [original, makeResult(0.5)];
      const filtered = applyDynamicThreshold(results, true);
      expect(filtered[0]).toBe(original); // Same reference
    });
  });
});

describe("mergeHybridResults with dynamicThreshold", () => {
  const makeVectorResult = (id: string, vectorScore: number): HybridVectorResult => ({
    id,
    path: `/path/${id}`,
    startLine: 1,
    endLine: 10,
    source: "vector",
    snippet: `vector snippet ${id}`,
    vectorScore,
  });

  const makeKeywordResult = (id: string, textScore: number): HybridKeywordResult => ({
    id,
    path: `/path/${id}`,
    startLine: 1,
    endLine: 10,
    source: "keyword",
    snippet: `keyword snippet ${id}`,
    textScore,
  });

  describe("without dynamicThreshold (default)", () => {
    it("returns all merged results", () => {
      const vector = [makeVectorResult("a", 0.8), makeVectorResult("b", 0.3)];
      const keyword = [makeKeywordResult("b", 0.5), makeKeywordResult("c", 0.2)];

      const results = mergeHybridResults({
        vector,
        keyword,
        vectorWeight: 0.7,
        textWeight: 0.3,
      });

      expect(results).toHaveLength(3);
    });
  });

  describe("with dynamicThreshold enabled", () => {
    it("filters low-scoring results after merge", () => {
      const vector = [
        makeVectorResult("a", 0.9), // 0.9 * 0.7 = 0.63
        makeVectorResult("b", 0.4), // 0.4 * 0.7 = 0.28
      ];
      const keyword = [
        makeKeywordResult("a", 0.8), // adds 0.8 * 0.3 = 0.24 → total 0.87
        makeKeywordResult("c", 0.1), // 0.1 * 0.3 = 0.03
      ];

      const results = mergeHybridResults({
        vector,
        keyword,
        vectorWeight: 0.7,
        textWeight: 0.3,
        dynamicThreshold: true,
      });

      // Top score ~0.87 → threshold = 0.87 * 0.5 = 0.435
      // Results: a=0.87 (keep), b=0.28 (filter), c=0.03 (filter)
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe("/path/a");
    });

    it("works with only vector results", () => {
      const vector = [makeVectorResult("a", 0.8), makeVectorResult("b", 0.2)];

      const results = mergeHybridResults({
        vector,
        keyword: [],
        vectorWeight: 1.0,
        textWeight: 0.0,
        dynamicThreshold: true,
      });

      // Top score 0.8 → threshold = 0.4
      // a=0.8 (keep), b=0.2 (filter)
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.8);
    });

    it("works with only keyword results", () => {
      const keyword = [makeKeywordResult("a", 0.6), makeKeywordResult("b", 0.2)];

      const results = mergeHybridResults({
        vector: [],
        keyword,
        vectorWeight: 0.0,
        textWeight: 1.0,
        dynamicThreshold: true,
      });

      // Top score 0.6 → threshold = 0.36
      // a=0.6 (keep), b=0.2 (filter)
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.6);
    });

    it("handles empty inputs", () => {
      const results = mergeHybridResults({
        vector: [],
        keyword: [],
        vectorWeight: 0.7,
        textWeight: 0.3,
        dynamicThreshold: true,
      });

      expect(results).toHaveLength(0);
    });

    it("keeps results at exactly the threshold", () => {
      // Create results where one is exactly at threshold
      const vector = [
        makeVectorResult("a", 0.7), // 0.7 * 1.0 = 0.7
        makeVectorResult("b", 0.35), // 0.35 * 1.0 = 0.35 (exactly threshold for 0.7)
      ];

      const results = mergeHybridResults({
        vector,
        keyword: [],
        vectorWeight: 1.0,
        textWeight: 0.0,
        dynamicThreshold: true,
      });

      // Top score 0.7 → threshold = 0.35
      // Both should be kept (0.35 >= 0.35)
      expect(results).toHaveLength(2);
    });
  });

  describe("integration: full pipeline", () => {
    it("correctly merges and filters a realistic scenario", () => {
      const vector: HybridVectorResult[] = [
        makeVectorResult("doc1", 0.85),
        makeVectorResult("doc2", 0.6),
        makeVectorResult("doc3", 0.4),
        makeVectorResult("doc4", 0.2),
      ];

      const keyword: HybridKeywordResult[] = [
        makeKeywordResult("doc1", 0.7),
        makeKeywordResult("doc2", 0.3),
        makeKeywordResult("doc5", 0.5),
      ];

      // Using 70/30 weights:
      // doc1: 0.85*0.7 + 0.7*0.3 = 0.595 + 0.21 = 0.805
      // doc2: 0.6*0.7 + 0.3*0.3 = 0.42 + 0.09 = 0.51
      // doc3: 0.4*0.7 + 0 = 0.28
      // doc4: 0.2*0.7 + 0 = 0.14
      // doc5: 0 + 0.5*0.3 = 0.15

      const results = mergeHybridResults({
        vector,
        keyword,
        vectorWeight: 0.7,
        textWeight: 0.3,
        dynamicThreshold: true,
      });

      // Top score 0.805 → threshold = 0.4025
      // Keep: doc1 (0.805), doc2 (0.51)
      // Filter: doc3 (0.28), doc4 (0.14), doc5 (0.15)
      expect(results).toHaveLength(2);
      expect(results[0].path).toBe("/path/doc1");
      expect(results[1].path).toBe("/path/doc2");
    });
  });
});
