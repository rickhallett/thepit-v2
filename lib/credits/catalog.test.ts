import { describe, expect, it } from "vitest";
import {
  CREDIT_PLATFORM_MARGIN,
  estimateBoutCostGbp,
  estimateBoutCostMicro,
  fromMicroCredits,
  GBP_PER_CREDIT,
  MICRO_PER_CREDIT,
  toMicroCredits,
} from "./catalog";

describe("catalog", () => {
  describe("toMicroCredits", () => {
    it("converts display credits to micro-credits", () => {
      expect(toMicroCredits(100)).toBe(10000);
      expect(toMicroCredits(1)).toBe(100);
      expect(toMicroCredits(0)).toBe(0);
    });
  });

  describe("fromMicroCredits", () => {
    it("converts micro-credits to display credits", () => {
      expect(fromMicroCredits(10000)).toBe(100);
      expect(fromMicroCredits(100)).toBe(1);
      expect(fromMicroCredits(0)).toBe(0);
    });
  });

  describe("estimateBoutCostGbp", () => {
    it("calculates haiku 6-turn bout cost with reasonable magnitude", () => {
      const cost = estimateBoutCostGbp({
        maxTurns: 6,
        model: "claude-haiku",
        estimatedInputTokensPerTurn: 500,
        estimatedOutputTokensPerTurn: 300,
      });

      // Haiku: input £0.25/M, output £1.25/M
      // Per turn: (500 * 0.25 + 300 * 1.25) / 1_000_000 = 0.000125 + 0.000375 = 0.0005
      // 6 turns: 0.003
      // With 10% margin: 0.0033
      expect(cost).toBeCloseTo(0.0033, 4);
    });

    it("calculates sonnet as more expensive than haiku", () => {
      const haikuCost = estimateBoutCostGbp({
        maxTurns: 6,
        model: "claude-haiku",
      });

      const sonnetCost = estimateBoutCostGbp({
        maxTurns: 6,
        model: "claude-sonnet",
      });

      expect(sonnetCost).toBeGreaterThan(haikuCost);
      // Sonnet should be roughly 12x more expensive (3/0.25 for input, 15/1.25 for output)
      expect(sonnetCost / haikuCost).toBeGreaterThan(10);
    });

    it("uses default token estimates when not provided", () => {
      const withDefaults = estimateBoutCostGbp({
        maxTurns: 6,
        model: "claude-haiku",
      });

      const withExplicit = estimateBoutCostGbp({
        maxTurns: 6,
        model: "claude-haiku",
        estimatedInputTokensPerTurn: 500,
        estimatedOutputTokensPerTurn: 300,
      });

      expect(withDefaults).toBe(withExplicit);
    });

    it("applies platform margin", () => {
      // Calculate what cost would be without margin
      // Haiku: (500 * 0.25 + 300 * 1.25) / 1_000_000 per turn = 0.0005
      // 1 turn without margin: 0.0005
      const costWithMargin = estimateBoutCostGbp({
        maxTurns: 1,
        model: "claude-haiku",
        estimatedInputTokensPerTurn: 500,
        estimatedOutputTokensPerTurn: 300,
      });

      const baseCost = 0.0005;
      const expectedWithMargin = baseCost * (1 + CREDIT_PLATFORM_MARGIN);

      expect(costWithMargin).toBeCloseTo(expectedWithMargin, 6);
    });
  });

  describe("estimateBoutCostMicro", () => {
    it("converts GBP to micro-credits", () => {
      const microCost = estimateBoutCostMicro({
        maxTurns: 6,
        model: "claude-haiku",
      });

      const gbpCost = estimateBoutCostGbp({
        maxTurns: 6,
        model: "claude-haiku",
      });

      // micro = gbp / GBP_PER_CREDIT * MICRO_PER_CREDIT
      const expectedMicro = Math.ceil(
        (gbpCost / GBP_PER_CREDIT) * MICRO_PER_CREDIT,
      );
      expect(microCost).toBe(expectedMicro);
    });

    it("rounds up (Math.ceil)", () => {
      // Use params that produce a non-integer micro value
      const microCost = estimateBoutCostMicro({
        maxTurns: 1,
        model: "claude-haiku",
        estimatedInputTokensPerTurn: 501, // Odd number to ensure non-integer
        estimatedOutputTokensPerTurn: 301,
      });

      // Verify it's an integer (ceil was applied)
      expect(Number.isInteger(microCost)).toBe(true);

      // Verify it rounds up, not down
      const gbpCost = estimateBoutCostGbp({
        maxTurns: 1,
        model: "claude-haiku",
        estimatedInputTokensPerTurn: 501,
        estimatedOutputTokensPerTurn: 301,
      });
      const exactMicro = (gbpCost / GBP_PER_CREDIT) * MICRO_PER_CREDIT;

      expect(microCost).toBe(Math.ceil(exactMicro));
      expect(microCost).toBeGreaterThanOrEqual(exactMicro);
    });
  });

  describe("constants", () => {
    it("has correct platform margin (10%)", () => {
      expect(CREDIT_PLATFORM_MARGIN).toBe(0.1);
    });

    it("has correct micro per credit (100)", () => {
      expect(MICRO_PER_CREDIT).toBe(100);
    });

    it("has correct GBP per credit (0.01 = 1p)", () => {
      expect(GBP_PER_CREDIT).toBe(0.01);
    });
  });
});
