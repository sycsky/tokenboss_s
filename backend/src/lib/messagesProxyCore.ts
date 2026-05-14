/**
 * Core POST /v1/messages pipeline — the Anthropic-compat shim.
 *
 * Why this file exists: Claude Code, Anthropic SDKs, and various agent CLIs
 * speak the Anthropic Messages API natively. Internally TokenBoss only knows
 * how to forward the OpenAI Chat Completions shape (chatProxyCore). This
 * module is the translation glue:
 *
 *   1. Parse Anthropic request → convert to OpenAI Chat request (anthropicConvert.requestToOpenAI)
 *   2. Normalize auth header (`x-api-key: sk-xxx` → `Authorization: Bearer sk-xxx`)
 *      since chatProxyCore only understands Bearer headers.
 *   3. Dispatch to chatProxyCore (NO HTTP — direct in-process call) by
 *      constructing a fresh APIGatewayProxyEventV2 and providing a synthetic
 *      StreamWriter that captures the OpenAI response.
 *   4. Translate captured response back to Anthropic format:
 *      - Non-stream:   buffer the JSON, run responseToAnthropic, return one shot.
 *      - Stream:       feed parsed OpenAI SSE chunks into the streamToAnthropic
 *                      async generator, serialize the resulting Anthropic
 *                      SSE events, write to the user's writer in real time.
 *   5. Error envelopes (status 4xx/5xx with JSON body) are re-wrapped to
 *      Anthropic-format errors (errorToAnthropic) regardless of whether the
 *      client asked for streaming, because no partial events were emitted.
 *
 * This file is intentionally pure of any Lambda-runtime globals so it can
 * also run from the local dev server (see local.ts handleChatStream).
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { randomBytes } from "node:crypto";

import {
  errorToAnthropic,
  requestToOpenAI,
  responseToAnthropic,
  streamToAnthropic,
} from "./anthropicConvert.js";
import type {
  AnthropicMessagesRequest,
  AnthropicSSEEvent,
  OpenAIChatChunk,
  OpenAIChatResponse,
} from "./anthropicTypes.js";
import { streamChatCore, type StreamWriter } from "./chatProxyCore.js";

/**
 * Main entry point. Mirrors `streamChatCore`'s `(event, writer)` shape so
 * `local.ts` / `messagesProxy.ts` can wire it the same way as the chat path.
 */
export async function runMessagesCore(
  event: APIGatewayProxyEventV2,
  writer: StreamWriter,
): Promise<void> {
  // ---------- 1. Parse Anthropic request body ----------
  let req: AnthropicMessagesRequest;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    req = raw ? (JSON.parse(raw) as AnthropicMessagesRequest) : ({} as AnthropicMessagesRequest);
  } catch (err) {
    writeAnthropicError(writer, {
      status: 400,
      type: "invalid_request_error",
      message: `Could not parse JSON body: ${String(err)}`,
    });
    return;
  }

  // Basic shape validation — Anthropic requires `model`, `messages`, `max_tokens`.
  // We don't replicate the full schema (chatProxyCore does its own checks once
  // we forward) but the bare minimum lets us avoid sending obviously broken
  // input downstream.
  if (
    typeof req.model !== "string" ||
    !Array.isArray(req.messages) ||
    typeof req.max_tokens !== "number"
  ) {
    writeAnthropicError(writer, {
      status: 400,
      type: "invalid_request_error",
      message:
        "Request body must include `model` (string), `messages` (array), and `max_tokens` (number).",
    });
    return;
  }

  const isStream = req.stream === true;
  const originalModel = req.model;

  // ---------- 2. Anthropic → OpenAI request conversion ----------
  let openaiReq;
  try {
    openaiReq = requestToOpenAI(req);
  } catch (err) {
    writeAnthropicError(writer, {
      status: 400,
      type: "invalid_request_error",
      message: `Request translation failed: ${(err as Error).message}`,
    });
    return;
  }
  // Force stream:true when the client asked for streaming — requestToOpenAI
  // does pass it through, but be explicit so we don't silently drop it on a
  // future refactor.
  if (isStream) openaiReq.stream = true;

  // ---------- 3. Build a fresh event for chatProxyCore ----------
  const innerHeaders = normalizeAuthHeader(event.headers);
  const innerEvent: APIGatewayProxyEventV2 = {
    ...event,
    rawPath: "/v1/chat/completions",
    routeKey: "POST /v1/chat/completions",
    requestContext: {
      ...event.requestContext,
      http: {
        ...event.requestContext.http,
        path: "/v1/chat/completions",
      },
      routeKey: "POST /v1/chat/completions",
    },
    headers: innerHeaders,
    body: JSON.stringify(openaiReq),
    isBase64Encoded: false,
  };

  // ---------- 4. Dispatch + translate response ----------
  if (isStream) {
    await runStreaming(innerEvent, writer, originalModel);
  } else {
    await runNonStreaming(innerEvent, writer, originalModel);
  }
}

// ============================================================================
// Non-streaming path
// ============================================================================

/**
 * Buffer the full chatProxyCore response, then either:
 *   - 200 OK + OpenAI chat.completion JSON → translate to Anthropic
 *     messages response.
 *   - Non-2xx + OpenAI error JSON → rewrap as Anthropic error envelope.
 */
async function runNonStreaming(
  innerEvent: APIGatewayProxyEventV2,
  writer: StreamWriter,
  originalModel: string,
): Promise<void> {
  const cap = makeBufferingWriter();
  try {
    await streamChatCore(innerEvent, cap.writer);
  } catch (err) {
    writeAnthropicError(writer, {
      status: 500,
      type: "api_error",
      message: `Upstream call failed: ${(err as Error).message}`,
    });
    return;
  }

  const status = cap.status ?? 200;
  const bodyText = cap.body;

  if (status >= 400) {
    forwardUpstreamErrorAsAnthropic(writer, status, bodyText);
    return;
  }

  // Happy path: parse as OpenAI ChatCompletion and translate.
  let openaiResp: OpenAIChatResponse;
  try {
    openaiResp = JSON.parse(bodyText) as OpenAIChatResponse;
  } catch (err) {
    writeAnthropicError(writer, {
      status: 502,
      type: "api_error",
      message: `Upstream returned non-JSON body: ${(err as Error).message}`,
    });
    return;
  }

  try {
    const anthropicResp = responseToAnthropic(openaiResp, originalModel);
    writer.writeHead(200, { "content-type": "application/json" });
    writer.write(JSON.stringify(anthropicResp));
    writer.end();
  } catch (err) {
    writeAnthropicError(writer, {
      status: 502,
      type: "api_error",
      message: `Response translation failed: ${(err as Error).message}`,
    });
  }
}

// ============================================================================
// Streaming path
// ============================================================================

/**
 * Real-time streaming pipeline. Producer (chatProxyCore via capture writer)
 * parses upstream SSE → pushes OpenAIChatChunk into an async queue. Consumer
 * runs streamToAnthropic on that queue and writes serialized Anthropic SSE
 * events to the user writer. Both run concurrently so bytes flow without
 * buffering the full response.
 *
 * Error handling: if chatProxyCore writes a non-2xx status (i.e. error
 * envelope before any SSE data), we detect it via the capture writer's
 * `errorMode` flag and emit a single Anthropic-format error JSON instead of
 * partial SSE events. Mid-stream upstream failures (after status 200 + at
 * least one event already emitted to the user) terminate the stream cleanly
 * — Anthropic's public SSE protocol has no formal "error event", so EOF is
 * the least-bad signal.
 */
async function runStreaming(
  innerEvent: APIGatewayProxyEventV2,
  writer: StreamWriter,
  originalModel: string,
): Promise<void> {
  const queue = createAsyncChunkQueue();
  const cap = makeStreamingCaptureWriter(queue);

  // Spawn the Anthropic SSE consumer concurrently. It blocks on queue.next()
  // until the producer (chatProxyCore via cap.writer) pushes chunks.
  const messageId = `msg_${randomBytes(12).toString("hex")}`;
  const inputTokens = estimateInputTokens(innerEvent);

  // Track whether we've written the SSE 200 head. Used to decide whether a
  // late error can still surface as a JSON envelope (no head yet) or must
  // terminate the stream silently (head already sent).
  let sseHeadWritten = false;

  const consumer = (async (): Promise<void> => {
    const gen = streamToAnthropic(queue.iterable, {
      messageId,
      model: originalModel,
      inputTokens,
    });
    for await (const ev of gen) {
      if (cap.errorMode) continue;
      if (!sseHeadWritten) {
        writer.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-accel-buffering": "no",
        });
        sseHeadWritten = true;
      }
      writer.write(serializeAnthropicSSE(ev));
    }
  })();

  // Run producer (chatProxyCore). It will populate cap.writer; cap.writer
  // either pushes chunks into the queue (success SSE) or buffers an error
  // body (errorMode).
  try {
    await streamChatCore(innerEvent, cap.writer);
  } catch (err) {
    queue.close();
    await consumer.catch(() => {
      /* consumer error swallowed; we'll surface a single error below */
    });
    if (cap.errorMode || !sseHeadWritten) {
      writeAnthropicError(writer, {
        status: 500,
        type: "api_error",
        message: `Upstream call failed: ${(err as Error).message}`,
      });
    } else {
      // Stream already opened; least-bad option is to just end the stream.
      try {
        writer.end();
      } catch {
        /* already closed */
      }
    }
    return;
  }

  // Producer done. Close the queue so the consumer's for-await drains.
  queue.close();
  await consumer;

  // If chatProxyCore wrote an error body (non-2xx), forward it as
  // Anthropic-format JSON now (the consumer didn't write anything since
  // errorMode short-circuited it).
  if (cap.errorMode) {
    forwardUpstreamErrorAsAnthropic(writer, cap.status ?? 500, cap.errorBody);
    return;
  }

  // Make sure the writer is closed even if the consumer never emitted
  // anything (e.g. upstream sent zero chunks).
  if (!sseHeadWritten) {
    // No SSE events ever emitted, no error — still need to send *something*.
    // Anthropic clients tolerate an empty 200 reply but it's strange; emit
    // a minimal message_start/_stop so the client doesn't hang.
    writer.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    });
    writer.write(
      serializeAnthropicSSE({
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            content: [],
            model: originalModel,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: 0 },
          },
        },
      }),
    );
    writer.write(
      serializeAnthropicSSE({ event: "message_stop", data: { type: "message_stop" } }),
    );
  }
  try {
    writer.end();
  } catch {
    /* already closed */
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize the auth header so chatProxyCore (which only reads
 * `Authorization: Bearer`) sees what it expects. Precedence:
 *   1. Explicit `Authorization: Bearer ...` — pass through unchanged.
 *   2. `x-api-key: sk-...` — copy into Authorization.
 *   3. Neither — pass through unchanged; chatProxyCore will return 401.
 */
function normalizeAuthHeader(
  headers: APIGatewayProxyEventV2["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  const src = headers ?? {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
  }
  const hasAuth = "authorization" in out && out.authorization.length > 0;
  const xKey = out["x-api-key"];
  if (!hasAuth && typeof xKey === "string" && xKey.length > 0) {
    out.authorization = xKey.toLowerCase().startsWith("bearer ")
      ? xKey
      : `Bearer ${xKey}`;
  }
  return out;
}

/**
 * Crude input-token estimate so message_start can report a non-zero
 * input_tokens value. We don't have access to the real tokenizer here; the
 * estimate is good enough for clients that display "in: X tokens" (they
 * usually overwrite it once message_delta lands with the real usage).
 *
 * Rule of thumb: ~4 chars per token. Strip JSON envelope chars so the
 * estimate tracks the actual prompt content, not formatting overhead.
 */
function estimateInputTokens(event: APIGatewayProxyEventV2): number {
  const raw = event.body ?? "";
  if (!raw) return 0;
  return Math.max(1, Math.ceil(raw.length / 4));
}

/** Serialize one Anthropic SSE event to the wire format. */
function serializeAnthropicSSE(ev: AnthropicSSEEvent): string {
  return `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

/** Write an Anthropic error envelope as a single non-stream JSON response. */
function writeAnthropicError(
  writer: StreamWriter,
  err: { status: number; type: string; message: string },
): void {
  const { status, body } = errorToAnthropic(err);
  writer.writeHead(status, { "content-type": "application/json" });
  writer.write(JSON.stringify(body));
  writer.end();
}

/**
 * Inspect a buffered upstream error body and forward it as an
 * Anthropic-format error JSON. Recognises both OpenAI-style
 * `{error: {type, message}}` envelopes and chatProxyCore's
 * `insufficient_balance` 402 rewrite.
 */
function forwardUpstreamErrorAsAnthropic(
  writer: StreamWriter,
  status: number,
  bodyText: string,
): void {
  let upstreamType = "api_error";
  let upstreamMessage = bodyText || `Upstream returned status ${status}`;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { type?: string; message?: string };
    };
    if (parsed.error) {
      if (typeof parsed.error.type === "string") upstreamType = parsed.error.type;
      if (typeof parsed.error.message === "string") {
        upstreamMessage = parsed.error.message;
      }
    }
  } catch {
    /* upstream body isn't JSON — leave defaults */
  }
  writeAnthropicError(writer, {
    status,
    type: upstreamType,
    message: upstreamMessage,
  });
}

// ----------- Capture writers -----------

interface BufferingCapture {
  writer: StreamWriter;
  status: number | undefined;
  body: string;
}

/**
 * Simple all-in-memory writer for the non-streaming path. We need to inspect
 * status + body before deciding how to translate, so buffering is fine —
 * non-stream responses are typically small.
 */
function makeBufferingWriter(): BufferingCapture {
  const cap: BufferingCapture = { writer: {} as StreamWriter, status: undefined, body: "" };
  cap.writer = {
    writeHead(s) {
      cap.status = s;
    },
    write(chunk) {
      cap.body +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    },
    end() {
      /* no-op */
    },
  };
  return cap;
}

interface StreamingCapture {
  writer: StreamWriter;
  /** True if chatProxyCore wrote a non-2xx status (error envelope path). */
  errorMode: boolean;
  status: number | undefined;
  /** Buffered error body, only populated when errorMode is true. */
  errorBody: string;
}

/**
 * Writer that parses incoming OpenAI SSE bytes line-by-line and pushes
 * parsed `OpenAIChatChunk` objects into the async queue. The first
 * `writeHead` call decides between two modes:
 *   - status 2xx → SSE parsing mode (write() expects SSE wire format)
 *   - status non-2xx → error buffering mode (write() accumulates the JSON
 *     body for later forwardUpstreamErrorAsAnthropic)
 */
function makeStreamingCaptureWriter(
  queue: AsyncChunkQueue,
): StreamingCapture {
  const cap: StreamingCapture = {
    writer: {} as StreamWriter,
    errorMode: false,
    status: undefined,
    errorBody: "",
  };
  let sseBuffer = "";

  const flushSseBuffer = (): void => {
    // SSE events are delimited by blank lines (\n\n).
    let idx = sseBuffer.indexOf("\n\n");
    while (idx !== -1) {
      const evBlock = sseBuffer.slice(0, idx);
      sseBuffer = sseBuffer.slice(idx + 2);
      handleSseBlock(evBlock);
      idx = sseBuffer.indexOf("\n\n");
    }
  };

  const handleSseBlock = (block: string): void => {
    const lines = block.split("\n").filter((l) => l.startsWith("data:"));
    if (lines.length === 0) return;
    const payload = lines.map((l) => l.replace(/^data:\s?/, "")).join("\n");
    if (payload.trim() === "[DONE]") return;
    try {
      const chunk = JSON.parse(payload) as OpenAIChatChunk;
      queue.push(chunk);
    } catch {
      /* malformed chunk — drop, same behavior as aggregateSSEToCompletion */
    }
  };

  cap.writer = {
    writeHead(s) {
      cap.status = s;
      if (s < 200 || s >= 300) cap.errorMode = true;
    },
    write(chunk) {
      const str =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (cap.errorMode) {
        cap.errorBody += str;
        return;
      }
      sseBuffer += str;
      flushSseBuffer();
    },
    end() {
      // Drain any trailing partial event.
      if (!cap.errorMode && sseBuffer.trim().length > 0) {
        handleSseBlock(sseBuffer);
        sseBuffer = "";
      }
    },
  };
  return cap;
}

// ----------- Async chunk queue (single producer, single consumer) -----------
//
// A minimal promise-based queue: push() drops items into a buffer, the
// AsyncIterable yields them in order, blocking on a pending promise when
// the buffer is empty. close() signals end-of-stream.

interface AsyncChunkQueue {
  push(chunk: OpenAIChatChunk): void;
  close(): void;
  iterable: AsyncIterable<OpenAIChatChunk>;
}

function createAsyncChunkQueue(): AsyncChunkQueue {
  const buffer: OpenAIChatChunk[] = [];
  let closed = false;
  let pendingResolve: (() => void) | null = null;

  const waitForData = (): Promise<void> => {
    if (buffer.length > 0 || closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      pendingResolve = resolve;
    });
  };

  const wakeConsumer = (): void => {
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
  };

  const iterable: AsyncIterable<OpenAIChatChunk> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<OpenAIChatChunk>> {
          while (buffer.length === 0 && !closed) {
            await waitForData();
          }
          if (buffer.length > 0) {
            return { value: buffer.shift() as OpenAIChatChunk, done: false };
          }
          return { value: undefined as unknown as OpenAIChatChunk, done: true };
        },
      };
    },
  };

  return {
    push(chunk) {
      if (closed) return;
      buffer.push(chunk);
      wakeConsumer();
    },
    close() {
      closed = true;
      wakeConsumer();
    },
    iterable,
  };
}
