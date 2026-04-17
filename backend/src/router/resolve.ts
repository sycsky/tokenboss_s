/**
 * Backend virtual-model resolver.
 *
 * Translates a request targeting a virtual model (`auto`, `eco`, `premium`,
 * `agentic`) into a concrete upstream model id, using the same rule-based
 * scoring as ClawRouter. Returns the full fallback chain so the proxy can
 * retry on upstream failure.
 *
 * Tier tables are loaded from `data/router-tiers.json` and merged with the
 * default scoring config (keywords / weights / boundaries).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import { getStrategy } from "./strategy.js";
import { getFallbackChain } from "./selector.js";
import { classifyByLLM, isLLMClassifierEnabled } from "./llmClassifier.js";
import type { RoutingConfig, Tier, TierConfig } from "./types.js";

const CONFIG_PATH = join(process.cwd(), "data", "router-tiers.json");
const RELOAD_INTERVAL_MS = 60_000;

type CachedConfig = { loadedAt: number; config: RoutingConfig };
let cached: CachedConfig | null = null;

export type VirtualProfile = "auto" | "eco" | "premium" | "agentic";

export type ResolveResult = {
  primary: string;
  fallback: string[];
  tier: Tier;
  profile: VirtualProfile;
  reasoning: string;
};

type TiersFile = {
  tiers?: Record<Tier, TierConfig>;
  ecoTiers?: Record<Tier, TierConfig>;
  premiumTiers?: Record<Tier, TierConfig>;
  agenticTiers?: Record<Tier, TierConfig>;
};

async function loadConfig(): Promise<RoutingConfig> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < RELOAD_INTERVAL_MS) return cached.config;
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const file = JSON.parse(raw) as TiersFile;
    const merged: RoutingConfig = {
      ...DEFAULT_ROUTING_CONFIG,
      tiers: file.tiers ?? DEFAULT_ROUTING_CONFIG.tiers,
      ecoTiers: file.ecoTiers ?? DEFAULT_ROUTING_CONFIG.ecoTiers,
      premiumTiers: file.premiumTiers ?? DEFAULT_ROUTING_CONFIG.premiumTiers,
      agenticTiers: file.agenticTiers ?? DEFAULT_ROUTING_CONFIG.agenticTiers,
    };
    cached = { loadedAt: now, config: merged };
    return merged;
  } catch (err) {
    console.error(`[router] failed to load ${CONFIG_PATH}: ${String(err)}`);
    // Fall back to defaults so routing still works if the file is missing.
    const fallback = DEFAULT_ROUTING_CONFIG;
    cached = { loadedAt: now, config: fallback };
    return fallback;
  }
}

/**
 * Detect whether a model name is a virtual selector. Accepts:
 *   auto / eco / premium / agentic
 *   blockrun/auto, tokenboss/eco, etc. (prefix already stripped upstream, but
 *   accept both forms so callers don't need to care about ordering).
 */
export function detectVirtualProfile(model: string): VirtualProfile | null {
  const lower = model.toLowerCase();
  const tail = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  if (tail === "auto" || tail === "eco" || tail === "premium" || tail === "agentic") {
    return tail;
  }
  return null;
}

type OAIMessage = {
  role?: string;
  content?: unknown;
};

/** Extract the last user message and the first system message as plain strings. */
function extractPrompts(messages: unknown): {
  prompt: string;
  systemPrompt: string | undefined;
} {
  if (!Array.isArray(messages)) return { prompt: "", systemPrompt: undefined };
  const arr = messages as OAIMessage[];
  const stringify = (c: unknown): string => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((part) =>
          typeof part === "object" && part !== null && "text" in part
            ? String((part as { text?: unknown }).text ?? "")
            : "",
        )
        .join(" ");
    }
    return "";
  };
  const systemMsg = arr.find((m) => m?.role === "system");
  const lastUser = [...arr].reverse().find((m) => m?.role === "user");
  return {
    prompt: lastUser ? stringify(lastUser.content) : "",
    systemPrompt: systemMsg ? stringify(systemMsg.content) : undefined,
  };
}

/**
 * Resolve a virtual model + message body to a concrete model + fallback chain.
 */
export async function resolveVirtualModel(
  profile: VirtualProfile,
  messages: unknown,
  hasTools: boolean,
  maxOutputTokens = 4096,
): Promise<ResolveResult> {
  const config = await loadConfig();
  const { prompt, systemPrompt } = extractPrompts(messages);

  const strategy = getStrategy("rules");
  const decision = strategy.route(prompt, systemPrompt, maxOutputTokens, {
    config,
    modelPricing: new Map(),
    routingProfile: profile === "agentic" ? "auto" : profile,
    hasTools,
  });

  const effectiveTiers =
    decision.tierConfigs ??
    (profile === "eco"
      ? config.ecoTiers
      : profile === "premium"
        ? config.premiumTiers
        : profile === "agentic"
          ? config.agenticTiers
          : config.tiers) ??
    config.tiers;

  // Rules said "ambiguous → default tier". If LLM classifier is enabled,
  // ask it for a real tier and replace the chain. Rules-only flow is the
  // fast path; this only hits ~20-30% of traffic.
  let finalTier: Tier = decision.tier;
  let reasoning = decision.reasoning;
  if (
    isLLMClassifierEnabled() &&
    /ambiguous/.test(decision.reasoning) &&
    prompt.length > 0
  ) {
    const llmTier = await classifyByLLM(prompt);
    if (llmTier) {
      finalTier = llmTier;
      reasoning = `${decision.reasoning} | llm=${llmTier}`;
    }
  }

  const chain = getFallbackChain(finalTier, effectiveTiers);
  return {
    primary: chain[0],
    fallback: chain.slice(1),
    tier: finalTier,
    profile: decision.profile ?? profile,
    reasoning,
  };
}
