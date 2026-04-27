/**
 * Core `/v1/chat/completions` pipeline — a transparent forwarder.
 *
 * The caller's `Authorization: Bearer sk-xxx` header is passed through to
 * newapi verbatim; newapi owns key verification, quota enforcement, and
 * usage logging.
 *
 * The only product-level decision TokenBoss makes here is: if the caller's
 * key belongs to a free-tier user (via the `api_key_index` lookup), we
 * silently rewrite any non-eco model to an eco one before forwarding.
 * Paid / unknown callers pass through unchanged.
 *
 * The other reshaping we do is:
 *   - Strip ClawRouter's `provider/` model prefix for flat-namespace
 *     aggregators (unless `UPSTREAM_PRESERVE_MODEL_PREFIX=1`)
 *   - Synthesize a fake response when `MOCK_UPSTREAM=1` (local dev)
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { Agent } from "undici";
import { createHash } from "node:crypto";

import { isMockMode } from "./upstream.js";
import { detectVirtualProfile, resolveVirtualModel } from "../router/resolve.js";
import { getUser, getUserIdByKeyHash } from "./store.js";

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

// ---------- Free-user model rewrite helpers ----------

/** Tier classification for the free-user "is this allowed" decision. */
export type ModelTier = "eco" | "standard" | "premium" | "reasoning";

/**
 * Map a concrete model ID to a tier. Used to decide whether a free user's
 * request needs rewriting (only non-eco models do).
 *
 * - eco:       haiku / mini / flash — cheapest
 * - standard:  sonnet / gpt-4o / gpt-4
 * - premium:   opus
 * - reasoning: o1 / o3 / gpt-5 non-mini
 */
export function inferTierFromModelId(modelId: string): ModelTier {
  const m = modelId.toLowerCase();
  if (m === "auto" || m === "eco" || m === "premium" || m === "agentic") return "eco";
  if (/\bo[13]\b/.test(m) || (/gpt-5/.test(m) && !/mini/.test(m))) return "reasoning";
  if (/haiku/.test(m) || /mini/.test(m) || /flash/.test(m)) return "eco";
  if (/opus/.test(m)) return "premium";
  if (/sonnet/.test(m) || /gpt-4o/.test(m) || /gpt-4/.test(m)) return "standard";
  return "standard";
}

/** Last 8 chars of the bearer (for log attribution only — no longer
 *  used for quota math). */
export function extractKeyHint(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = m ? m[1].trim() : authHeader.trim();
  if (token.length < 4) return null;
  return token.slice(-8);
}

/** Pull the raw bearer token from `Authorization` (case-insensitive). */
function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : authHeader.trim();
}

/**
 * Resolve the calling user's plan via the api_key_index reverse lookup.
 *
 * Returns `'free' | 'plus' | 'super' | 'ultra' | null`. `null` means the
 * key is unknown to TokenBoss (anonymous direct caller, or a token created
 * before backfill ran) — chatProxyCore must treat these as pass-through
 * with no rewriting.
 */
async function resolveCallerPlan(
  authHeader: string | undefined,
): Promise<string | null> {
  const token = extractBearer(authHeader);
  if (!token) return null;
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const userId = getUserIdByKeyHash(hash);
    if (!userId) return null;
    const user = await getUser(userId);
    return user?.plan ?? null;
  } catch (err) {
    console.warn(`[chatProxy] resolveCallerPlan failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Free-tier model rewrite. Mutates `body.model` in place when needed.
 *
 * Whenever the request resolves to a non-eco tier we hand it off to the
 * `eco` virtual profile, which `resolveVirtualModel` then resolves via
 * `data/router-tiers.json` `ecoTiers`. This keeps the eco model catalog
 * in ONE place (the router config) instead of TokenBoss picking a model
 * out of thin air.
 *
 * Cases:
 *   - Already eco virtual or eco-tier concrete model → no change
 *   - Non-eco virtual (`auto` / `premium` / `agentic`) → "eco"
 *   - Non-eco concrete model (opus / sonnet / o-series / gpt-5)  → "eco"
 *
 * This is silent on purpose — the user's product spec says free users
 * always get eco, regardless of what their tool requested.
 */
function rewriteForFreeUser(body: Record<string, unknown>): void {
  if (typeof body.model !== "string") return;
  const original = body.model;

  const profile = detectVirtualProfile(original);
  if (profile === "eco") return;
  if (!profile && inferTierFromModelId(original) === "eco") return;

  body.model = "eco";
  console.log(`[free-rewrite] ${original} → eco`);
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

  // ---------- Free-tier model rewrite (silent) ----------
  // Look up the caller's plan via api_key_index; if free, rewrite any
  // non-eco model down to eco. Unknown callers (no index hit) pass through
  // unchanged — newapi will still gate them by remain_quota.
  const callerPlan = await resolveCallerPlan(authHeader);
  if (callerPlan === "free") {
    rewriteForFreeUser(body);
  }

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
      writer.writeHead(upstreamRes.status, { "content-type": "application/json" });
      writer.write(JSON.stringify(aggregated));
      writer.end();
      return;
    }

    const responseText = await upstreamRes.text();
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
