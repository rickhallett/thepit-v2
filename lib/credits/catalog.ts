// Credit catalog — pricing per model, cost estimation, micro-credit conversion.
// All amounts are in micro-credits unless otherwise specified.

/** Per-million-token rates in GBP */
const MODEL_PRICING = {
  "claude-haiku": { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  "claude-sonnet": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
} as const;

export type ModelId = keyof typeof MODEL_PRICING;

/** Platform margin applied to all costs (10%) */
export const CREDIT_PLATFORM_MARGIN = 0.1;

/** Micro-credits per display credit */
export const MICRO_PER_CREDIT = 100;

/** GBP per display credit (1p per credit) */
export const GBP_PER_CREDIT = 0.01;

/**
 * Converts display credits to micro-credits.
 * 100 credits → 10000 micro
 */
export function toMicroCredits(credits: number): number {
  return credits * MICRO_PER_CREDIT;
}

/**
 * Converts micro-credits to display credits.
 * 10000 micro → 100 credits
 */
export function fromMicroCredits(micro: number): number {
  return micro / MICRO_PER_CREDIT;
}

export interface BoutCostParams {
  maxTurns: number;
  model: ModelId;
  estimatedInputTokensPerTurn?: number;
  estimatedOutputTokensPerTurn?: number;
}

/**
 * Estimates the cost of a bout in GBP.
 * Calculates per-turn token costs, sums across all turns, applies platform margin.
 */
export function estimateBoutCostGbp(params: BoutCostParams): number {
  const {
    maxTurns,
    model,
    estimatedInputTokensPerTurn = 500,
    estimatedOutputTokensPerTurn = 300,
  } = params;

  const pricing = MODEL_PRICING[model];

  // Cost per turn
  const inputCostPerTurn =
    (estimatedInputTokensPerTurn * pricing.inputPerMillion) / 1_000_000;
  const outputCostPerTurn =
    (estimatedOutputTokensPerTurn * pricing.outputPerMillion) / 1_000_000;
  const costPerTurn = inputCostPerTurn + outputCostPerTurn;

  // Total cost across all turns + margin
  const baseCost = costPerTurn * maxTurns;
  const totalCost = baseCost * (1 + CREDIT_PLATFORM_MARGIN);

  return totalCost;
}

/**
 * Estimates the cost of a bout in micro-credits.
 * Converts GBP cost to micro-credits and rounds up.
 */
export function estimateBoutCostMicro(params: BoutCostParams): number {
  const gbpCost = estimateBoutCostGbp(params);

  // Convert GBP to micro-credits: gbp / GBP_PER_CREDIT * MICRO_PER_CREDIT
  const microCost = (gbpCost / GBP_PER_CREDIT) * MICRO_PER_CREDIT;

  // Round up to nearest integer
  return Math.ceil(microCost);
}
