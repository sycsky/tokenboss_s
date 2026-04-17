/**
 * Model tier registry + cost math.
 *
 * Every model is bucketed into one of three tiers. The tier determines:
 *   1. How many credits we reserve up-front (before upstream call)
 *   2. How much we bill per token when we settle the reservation
 *
 * 1 credit ≈ $0.001 in USD (pricing is a placeholder for MVP; real rates will
 * be tuned once we start running traffic through each aggregator).
 */

export type Tier = 1 | 2 | 3;

/**
 * Ordered patterns: the first match wins, so put more specific rules first.
 * Matching is case-insensitive and happens against the *normalized* model
 * name (i.e. after any `provider/` prefix has been stripped).
 */
const TIER_PATTERNS: { pattern: RegExp; tier: Tier }[] = [
  // Tier 3 — flagship, reasoning
  { pattern: /opus/i, tier: 3 },
  { pattern: /^o1\b|^o3\b/i, tier: 3 },
  { pattern: /gpt-5(?!.*mini)/i, tier: 3 },
  // Tier 2 — mid / workhorse
  { pattern: /sonnet/i, tier: 2 },
  { pattern: /gpt-5.*mini/i, tier: 2 },
  { pattern: /gpt-4o(?!-mini)/i, tier: 2 },
  { pattern: /gpt-4(?!o)/i, tier: 2 },
  // Tier 1 — cheap
  { pattern: /haiku/i, tier: 1 },
  { pattern: /mini/i, tier: 1 },
];

/** Strip a `provider/` prefix so `openai/gpt-4o-mini` becomes `gpt-4o-mini`. */
function normalize(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/**
 * Lookup the tier for a model. Unknown models default to tier 2 — a
 * moderate-safety fallback so we don't accidentally charge flagship rates
 * for something we can't identify, or give away flagship access for free.
 */
export function getTier(model: string): Tier {
  const m = normalize(model);
  for (const { pattern, tier } of TIER_PATTERNS) {
    if (pattern.test(m)) return tier;
  }
  return 2;
}

/** Credits reserved before forwarding a request upstream. */
export function getReserveAmount(tier: Tier): number {
  switch (tier) {
    case 1:
      return 15;
    case 2:
      return 50;
    case 3:
      return 150;
  }
}

/**
 * Compute the actual credit cost after the upstream has returned usage.
 * Weights are rough proxies for per-million-token pricing, chosen so an
 * "average" request in each tier lands at or slightly under the reserve
 * amount.
 *
 *   Tier 1:  in*1  + out*5
 *   Tier 2:  in*3  + out*15
 *   Tier 3:  in*15 + out*75
 *
 * Divided by 1000 and ceiled. Always at least 1 credit so every successful
 * call costs something.
 */
export function computeCost(
  tier: Tier,
  promptTokens: number,
  completionTokens: number,
): number {
  const weights: Record<Tier, [number, number]> = {
    1: [1, 5],
    2: [3, 15],
    3: [15, 75],
  };
  const [inW, outW] = weights[tier];
  const raw = promptTokens * inW + completionTokens * outW;
  return Math.max(1, Math.ceil(raw / 1000));
}
