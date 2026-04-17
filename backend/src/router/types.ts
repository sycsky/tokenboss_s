/**
 * Smart Router Types (copied from ClawRouter/src/router/types.ts).
 *
 * Mirrors ClawRouter's router contract so scoring/strategy logic can be
 * shared verbatim. Kept in sync intentionally — do not drift.
 */

export type Tier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";

export type ScoringResult = {
  score: number;
  tier: Tier | null;
  confidence: number;
  signals: string[];
  agenticScore?: number;
  dimensions?: Array<{ name: string; score: number; signal: string | null }>;
};

export type RoutingDecision = {
  model: string;
  tier: Tier;
  confidence: number;
  method: "rules" | "llm";
  reasoning: string;
  costEstimate: number;
  baselineCost: number;
  savings: number;
  agenticScore?: number;
  tierConfigs?: Record<Tier, TierConfig>;
  profile?: "auto" | "eco" | "premium" | "agentic";
};

export interface RouterStrategy {
  readonly name: string;
  route(
    prompt: string,
    systemPrompt: string | undefined,
    maxOutputTokens: number,
    options: RouterOptions,
  ): RoutingDecision;
}

export type RouterOptions = {
  config: RoutingConfig;
  modelPricing: Map<string, import("./selector.js").ModelPricing>;
  routingProfile?: "eco" | "auto" | "premium";
  hasTools?: boolean;
  now?: Date;
};

export type TierConfig = {
  primary: string;
  fallback: string[];
};

export type ScoringConfig = {
  tokenCountThresholds: { simple: number; complex: number };
  codeKeywords: string[];
  reasoningKeywords: string[];
  simpleKeywords: string[];
  technicalKeywords: string[];
  creativeKeywords: string[];
  imperativeVerbs: string[];
  constraintIndicators: string[];
  outputFormatKeywords: string[];
  referenceKeywords: string[];
  negationKeywords: string[];
  domainSpecificKeywords: string[];
  agenticTaskKeywords: string[];
  dimensionWeights: Record<string, number>;
  tierBoundaries: {
    simpleMedium: number;
    mediumComplex: number;
    complexReasoning: number;
  };
  confidenceSteepness: number;
  confidenceThreshold: number;
};

export type ClassifierConfig = {
  llmModel: string;
  llmMaxTokens: number;
  llmTemperature: number;
  promptTruncationChars: number;
  cacheTtlMs: number;
};

export type OverridesConfig = {
  maxTokensForceComplex: number;
  structuredOutputMinTier: Tier;
  ambiguousDefaultTier: Tier;
  agenticMode?: boolean;
};

export type Promotion = {
  name: string;
  startDate: string;
  endDate: string;
  tierOverrides: Partial<Record<Tier, Partial<TierConfig>>>;
  profiles?: Array<"auto" | "eco" | "premium" | "agentic">;
};

export type RoutingConfig = {
  version: string;
  classifier: ClassifierConfig;
  scoring: ScoringConfig;
  tiers: Record<Tier, TierConfig>;
  agenticTiers?: Record<Tier, TierConfig>;
  ecoTiers?: Record<Tier, TierConfig>;
  premiumTiers?: Record<Tier, TierConfig>;
  promotions?: Promotion[];
  overrides: OverridesConfig;
};
