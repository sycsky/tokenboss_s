/**
 * LLM classifier — fallback for ambiguous rule-based decisions.
 *
 * Only invoked when the rules strategy couldn't pick a tier confidently
 * (~20-30% of traffic at most). Result cached by prompt hash.
 *
 * Enabled when `ROUTER_LLM_ENABLED=1` AND `ROUTER_LLM_API_KEY` is set.
 * Model defaults to a cheap aggregator model; override with `ROUTER_LLM_MODEL`.
 */

import type { Tier } from "./types.js";

const CLASSIFIER_PROMPT = `You are a query complexity classifier. Classify the user's query into exactly one category.

Categories:
- SIMPLE: Factual Q&A, definitions, translations, short answers
- MEDIUM: Summaries, explanations, moderate code generation
- COMPLEX: Multi-step code, system design, creative writing, analysis
- REASONING: Mathematical proofs, formal logic, step-by-step problem solving

Respond with ONLY one word: SIMPLE, MEDIUM, COMPLEX, or REASONING.`;

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_TRUNCATION = 500;
const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1h
const DEFAULT_TIMEOUT_MS = 5_000;

const cache = new Map<string, { tier: Tier; expires: number }>();

export function isLLMClassifierEnabled(): boolean {
  return (
    process.env.ROUTER_LLM_ENABLED === "1" &&
    !!process.env.ROUTER_LLM_API_KEY &&
    !!process.env.NEWAPI_BASE_URL
  );
}

export async function classifyByLLM(prompt: string): Promise<Tier | null> {
  if (!isLLMClassifierEnabled()) return null;
  const truncated = prompt.slice(0, DEFAULT_TRUNCATION);
  if (truncated.trim().length === 0) return null;

  const key = simpleHash(truncated);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.tier;

  const base = process.env.NEWAPI_BASE_URL!.replace(/\/+$/, "");
  const apiKey = process.env.ROUTER_LLM_API_KEY!;
  const model = process.env.ROUTER_LLM_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          { role: "user", content: truncated },
        ],
        max_tokens: 4,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
    const tier = parseTier(text);
    if (!tier) return null;
    cache.set(key, { tier, expires: Date.now() + DEFAULT_CACHE_TTL_MS });
    if (cache.size > 1000) prune();
    return tier;
  } catch (err) {
    console.warn(`[router] LLM classifier failed: ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseTier(text: string): Tier | null {
  if (/\bREASONING\b/.test(text)) return "REASONING";
  if (/\bCOMPLEX\b/.test(text)) return "COMPLEX";
  if (/\bMEDIUM\b/.test(text)) return "MEDIUM";
  if (/\bSIMPLE\b/.test(text)) return "SIMPLE";
  return null;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function prune(): void {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
}
