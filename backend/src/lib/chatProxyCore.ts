/**
 * Core `/v1/chat/completions` pipeline — a transparent forwarder.
 *
 * The caller's `Authorization: Bearer sk-xxx` header is passed through to
 * newapi verbatim; newapi owns key verification, quota enforcement, and
 * usage logging. All callers (trial, default, plus/super/ultra, anonymous)
 * are treated identically here — newapi's per-group quota gates the rest.
 *
 * The reshaping we do is:
 *   - Resolve TokenBoss virtual profiles (auto / eco / premium / agentic)
 *     into concrete model ids via `router/resolve`
 *   - Strip ClawRouter's `provider/` model prefix for flat-namespace
 *     aggregators (unless `UPSTREAM_PRESERVE_MODEL_PREFIX=1`)
 *   - Synthesize a fake response when `MOCK_UPSTREAM=1` (local dev)
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHash, randomBytes } from "node:crypto";
import { Agent } from "undici";

import { isMockMode } from "./upstream.js";
import { detectVirtualProfile, resolveVirtualModel } from "../router/resolve.js";
import {
  getUserIdByKeyHash,
  insertAttribution,
} from "./store.js";
import { resolveSource } from "./sourceAttribution.js";

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

/** Pull the raw bearer token out of an Authorization header. Returns null
 *  for missing/empty header. Used by both extractKeyHint (last-8-chars)
 *  and the attribution block (sha256 → api_key_index lookup). */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = m ? m[1].trim() : authHeader.trim();
  return token.length > 0 ? token : null;
}

/** Last 8 chars of the bearer (for log attribution only — no longer
 *  used for quota math). */
export function extractKeyHint(authHeader: string | undefined): string | null {
  const token = extractBearerToken(authHeader);
  if (!token || token.length < 4) return null;
  return token.slice(-8);
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

  // ---------- Source attribution (best-effort, non-blocking) ----------
  // Generate our own request_id EARLY — forwarded to upstream as X-Request-ID
  // so newapi can (hopefully) log it as the entry's request_id, enabling an
  // exact join in /v1/usage. Even if newapi re-rolls it, the soft-join path
  // covers it. The attribution row itself is written AFTER model resolution +
  // prefix-strip (see below) so that attribution.model matches the concrete
  // model id that newapi will actually log.
  const requestId = `tb-${randomBytes(8).toString('hex')}`;

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

  // LATE attribution capture — runs AFTER body.model is fully resolved +
  // prefix-stripped, so attribution.model matches the concrete model id that
  // newapi will actually log. The soft-join filter in usageHandlers compares
  // attr.model === entry.model_name; capturing the user-supplied virtual name
  // (e.g. "auto") instead of the resolved concrete id made that filter always
  // miss, degrading every virtual-profile call to source='other'.
  if (process.env.SOURCE_ATTRIBUTION !== 'off') {
    try {
      const bearer = extractBearerToken(authHeader);
      if (bearer) {
        const keyHash = createHash('sha256').update(bearer).digest('hex');
        const ownerUserId = getUserIdByKeyHash(keyHash);
        if (ownerUserId) {
          const headerMap: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(event.headers ?? {})) {
            if (typeof v === 'string') headerMap[k] = v;
          }
          const { slug, method } = resolveSource(headerMap);
          insertAttribution({
            requestId,
            userId: ownerUserId,
            source: slug,
            sourceMethod: method,
            model: typeof body.model === 'string' ? body.model : null,
            capturedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      // Best-effort: never block the chat completion on attribution.
      console.warn('[chatProxy] attribution insert failed', {
        requestId,
        error: (err as Error).message,
      });
    }
  }

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
            "x-request-id": requestId,
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

// ---------- /v1/responses (OpenAI Responses API — used by Codex CLI) ----------

/**
 * Best-effort conversion of Responses API `input` + `instructions` into the
 * chat-completions `messages` shape that the virtual-model classifier expects.
 *
 * `input` may be a plain string or an array of input items
 * (`{role, content: [{type:"input_text", text}]}`); `instructions` is the
 * top-level system prompt. We just need enough fidelity for `extractPrompts`
 * in `router/resolve.ts` to pull last-user/system text — full type accuracy
 * isn't needed because virtual routing on the responses path is rare anyway
 * (Codex CLI passes concrete model ids).
 */
function responsesInputToMessages(
  body: Record<string, unknown>,
): Array<{ role: string; content: unknown }> {
  const out: Array<{ role: string; content: unknown }> = [];
  if (typeof body.instructions === "string" && body.instructions.length > 0) {
    out.push({ role: "system", content: body.instructions });
  }
  const input = body.input;
  if (typeof input === "string") {
    out.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const role = typeof it.role === "string" ? it.role : "user";
      const content = it.content;
      if (Array.isArray(content)) {
        const text = content
          .map((part) => {
            if (!part || typeof part !== "object") return "";
            const p = part as Record<string, unknown>;
            return typeof p.text === "string" ? p.text : "";
          })
          .filter((t) => t.length > 0)
          .join(" ");
        out.push({ role, content: text });
      } else {
        out.push({ role, content });
      }
    }
  }
  return out;
}

/**
 * Transparent forwarder for `POST /v1/responses` — used by Codex CLI and
 * any other client targeting the OpenAI Responses API.
 *
 * Mirrors `streamChatCore` but trimmed: Responses API SSE is byte-pipeable
 * (the `event: response.xxx` named events go through verbatim), and there's
 * no equivalent of the gpt-* "force upstream stream and aggregate"
 * workaround — Responses exposes reasoning in dedicated `output_reasoning`
 * items so non-stream mode through newapi is reliable.
 */
export async function streamResponsesCore(
  event: APIGatewayProxyEventV2,
  writer: StreamWriter,
): Promise<void> {
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization;

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

  let fallbackModels: string[] = [];
  if (typeof body.model === "string") {
    const profile = detectVirtualProfile(body.model);
    if (profile) {
      try {
        const maxTokens =
          typeof body.max_output_tokens === "number"
            ? body.max_output_tokens
            : 4096;
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const messages = responsesInputToMessages(body);
        const resolved = await resolveVirtualModel(
          profile,
          messages,
          hasTools,
          maxTokens,
        );
        console.log(
          `[router] ${body.model} → ${resolved.primary} (tier=${resolved.tier}, profile=${resolved.profile}) fallback=[${resolved.fallback.join(", ")}]`,
        );
        body.model = resolved.primary;
        fallbackModels = resolved.fallback;
      } catch (err) {
        console.error(`[router] resolve failed: ${String(err)}`);
      }
    }
  }

  if (
    typeof body.model === "string" &&
    body.model.includes("/") &&
    process.env.UPSTREAM_PRESERVE_MODEL_PREFIX !== "1"
  ) {
    const stripped = body.model.slice(body.model.lastIndexOf("/") + 1);
    if (stripped.length > 0) body.model = stripped;
  }
  fallbackModels = fallbackModels.map((m) =>
    m.includes("/") && process.env.UPSTREAM_PRESERVE_MODEL_PREFIX !== "1"
      ? m.slice(m.lastIndexOf("/") + 1)
      : m,
  );

  const wantsStream = body.stream === true;

  try {
    if (isMockMode()) {
      writeJsonError(
        writer,
        503,
        "service_unavailable",
        "Mock mode is not implemented for /v1/responses.",
        "mock_not_supported",
      );
      return;
    }

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
        "Responses proxy is unavailable — NEWAPI_BASE_URL is not configured.",
        "newapi_not_configured",
      );
      return;
    }

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
        const res = await fetch(`${base}/v1/responses`, {
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
            `[responsesProxy] upstream ${model} returned ${res.status}; trying fallback`,
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
          `[responsesProxy] upstream fetch failed for ${model}: ${String(err)}`,
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

    const responseText = await upstreamRes.text();
    writer.writeHead(upstreamRes.status, { "content-type": contentType });
    writer.write(responseText);
    writer.end();
  } catch (err) {
    console.error(`[responsesProxy] unexpected error during handling:`, err);
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
