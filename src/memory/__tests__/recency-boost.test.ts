import { describe, expect, it } from "vitest";

import { calculateRecencyPenalty } from "../manager-search.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("recency boost", () => {
  describe("calculateRecencyPenalty", () => {
    const defaultLambda = 0.08;
    const defaultWindowDays = 14;

    it("returns 0 penalty for document updated today", () => {
      const now = Date.now();
      const updatedAt = now; // Just now

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      expect(penalty).toBe(0);
    });

    it("returns 0 penalty for document updated 1 hour ago", () => {
      const now = Date.now();
      const updatedAt = now - 60 * 60 * 1000; // 1 hour ago

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      // Very small penalty for 1 hour
      expect(penalty).toBeLessThan(0.001);
    });

    it("returns half penalty for document from 7 days ago (half of window)", () => {
      const now = Date.now();
      const updatedAt = now - 7 * MS_PER_DAY; // 7 days ago

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      // 7 days / 14 days window = 0.5 ratio
      // penalty = 0.08 * 0.5 = 0.04
      expect(penalty).toBeCloseTo(0.04, 5);
    });

    it("returns max penalty (lambda) for document from 14+ days ago", () => {
      const now = Date.now();
      const updatedAt = now - 14 * MS_PER_DAY; // Exactly 14 days ago

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      // 14 days / 14 days window = 1.0 ratio (capped at 1)
      // penalty = 0.08 * 1.0 = 0.08
      expect(penalty).toBeCloseTo(defaultLambda, 5);
    });

    it("returns max penalty for document older than window", () => {
      const now = Date.now();
      const updatedAt = now - 30 * MS_PER_DAY; // 30 days ago

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      // 30 days / 14 days window = 2.14 ratio, but capped at 1
      // penalty = 0.08 * 1.0 = 0.08
      expect(penalty).toBeCloseTo(defaultLambda, 5);
    });

    it("returns max penalty for very old document", () => {
      const now = Date.now();
      const updatedAt = now - 365 * MS_PER_DAY; // 1 year ago

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      expect(penalty).toBeCloseTo(defaultLambda, 5);
    });

    it("returns 0 penalty for null updatedAt", () => {
      const now = Date.now();

      const penalty = calculateRecencyPenalty(null, now, defaultLambda, defaultWindowDays);

      expect(penalty).toBe(0);
    });

    it("returns 0 penalty for undefined updatedAt", () => {
      const now = Date.now();

      const penalty = calculateRecencyPenalty(undefined, now, defaultLambda, defaultWindowDays);

      expect(penalty).toBe(0);
    });

    it("returns 0 penalty for future updatedAt", () => {
      const now = Date.now();
      const updatedAt = now + MS_PER_DAY; // 1 day in the future

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      expect(penalty).toBe(0);
    });

    it("scales linearly with days within window", () => {
      const now = Date.now();
      const lambda = 0.1;
      const windowDays = 10;

      const penalty1day = calculateRecencyPenalty(now - 1 * MS_PER_DAY, now, lambda, windowDays);
      const penalty2day = calculateRecencyPenalty(now - 2 * MS_PER_DAY, now, lambda, windowDays);
      const penalty5day = calculateRecencyPenalty(now - 5 * MS_PER_DAY, now, lambda, windowDays);

      // Check linear scaling
      expect(penalty1day).toBeCloseTo(0.01, 5); // 1/10 * 0.1
      expect(penalty2day).toBeCloseTo(0.02, 5); // 2/10 * 0.1
      expect(penalty5day).toBeCloseTo(0.05, 5); // 5/10 * 0.1
    });

    it("respects custom lambda value", () => {
      const now = Date.now();
      const updatedAt = now - 7 * MS_PER_DAY; // 7 days ago
      const customLambda = 0.2;

      const penalty = calculateRecencyPenalty(updatedAt, now, customLambda, defaultWindowDays);

      // 7 days / 14 days = 0.5 ratio
      // penalty = 0.2 * 0.5 = 0.1
      expect(penalty).toBeCloseTo(0.1, 5);
    });

    it("respects custom windowDays value", () => {
      const now = Date.now();
      const updatedAt = now - 7 * MS_PER_DAY; // 7 days ago
      const customWindowDays = 7;

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, customWindowDays);

      // 7 days / 7 days = 1.0 ratio (max)
      // penalty = 0.08 * 1.0 = 0.08
      expect(penalty).toBeCloseTo(defaultLambda, 5);
    });

    it("handles zero lambda (no penalty)", () => {
      const now = Date.now();
      const updatedAt = now - 30 * MS_PER_DAY;

      const penalty = calculateRecencyPenalty(updatedAt, now, 0, defaultWindowDays);

      expect(penalty).toBe(0);
    });

    it("handles edge case of very small window", () => {
      const now = Date.now();
      const updatedAt = now - MS_PER_DAY; // 1 day ago
      const smallWindowDays = 1;

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, smallWindowDays);

      // 1 day / 1 day = 1.0 ratio
      expect(penalty).toBeCloseTo(defaultLambda, 5);
    });

    it("handles fractional days correctly", () => {
      const now = Date.now();
      const updatedAt = now - 3.5 * MS_PER_DAY; // 3.5 days ago

      const penalty = calculateRecencyPenalty(updatedAt, now, defaultLambda, defaultWindowDays);

      // 3.5 days / 14 days = 0.25 ratio
      // penalty = 0.08 * 0.25 = 0.02
      expect(penalty).toBeCloseTo(0.02, 5);
    });
  });

  describe("recency boost integration scenarios", () => {
    const defaultLambda = 0.08;
    const defaultWindowDays = 14;

    it("newer document wins over older with same vector similarity", () => {
      const now = Date.now();
      const baseVectorScore = 0.85;

      // Document A: updated today
      const penaltyA = calculateRecencyPenalty(now, now, defaultLambda, defaultWindowDays);
      const scoreA = baseVectorScore - penaltyA;

      // Document B: updated 14 days ago
      const penaltyB = calculateRecencyPenalty(
        now - 14 * MS_PER_DAY,
        now,
        defaultLambda,
        defaultWindowDays,
      );
      const scoreB = baseVectorScore - penaltyB;

      expect(scoreA).toBeGreaterThan(scoreB);
      expect(scoreA).toBeCloseTo(0.85, 5);
      expect(scoreB).toBeCloseTo(0.77, 2); // 0.85 - 0.08
    });

    it("highly relevant old document can still beat less relevant new document", () => {
      const now = Date.now();

      // Document A: very relevant but old
      const vectorScoreA = 0.95;
      const penaltyA = calculateRecencyPenalty(
        now - 14 * MS_PER_DAY,
        now,
        defaultLambda,
        defaultWindowDays,
      );
      const scoreA = vectorScoreA - penaltyA;

      // Document B: less relevant but new
      const vectorScoreB = 0.75;
      const penaltyB = calculateRecencyPenalty(now, now, defaultLambda, defaultWindowDays);
      const scoreB = vectorScoreB - penaltyB;

      // Old but highly relevant (0.95 - 0.08 = 0.87) beats new but less relevant (0.75)
      expect(scoreA).toBeCloseTo(0.87, 5);
      expect(scoreB).toBeCloseTo(0.75, 5);
      expect(scoreA).toBeGreaterThan(scoreB);
    });

    it("score is clamped to non-negative", () => {
      const now = Date.now();
      const lowVectorScore = 0.05;
      const highLambda = 0.2;

      // With a low vector score and high penalty, score could go negative
      const penalty = calculateRecencyPenalty(
        now - 14 * MS_PER_DAY,
        now,
        highLambda,
        defaultWindowDays,
      );
      const rawScore = lowVectorScore - penalty;

      // In actual implementation, score is clamped with Math.max(0, score - penalty)
      const clampedScore = Math.max(0, rawScore);

      expect(rawScore).toBeLessThan(0); // 0.05 - 0.2 = -0.15
      expect(clampedScore).toBe(0);
    });

    it("disabled recency boost has no effect", () => {
      const now = Date.now();
      const vectorScore = 0.85;

      // When recency is disabled, no penalty should be applied
      // This is handled at the caller level, but we can verify the penalty calculation
      const penalty = calculateRecencyPenalty(
        now - 14 * MS_PER_DAY,
        now,
        0, // lambda = 0 effectively disables the boost
        defaultWindowDays,
      );

      expect(penalty).toBe(0);
      expect(vectorScore - penalty).toBe(vectorScore);
    });
  });
});
