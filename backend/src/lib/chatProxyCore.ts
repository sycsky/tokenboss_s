/**
 * Core `/v1/chat/completions` pipeline — a transparent forwarder.
 *
 * The caller's `Authorization: Bearer sk-xxx` header is passed through to
 * newapi verbatim; newapi owns key verification, quota enforcement, and
 * usage logging.
 *
 * Bucket gating: if `x-tb-user-id` header is present, we run pre-flight
 * bucket consumption before forwarding upstream, and reconcile actual cost
 * after the stream finishes (non-stream responses only — streaming
 * reconciliation is best-effort via `finish_usage` tracking).
 *
 * The only reshaping we do is:
 *   - Strip ClawRouter's `provider/` model prefix for flat-namespace
 *     aggregators (unless `UPSTREAM_PRESERVE_MODEL_PREFIX=1`)
 *   - Synthesize a fake response when `MOCK_UPSTREAM=1` (local dev)
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { Agent } from "undici";

import { isMockMode } from "./upstream.js";
import { detectVirtualProfile, resolveVirtualModel } from "../router/resolve.js";
import { consumeForRequest, type ChatMode, type ModelTier } from "./buckets.js";

/**
 * Dedicated undici dispatcher for upstream calls.
 *
 * Default Node fetch keeps connections in a pool and reuses them; if the
 * upstream silently closes an idle connection (common with serverless hosts
 * like zeabur), the next reuse fails with "fetch failed" at the TCP layer
 * before we ever see an HTTP response. Keep-alive is disabled so every call
 * opens a fresh connection. Headers/body timeouts are extended because
 * slow-starting models (gpt-5 through indirect upstreams) can take minutes
 * to deliver the first byte.
 */
const upstreamDispatcher = new Agent({
  connect: { timeout: 30_000 },
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});

/**
 * Abstract sink for chat responses. `writeHead` must be called at most once
 * and before any `write`. `end` must always be called exactly once, even on
 * error paths, so the caller's transport (Lambda Function URL stream or Node
 * `ServerResponse`) can release its connection.
 */
export interface StreamWriter {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  write(chunk: Uint8Array | string): void;
  end(): void;
}

// ---------- Bucket gating helpers ----------

/**
 * Per-million-token USD prices (input / output) keyed on partial model name
 * patterns. Used by estimateCost() to convert token counts → USD.
 *
 * Prices are conservative (slightly above market) so we never under-charge.
 * Real reconciliation happens after the upstream reports actual usage.
 */
const MODEL_PRICES: { pattern: RegExp; inputPer1M: number; outputPer1M: number }[] = [
  // Claude Opus — most expensive
  { pattern: /opus/i,   inputPer1M: 15,  outputPer1M: 75  },
  // Claude Sonnet
  { pattern: /sonnet/i, inputPer1M: 3,   outputPer1M: 15  },
  // Claude Haiku — cheapest Claude
  { pattern: /haiku/i,  inputPer1M: 0.8, outputPer1M: 4   },
  // OpenAI o-series reasoning
  { pattern: /^o[13]\b/i, inputPer1M: 15, outputPer1M: 60 },
  // GPT-5 (non-mini)
  { pattern: /gpt-5(?!.*mini)/i, inputPer1M: 10, outputPer1M: 40 },
  // GPT-5-mini / gpt-4o-mini family
  { pattern: /mini/i,   inputPer1M: 0.15, outputPer1M: 0.6 },
  // GPT-4o
  { pattern: /gpt-4o/i, inputPer1M: 5,  outputPer1M: 15  },
  // GPT-4 generic
  { pattern: /gpt-4/i,  inputPer1M: 10, outputPer1M: 30  },
  // Gemini Flash (used by classifier)
  { pattern: /gemini.*flash/i, inputPer1M: 0.075, outputPer1M: 0.3 },
];

/**
 * Map a concrete model ID to a bucket ModelTier.
 *
 * - eco:       haiku / mini / flash — cheapest
 * - standard:  sonnet / gpt-4o-mini / gpt-5-mini
 * - premium:   opus / sonnet (flagship) / gpt-4o
 * - reasoning: o1 / o3 / gpt-5 non-mini / reasoning models
 *
 * For 'auto' (not yet resolved) we return 'eco' as the safest fallback; the
 * real tier will be known after virtual-model resolution.
 */
export function inferTierFromModelId(modelId: string): ModelTier {
  const m = modelId.toLowerCase();
  // Explicit 'auto' virtual model → eco (will be resolved before upstream)
  if (m === "auto" || m === "eco" || m === "premium" || m === "agentic") return "eco";
  // Reasoning / o-series
  if (/\bo[13]\b/.test(m) || (/gpt-5/.test(m) && !/mini/.test(m))) return "reasoning";
  // Eco / cheap
  if (/haiku/.test(m) || /mini/.test(m) || /flash/.test(m)) return "eco";
  // Premium (opus takes precedence over sonnet)
  if (/opus/.test(m)) return "premium";
  // Standard (sonnet, gpt-4o, etc.)
  if (/sonnet/.test(m) || /gpt-4o/.test(m) || /gpt-4/.test(m)) return "standard";
  // Fallback: standard is the safest middle ground
  return "standard";
}

/**
 * Rough up-front cost estimate in USD.
 *
 * We count characters / 4 as a proxy for input tokens (good enough for
 * pre-flight reservation). We assume a 200-token output as the baseline.
 * Always returns ≥ 0.0001 so a zero-cost bypass is impossible.
 */
export function estimateCost(modelId: string, messages: unknown[]): number {
  const m = modelId.toLowerCase();
  let inputPer1M = 3;   // default: mid-tier sonnet-like
  let outputPer1M = 15;

  for (const { pattern, inputPer1M: i, outputPer1M: o } of MODEL_PRICES) {
    if (pattern.test(m)) {
      inputPer1M = i;
      outputPer1M = o;
      break;
    }
  }

  // Estimate input tokens from message content length
  let charCount = 0;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg && typeof msg === "object") {
        const content = (msg as Record<string, unknown>).content;
        if (typeof content === "string") charCount += content.length;
        else if (Array.isArray(content)) {
          for (const part of content) {
            if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
              charCount += ((part as Record<string, unknown>).text as string).length;
            }
          }
        }
      }
    }
  }
  const inputTokens = Math.max(10, charCount / 4);
  const outputTokens = 200; // conservative baseline

  const cost = (inputTokens * inputPer1M + outputTokens * outputPer1M) / 1_000_000;
  return Math.max(0.0001, cost);
}

/**
 * Compute actual USD cost from observed token counts after the upstream
 * returns. Falls back to estimate if no usage is available.
 */
export function computeActualCost(
  modelId: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const m = modelId.toLowerCase();
  let inputPer1M = 3;
  let outputPer1M = 15;
  for (const { pattern, inputPer1M: i, outputPer1M: o } of MODEL_PRICES) {
    if (pattern.test(m)) {
      inputPer1M = i;
      outputPer1M = o;
      break;
    }
  }
  const cost = (tokensIn * inputPer1M + tokensOut * outputPer1M) / 1_000_000;
  return Math.max(0.0001, cost);
}

/**
 * Gate a request against the user's bucket. Extracts userId from the
 * `x-tb-user-id` header only when the request is authenticated as an
 * internal call via `x-tb-internal-secret`. If the secret is absent or
 * wrong the header is ignored, preventing header-spoofing attacks.
 *
 * Env var `TB_INTERNAL_SECRET` must be set (non-empty) for internal gating
 * to activate. When it is not set, bucket gating is skipped entirely so
 * existing local-dev / key-only callers continue to work unchanged.
 *
 * Returns `null` if the request may proceed, or a `StreamWriter`-ready
 * error payload if it should be rejected.
 */
export interface GateResult {
  userId: string;
  mode: ChatMode;
  modelTier: ModelTier;
  estimatedCost: number;
}

export function gateRequest(
  headers: Record<string, string | undefined>,
  modelId: string,
  messages: unknown[],
): { ok: true; gate: GateResult } | { ok: false; errorBody: string } {
  const expectedSecret = process.env.TB_INTERNAL_SECRET?.trim() ?? "";
  const providedSecret = headers["x-tb-internal-secret"] ?? "";

  // Validate the internal secret before trusting x-tb-user-id.
  // If TB_INTERNAL_SECRET is not configured, skip gating entirely (pass-through).
  const secretValid =
    expectedSecret.length > 0 && providedSecret === expectedSecret;

  const userId = secretValid ? headers["x-tb-user-id"] : undefined;
  if (!userId) {
    // No verified user context — skip gating (key-only callers bypass bucket gating)
    return {
      ok: true,
      gate: { userId: "", mode: "auto", modelTier: "eco", estimatedCost: 0 },
    };
  }

  const rawModelId = modelId || "auto";
  const mode: ChatMode = rawModelId === "auto" ? "auto" : "manual";
  const modelTier = inferTierFromModelId(rawModelId);
  const estimatedCost = estimateCost(rawModelId, messages);

  const result = consumeForRequest({
    userId,
    mode,
    modelId: rawModelId,
    modelTier,
    costUsd: estimatedCost,
    source: headers["x-source"] ?? undefined,
  });

  if (!result.ok) {
    return { ok: false, errorBody: buildInChatErrorBody(result.error!, rawModelId) };
  }

  return { ok: true, gate: { userId, mode, modelTier, estimatedCost } };
}

const IN_CHAT_MESSAGES: Record<string, string> = {
  insufficient_balance: "今日额度已用完。明日 0:00 自动刷新，或立即加买额度：tokenboss.com/pricing",
  model_locked: "此模型需 Super 套餐或加买充值额度。升级：tokenboss.com/pricing",
  mode_locked: "免费试用仅可用智能路由。升级：tokenboss.com/pricing",
  no_active_bucket: "请先注册或购买套餐：tokenboss.com",
};

function buildInChatErrorBody(error: string, modelId: string): string {
  const text = IN_CHAT_MESSAGES[error] ?? IN_CHAT_MESSAGES.no_active_bucket;
  return JSON.stringify({
    id: `chatcmpl-tb-error-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

/**
 * Post-stream cost reconciliation.
 *
 * If the actual cost differs from the estimate by more than $0.0001:
 *   - delta > 0 (under-charged): consume the difference
 *   - delta < 0 (over-charged): no automated refund in v1; log for manual review
 *
 * Silently no-ops when userId is empty (gating was skipped).
 */
function reconcileActualCost(
  gate: GateResult,
  actualTokensIn: number,
  actualTokensOut: number,
  resolvedModelId: string,
  source?: string,
): void {
  if (!gate.userId) return;
  const actualCost = computeActualCost(resolvedModelId, actualTokensIn, actualTokensOut);
  const delta = actualCost - gate.estimatedCost;
  if (Math.abs(delta) <= 0.0001) return;
  if (delta > 0) {
    // Under-charged — top up consumption
    consumeForRequest({
      userId: gate.userId,
      mode: gate.mode,
      modelId: resolvedModelId,
      modelTier: gate.modelTier,
      costUsd: delta,
      source: source ?? undefined,
      tokensIn: actualTokensIn,
      tokensOut: actualTokensOut,
    });
  } else {
    // Over-charged — log for manual reconciliation (no automated refund in v1)
    console.log(
      `[chatProxy] over-charged user=${gate.userId} model=${resolvedModelId} ` +
        `delta=$${delta.toFixed(6)} (estimated=$${gate.estimatedCost.toFixed(6)} actual=$${actualCost.toFixed(6)})`,
    );
  }
}

function getNewapiBase(): string | null {
  const raw = process.env.NEWAPI_BASE_URL?.trim().replace(/\/+$/, "");
  return raw && raw.length > 0 ? raw : null;
}

/** Main entry point. */
export async function streamChatCore(
  event: APIGatewayProxyEventV2,
  writer: StreamWriter,
): Promise<void> {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization;

  // ---------- Parse body ----------
  let body: Record<string, unknown>;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (err) {
    writeJsonError(
      writer,
      400,
      "invalid_request_error",
      `Could not parse JSON body: ${String(err)}`,
    );
    return;
  }

  // ---------- Bucket gating (pre-flight) ----------
  // Uses x-tb-user-id header to identify caller, but only trusts it when
  // the request is accompanied by a valid x-tb-internal-secret (set via
  // TB_INTERNAL_SECRET env var). Without the secret the header is ignored so
  // direct key-only callers bypass gating and spoofed headers have no effect.
  const modelIdForGating = typeof body.model === "string" ? body.model : "auto";
  const gateOutcome = gateRequest(
    event.headers as Record<string, string | undefined>,
    modelIdForGating,
    Array.isArray(body.messages) ? body.messages : [],
  );
  if (!gateOutcome.ok) {
    writer.writeHead(200, { "content-type": "application/json" });
    writer.write(gateOutcome.errorBody);
    writer.end();
    return;
  }
  const gateCtx = gateOutcome.gate;

  // Resolve virtual models (auto/eco/premium/agentic) — before any prefix
  // stripping so `detectVirtualProfile` sees the original name. The rules
  // strategy returns a concrete model id plus an ordered fallback chain we
  // retry on upstream connection failures.
  let fallbackModels: string[] = [];
  let routingReasoning: string | undefined;
  if (typeof body.model === "string") {
    const profile = detectVirtualProfile(body.model);
    if (profile) {
      try {
        const maxTokens =
          typeof body.max_tokens === "number"
            ? body.max_tokens
            : typeof body.max_completion_tokens === "number"
              ? body.max_completion_tokens
              : 4096;
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const resolved = await resolveVirtualModel(
          profile,
          body.messages,
          hasTools,
          maxTokens,
        );
        console.log(
          `[router] ${body.model} → ${resolved.primary} (tier=${resolved.tier}, profile=${resolved.profile}) fallback=[${resolved.fallback.join(", ")}]`,
        );
        body.model = resolved.primary;
        fallbackModels = resolved.fallback;
        routingReasoning = resolved.reasoning;
      } catch (err) {
        console.error(`[router] resolve failed: ${String(err)}`);
      }
    }
  }

  // Strip ClawRouter's `provider/` prefix for flat-namespace aggregators.
  if (
    typeof body.model === "string" &&
    body.model.includes("/") &&
    process.env.UPSTREAM_PRESERVE_MODEL_PREFIX !== "1"
  ) {
    const stripped = body.model.slice(body.model.lastIndexOf("/") + 1);
    if (stripped.length > 0) body.model = stripped;
  }
  // Also pre-strip fallbacks so we can swap them in without re-running this.
  fallbackModels = fallbackModels.map((m) =>
    m.includes("/") && process.env.UPSTREAM_PRESERVE_MODEL_PREFIX !== "1"
      ? m.slice(m.lastIndexOf("/") + 1)
      : m,
  );
  void routingReasoning;

  const wantsStream = body.stream === true;

  // GPT models (including gpt-5 reasoning) are unreliable in non-stream mode
  // through most upstream proxies — they either time out while the backend
  // buffers the full reasoning trace, or return a valid-looking JSON whose
  // `message.content` is empty because the payload ended up in
  // `reasoning_content`. Forcing stream:true upstream avoids both problems.
  // When the client asked for non-stream, we aggregate the SSE back into a
  // single chat.completion JSON below.
  const modelName = typeof body.model === "string" ? body.model : "";
  const forceUpstreamStream = /^gpt/i.test(modelName);
  if (forceUpstreamStream && body.stream !== true) {
    body.stream = true;
    const existingOpts =
      (body.stream_options as Record<string, unknown> | undefined) ?? {};
    body.stream_options = { ...existingOpts, include_usage: true };
  }

  try {
    // ---------- Mock mode ----------
    if (isMockMode()) {
      if (wantsStream) {
        await writeMockStream(writer, body);
      } else {
        writeMockBuffered(writer, body);
      }
      return;
    }

    // ---------- Transparent forward to newapi ----------
    if (!authHeader) {
      writeJsonError(
        writer,
        401,
        "authentication_error",
        "Missing Authorization header.",
        "missing_api_key",
      );
      return;
    }
    const base = getNewapiBase();
    if (!base) {
      writeJsonError(
        writer,
        503,
        "service_unavailable",
        "Chat proxy is unavailable — NEWAPI_BASE_URL is not configured.",
        "newapi_not_configured",
      );
      return;
    }

    // Try the primary model, then each fallback in turn. We only retry on
    // pre-first-byte failures (fetch throw OR an upstream 5xx before we've
    // started streaming back to the client) — once bytes flow, a retry would
    // corrupt the SSE stream.
    const attemptModels = [
      typeof body.model === "string" ? body.model : "",
      ...fallbackModels,
    ].filter((m) => m.length > 0);
    let upstreamRes: Response | null = null;
    let lastErr: unknown = null;
    for (let i = 0; i < attemptModels.length; i++) {
      const model = attemptModels[i];
      body.model = model;
      try {
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: authHeader,
          },
          body: JSON.stringify(body),
          // @ts-expect-error undici-specific extension on fetch init
          dispatcher: upstreamDispatcher,
        });
        if (res.status >= 500 && i < attemptModels.length - 1) {
          console.warn(
            `[chatProxy] upstream ${model} returned ${res.status}; trying fallback`,
          );
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          continue;
        }
        upstreamRes = res;
        break;
      } catch (err) {
        lastErr = err;
        console.error(
          `[chatProxy] upstream fetch failed for ${model}: ${String(err)}`,
        );
        if (i === attemptModels.length - 1) break;
      }
    }
    if (!upstreamRes) {
      writeJsonError(
        writer,
        502,
        "upstream_error",
        `Failed to reach upstream: ${String(lastErr ?? "all models failed")}`,
      );
      return;
    }

    const contentType =
      upstreamRes.headers.get("content-type") ?? "application/json";

    if (wantsStream && upstreamRes.body) {
      writer.writeHead(upstreamRes.status, {
        "content-type": contentType,
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      });
      const reader = upstreamRes.body.getReader();
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) writer.write(value);
        }
      } finally {
        reader.releaseLock();
      }
      writer.end();
      return;
    }

    // Client asked for non-stream but we forced upstream into stream mode
    // (gpt-* workaround). Aggregate the SSE back into a single chat.completion
    // JSON so the client sees the response shape it expects.
    if (forceUpstreamStream && !wantsStream && upstreamRes.body) {
      const aggregated = await aggregateSSEToCompletion(
        upstreamRes.body,
        modelName,
      );
      // Reconcile actual cost from usage data embedded in aggregated response
      if (gateCtx.userId && aggregated.usage) {
        const u = aggregated.usage as Record<string, unknown>;
        reconcileActualCost(
          gateCtx,
          typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
          typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
          modelName || gateCtx.modelTier,
          event.headers?.["x-source"],
        );
      }
      writer.writeHead(upstreamRes.status, { "content-type": "application/json" });
      writer.write(JSON.stringify(aggregated));
      writer.end();
      return;
    }

    const responseText = await upstreamRes.text();
    // Reconcile actual cost from buffered JSON response
    if (gateCtx.userId) {
      try {
        const parsed = JSON.parse(responseText) as Record<string, unknown>;
        if (parsed.usage) {
          const u = parsed.usage as Record<string, unknown>;
          reconcileActualCost(
            gateCtx,
            typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
            typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
            modelName || gateCtx.modelTier,
            event.headers?.["x-source"],
          );
        }
      } catch {
        /* ignore parse failures — reconciliation is best-effort */
      }
    }
    writer.writeHead(upstreamRes.status, { "content-type": contentType });
    writer.write(responseText);
    writer.end();
  } catch (err) {
    console.error(`[chatProxy] unexpected error during handling:`, err);
    try {
      writeJsonError(
        writer,
        500,
        "server_error",
        `Internal error: ${(err as Error).message}`,
      );
    } catch {
      /* writer already closed */
    }
  }
}

// ---------- helpers ----------

/**
 * Drain an OpenAI-format SSE stream and rebuild a single chat.completion
 * response object. Used when a client asked for non-stream but we forced the
 * upstream into streaming (see `forceUpstreamStream` above).
 *
 * Handles: content deltas, tool_calls deltas (assembled per-index), reasoning
 * content (prepended to final content wrapped in <think></think> so
 * non-reasoning-aware clients can still see it), and the final usage chunk
 * that OpenAI emits when `stream_options.include_usage` is set.
 */
interface AggregatedChoice {
  index: number;
  content: string;
  reasoning: string;
  role: string;
  finishReason: string | null;
  toolCalls: Map<
    number,
    {
      id?: string;
      type?: string;
      name?: string;
      argsParts: string[];
    }
  >;
}

async function aggregateSSEToCompletion(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
): Promise<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const choices = new Map<number, AggregatedChoice>();
  let id = "";
  let created = Math.floor(Date.now() / 1000);
  let model = fallbackModel;
  let usage: Record<string, unknown> | undefined;

  const ensureChoice = (idx: number): AggregatedChoice => {
    let c = choices.get(idx);
    if (!c) {
      c = {
        index: idx,
        content: "",
        reasoning: "",
        role: "assistant",
        finishReason: null,
        toolCalls: new Map(),
      };
      choices.set(idx, c);
    }
    return c;
  };

  const handleEvent = (event: string): void => {
    const lines = event.split("\n").filter((l) => l.startsWith("data:"));
    if (lines.length === 0) return;
    const payload = lines.map((l) => l.replace(/^data:\s?/, "")).join("\n");
    if (payload.trim() === "[DONE]") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof parsed.id === "string" && !id) id = parsed.id;
    if (typeof parsed.created === "number") created = parsed.created;
    if (typeof parsed.model === "string") model = parsed.model;
    if (parsed.usage && typeof parsed.usage === "object") {
      usage = parsed.usage as Record<string, unknown>;
    }
    const chs = parsed.choices;
    if (!Array.isArray(chs)) return;
    for (const rawChoice of chs) {
      if (!rawChoice || typeof rawChoice !== "object") continue;
      const rc = rawChoice as Record<string, unknown>;
      const idx = typeof rc.index === "number" ? rc.index : 0;
      const ch = ensureChoice(idx);
      const delta = rc.delta as Record<string, unknown> | undefined;
      if (delta) {
        if (typeof delta.role === "string") ch.role = delta.role;
        if (typeof delta.content === "string") ch.content += delta.content;
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === "string") ch.reasoning += reasoning;
        const toolCalls = delta.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            if (!tc || typeof tc !== "object") continue;
            const tcObj = tc as Record<string, unknown>;
            const tIdx = typeof tcObj.index === "number" ? tcObj.index : 0;
            let entry = ch.toolCalls.get(tIdx);
            if (!entry) {
              entry = { argsParts: [] };
              ch.toolCalls.set(tIdx, entry);
            }
            if (typeof tcObj.id === "string") entry.id = tcObj.id;
            if (typeof tcObj.type === "string") entry.type = tcObj.type;
            const fn = tcObj.function as Record<string, unknown> | undefined;
            if (fn) {
              if (typeof fn.name === "string") entry.name = fn.name;
              if (typeof fn.arguments === "string")
                entry.argsParts.push(fn.arguments);
            }
          }
        }
      }
      if (typeof rc.finish_reason === "string") ch.finishReason = rc.finish_reason;
    }
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleEvent(event);
        idx = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } finally {
    reader.releaseLock();
  }

  const outChoices = Array.from(choices.values())
    .sort((a, b) => a.index - b.index)
    .map((ch) => {
      const finalContent = ch.reasoning
        ? `<think>${ch.reasoning}</think>${ch.content}`
        : ch.content;
      const toolCallsArr = Array.from(ch.toolCalls.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id ?? "",
          type: tc.type ?? "function",
          function: {
            name: tc.name ?? "",
            arguments: tc.argsParts.join(""),
          },
        }));
      const message: Record<string, unknown> = {
        role: ch.role,
        content: finalContent,
      };
      if (toolCallsArr.length > 0) message.tool_calls = toolCallsArr;
      return {
        index: ch.index,
        message,
        finish_reason: ch.finishReason ?? "stop",
      };
    });

  const result: Record<string, unknown> = {
    id: id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created,
    model,
    choices: outChoices,
  };
  if (usage) result.usage = usage;
  return result;
}

function writeJsonError(
  writer: StreamWriter,
  statusCode: number,
  type: string,
  message: string,
  code?: string,
): void {
  writer.writeHead(statusCode, { "content-type": "application/json" });
  writer.write(
    JSON.stringify({ error: { type, message, ...(code ? { code } : {}) } }),
  );
  writer.end();
}

// ---------- mock helpers ----------

function buildMockReply(body: Record<string, unknown>): {
  model: string;
  reply: string;
  promptTokens: number;
  completionTokens: number;
} {
  const model = typeof body.model === "string" ? body.model : "mock-model";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages]
    .reverse()
    .find(
      (m): m is { role: string; content: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { role?: string }).role === "user",
    );
  const echoed =
    lastUser && typeof lastUser.content === "string"
      ? lastUser.content
      : "(no user message)";
  const reply = `[mock:${model}] You said: ${echoed}`;
  return {
    model,
    reply,
    promptTokens: echoed.length,
    completionTokens: reply.length,
  };
}

function writeMockBuffered(
  writer: StreamWriter,
  body: Record<string, unknown>,
): void {
  const { model, reply, promptTokens, completionTokens } = buildMockReply(body);
  const payload = {
    id: `chatcmpl-mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: reply },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
  writer.writeHead(200, { "content-type": "application/json" });
  writer.write(JSON.stringify(payload));
  writer.end();
}

async function writeMockStream(
  writer: StreamWriter,
  body: Record<string, unknown>,
): Promise<void> {
  const { model, reply, promptTokens, completionTokens } = buildMockReply(body);
  writer.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  });
  const id = `chatcmpl-mock-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const emit = (obj: unknown): void => {
    writer.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  emit({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  const sliceSize = 5;
  for (let i = 0; i < reply.length; i += sliceSize) {
    emit({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content: reply.slice(i, i + sliceSize) },
          finish_reason: null,
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 20));
  }

  emit({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });

  emit({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });

  writer.write("data: [DONE]\n\n");
  writer.end();
}
