/**
 * Integration tests for runMessagesCore — the Anthropic-compat shim that
 * wraps chatProxyCore.streamChatCore.
 *
 * Strategy: we vi.mock the chatProxyCore module so we can both
 *   1) capture the headers / body that runMessagesCore forwards (verifying
 *      Anthropic → OpenAI translation + auth header normalization), and
 *   2) drive synthetic OpenAI responses (JSON or SSE chunks) back through
 *      the writer, so we can verify the Anthropic-format response shape /
 *      Anthropic SSE event sequence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { StreamWriter } from "../chatProxyCore.js";

// ---------- vi.mock chatProxyCore so we can drive replies ----------
//
// The mock exposes a settable handler (`mockStreamChatCore`) that the test
// installs per-case; that handler is called with (event, writer) and is
// free to write either a non-stream JSON body, an SSE byte stream, or an
// error envelope. We also capture the last event so tests can assert what
// headers/body chatProxyCore received.

let capturedEvent: APIGatewayProxyEventV2 | null = null;
type MockHandler = (event: APIGatewayProxyEventV2, writer: StreamWriter) => Promise<void> | void;
let mockStreamChatCore: MockHandler = async () => {
  /* default: no-op */
};

vi.mock("../chatProxyCore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chatProxyCore.js")>();
  return {
    ...actual,
    streamChatCore: async (event: APIGatewayProxyEventV2, writer: StreamWriter) => {
      capturedEvent = event;
      await mockStreamChatCore(event, writer);
    },
  };
});

// Imported AFTER vi.mock so the mock takes effect.
const { runMessagesCore } = await import("../messagesProxyCore.js");

beforeEach(() => {
  capturedEvent = null;
  mockStreamChatCore = async () => {
    /* default: no-op */
  };
});

// ---------- Test helpers ----------

/** Build an in-memory StreamWriter that records every call so tests can assert. */
function makeRecordingWriter(): {
  writer: StreamWriter;
  status: () => number | undefined;
  headers: () => Record<string, string> | undefined;
  body: () => string;
  ended: () => boolean;
} {
  let status: number | undefined;
  let headers: Record<string, string> | undefined;
  let body = "";
  let ended = false;
  const writer: StreamWriter = {
    writeHead(s, h) {
      status = s;
      headers = h;
    },
    write(chunk) {
      body +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    },
    end() {
      ended = true;
    },
  };
  return {
    writer,
    status: () => status,
    headers: () => headers,
    body: () => body,
    ended: () => ended,
  };
}

/** Construct a minimal APIGatewayProxyEventV2 for a POST /v1/messages. */
function makeEvent(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /v1/messages",
    rawPath: "/v1/messages",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "localhost",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/v1/messages",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-req",
      routeKey: "POST /v1/messages",
      stage: "test",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

/** Split a buffered SSE body into per-event { event, data } objects. */
function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  // Split on blank line, the SSE event delimiter.
  for (const block of raw.split("\n\n")) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    const dataStr = dataLines.join("\n");
    if (dataStr === "[DONE]") continue;
    try {
      out.push({ event, data: JSON.parse(dataStr) });
    } catch {
      out.push({ event, data: dataStr });
    }
  }
  return out;
}

// ============================================================================
// Non-streaming tests
// ============================================================================

describe("messagesProxyCore (non-stream)", () => {
  it("translates Anthropic request → calls chatProxy → translates response back to Anthropic", async () => {
    mockStreamChatCore = (_event, writer) => {
      // Pretend chatProxyCore returned an OpenAI chat.completion.
      writer.writeHead(200, { "content-type": "application/json" });
      writer.write(
        JSON.stringify({
          id: "chatcmpl-abc123",
          object: "chat.completion",
          created: 1700000000,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Hello! How can I help you today?",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 11, total_tokens: 19 },
        }),
      );
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: "Hello, world!" }],
        },
        { authorization: "Bearer sk-test" },
      ),
      rec.writer,
    );

    // Verify: chatProxyCore was invoked with an OpenAI-format body.
    expect(capturedEvent).not.toBeNull();
    const fwdBody = JSON.parse(capturedEvent!.body!);
    expect(fwdBody.model).toBe("claude-sonnet-4-5");
    expect(fwdBody.max_tokens).toBe(1024);
    expect(fwdBody.messages).toEqual([{ role: "user", content: "Hello, world!" }]);
    expect(fwdBody.stream).not.toBe(true);

    // Verify: response is Anthropic-format.
    expect(rec.status()).toBe(200);
    expect(rec.headers()?.["content-type"]).toContain("application/json");
    expect(rec.ended()).toBe(true);
    const resp = JSON.parse(rec.body());
    expect(resp.type).toBe("message");
    expect(resp.role).toBe("assistant");
    expect(resp.content).toEqual([
      { type: "text", text: "Hello! How can I help you today?" },
    ]);
    expect(resp.stop_reason).toBe("end_turn");
    expect(resp.model).toBe("claude-sonnet-4-5");
    expect(resp.usage).toEqual({ input_tokens: 8, output_tokens: 11 });
  });

  it("normalizes x-api-key header to Authorization: Bearer", async () => {
    mockStreamChatCore = (_event, writer) => {
      writer.writeHead(200, { "content-type": "application/json" });
      writer.write(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 16,
          messages: [{ role: "user", content: "ping" }],
        },
        { "x-api-key": "sk-anthropic-style" },
      ),
      rec.writer,
    );

    // chatProxyCore expects Authorization: Bearer — verify we normalized.
    const hdrs = capturedEvent!.headers!;
    const authHdr = hdrs.authorization ?? hdrs.Authorization;
    expect(authHdr).toBe("Bearer sk-anthropic-style");
  });

  it("passes through Authorization: Bearer header unchanged when no x-api-key", async () => {
    mockStreamChatCore = (_event, writer) => {
      writer.writeHead(200, { "content-type": "application/json" });
      writer.write(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 16,
          messages: [{ role: "user", content: "ping" }],
        },
        { authorization: "Bearer sk-openai-style" },
      ),
      rec.writer,
    );

    const hdrs = capturedEvent!.headers!;
    const authHdr = hdrs.authorization ?? hdrs.Authorization;
    expect(authHdr).toBe("Bearer sk-openai-style");
  });

  it("returns Anthropic-format error on chatProxy 401", async () => {
    mockStreamChatCore = (_event, writer) => {
      writer.writeHead(401, { "content-type": "application/json" });
      writer.write(
        JSON.stringify({
          error: {
            type: "authentication_error",
            message: "Missing Authorization header.",
            code: "missing_api_key",
          },
        }),
      );
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
      rec.writer,
    );

    expect(rec.status()).toBe(401);
    expect(rec.ended()).toBe(true);
    const body = JSON.parse(rec.body());
    expect(body).toEqual({
      type: "error",
      error: {
        type: "authentication_error",
        message: expect.stringMatching(/Missing Authorization/i),
      },
    });
  });

  it("returns Anthropic invalid_request_error on malformed JSON body", async () => {
    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent("{ not json", { "x-api-key": "sk-x" }),
      rec.writer,
    );

    expect(rec.status()).toBe(400);
    const body = JSON.parse(rec.body());
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
    // chatProxyCore should NOT have been called.
    expect(capturedEvent).toBeNull();
  });

  it("translates Anthropic system field → OpenAI role:system message", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockStreamChatCore = (event, writer) => {
      capturedBody = JSON.parse(event.body!);
      writer.writeHead(200, { "content-type": "application/json" });
      writer.write(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 16,
          system: "You are a helpful assistant.",
          messages: [{ role: "user", content: "ping" }],
        },
        { "x-api-key": "sk-x" },
      ),
      rec.writer,
    );

    expect(capturedBody).not.toBeNull();
    const messages = (capturedBody as unknown as Record<string, unknown>)
      .messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "ping" });
  });
});

// ============================================================================
// Streaming tests
// ============================================================================

describe("messagesProxyCore (streaming)", () => {
  it("converts OpenAI SSE chunks to Anthropic SSE events in correct order", async () => {
    // The mock writes 5 OpenAI SSE chunks (text delta stream) into the writer.
    mockStreamChatCore = (_event, writer) => {
      writer.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const chunks = [
        {
          id: "chatcmpl-stream-1",
          object: "chat.completion.chunk",
          created: 1700000600,
          model: "claude-sonnet-4-5",
          choices: [
            { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
          ],
        },
        {
          id: "chatcmpl-stream-1",
          object: "chat.completion.chunk",
          created: 1700000600,
          model: "claude-sonnet-4-5",
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        },
        {
          id: "chatcmpl-stream-1",
          object: "chat.completion.chunk",
          created: 1700000600,
          model: "claude-sonnet-4-5",
          choices: [{ index: 0, delta: { content: ", world" }, finish_reason: null }],
        },
        {
          id: "chatcmpl-stream-1",
          object: "chat.completion.chunk",
          created: 1700000600,
          model: "claude-sonnet-4-5",
          choices: [{ index: 0, delta: { content: "!" }, finish_reason: null }],
        },
        {
          id: "chatcmpl-stream-1",
          object: "chat.completion.chunk",
          created: 1700000600,
          model: "claude-sonnet-4-5",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        },
      ];
      for (const c of chunks) writer.write(`data: ${JSON.stringify(c)}\n\n`);
      writer.write("data: [DONE]\n\n");
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 64,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        },
        { "x-api-key": "sk-x" },
      ),
      rec.writer,
    );

    expect(rec.status()).toBe(200);
    expect(rec.headers()?.["content-type"]).toContain("text/event-stream");
    expect(rec.ended()).toBe(true);

    // chatProxyCore should have been told stream:true.
    expect(JSON.parse(capturedEvent!.body!).stream).toBe(true);

    const events = parseSSE(rec.body());
    const names = events.map((e) => e.event);

    // Required order: message_start → content_block_start → 1+ deltas →
    // content_block_stop → message_delta → message_stop.
    expect(names[0]).toBe("message_start");
    expect(names[1]).toBe("content_block_start");
    expect(names[names.length - 2]).toBe("message_delta");
    expect(names[names.length - 1]).toBe("message_stop");
    expect(names).toContain("content_block_delta");
    expect(names).toContain("content_block_stop");

    // Assert exact full sequence to lock the contract.
    expect(names).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // The accumulated text should equal "Hello, world!".
    const textDeltas = events
      .filter(
        (e): e is { event: string; data: { delta: { type: string; text: string } } } =>
          e.event === "content_block_delta" &&
          (e.data as { delta?: { type?: string } }).delta?.type === "text_delta",
      )
      .map((e) => e.data.delta.text);
    expect(textDeltas.join("")).toBe("Hello, world!");

    // message_start.message.id should be a synthesized msg_xxx (NOT chatcmpl-xxx),
    // so Anthropic clients see the id format they expect.
    const msgStart = events[0].data as {
      message: { id: string; model: string };
    };
    expect(msgStart.message.id).toMatch(/^msg_/);
    expect(msgStart.message.model).toBe("claude-sonnet-4-5");

    // message_delta should carry stop_reason: end_turn (mapped from "stop").
    const msgDelta = events[events.length - 2].data as {
      delta: { stop_reason: string };
      usage: { output_tokens: number };
    };
    expect(msgDelta.delta.stop_reason).toBe("end_turn");
    expect(msgDelta.usage.output_tokens).toBe(3);
  });

  it("handles tool_use streaming (text → tool_use block transition)", async () => {
    mockStreamChatCore = (_event, writer) => {
      writer.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      // OpenAI emits: tool_call opens with id+name (no args), then arg fragments,
      // then a stop chunk with finish_reason: "tool_calls".
      const chunks = [
        {
          id: "chatcmpl-tool-1",
          object: "chat.completion.chunk",
          created: 1700000700,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_abc",
                    type: "function",
                    function: { name: "get_weather", arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-tool-1",
          object: "chat.completion.chunk",
          created: 1700000700,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '{"city":' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-tool-1",
          object: "chat.completion.chunk",
          created: 1700000700,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"Tokyo"}' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-tool-1",
          object: "chat.completion.chunk",
          created: 1700000700,
          model: "claude-sonnet-4-5",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        },
      ];
      for (const c of chunks) writer.write(`data: ${JSON.stringify(c)}\n\n`);
      writer.write("data: [DONE]\n\n");
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 64,
          stream: true,
          messages: [{ role: "user", content: "weather in tokyo?" }],
          tools: [
            {
              name: "get_weather",
              description: "Get the weather",
              input_schema: { type: "object", properties: { city: { type: "string" } } },
            },
          ],
        },
        { "x-api-key": "sk-x" },
      ),
      rec.writer,
    );

    const events = parseSSE(rec.body());
    const names = events.map((e) => e.event);

    // Expected: message_start → tool_use content_block_start → 2 input_json_deltas
    // → content_block_stop → message_delta → message_stop.
    expect(names[0]).toBe("message_start");
    expect(names[1]).toBe("content_block_start");

    // content_block_start should be a tool_use block (NOT text), because the
    // OpenAI stream never emitted text content.
    const blockStart = events[1].data as {
      content_block: { type: string; name?: string; id?: string };
    };
    expect(blockStart.content_block.type).toBe("tool_use");
    expect(blockStart.content_block.name).toBe("get_weather");
    expect(blockStart.content_block.id).toBe("call_abc");

    // input_json_deltas should accumulate to the full arguments JSON.
    const jsonDeltas = events
      .filter(
        (e): e is {
          event: string;
          data: { delta: { type: string; partial_json: string } };
        } =>
          e.event === "content_block_delta" &&
          (e.data as { delta?: { type?: string } }).delta?.type === "input_json_delta",
      )
      .map((e) => e.data.delta.partial_json);
    expect(jsonDeltas.join("")).toBe('{"city":"Tokyo"}');

    // Last 3 events: content_block_stop, message_delta, message_stop.
    expect(names.slice(-3)).toEqual([
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // stop_reason should be tool_use.
    const msgDelta = events[events.length - 2].data as {
      delta: { stop_reason: string };
    };
    expect(msgDelta.delta.stop_reason).toBe("tool_use");
  });

  it("translates upstream JSON error into Anthropic non-stream error even when client asked for stream", async () => {
    // If chatProxyCore writes a JSON error (status != 200, content-type json),
    // we forward it as a single Anthropic-format error JSON — the SSE stream
    // never opened, so no partial events.
    mockStreamChatCore = (_event, writer) => {
      writer.writeHead(429, { "content-type": "application/json" });
      writer.write(
        JSON.stringify({
          error: { type: "rate_limit_exceeded", message: "Too many requests" },
        }),
      );
      writer.end();
    };

    const rec = makeRecordingWriter();
    await runMessagesCore(
      makeEvent(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 64,
          stream: true,
          messages: [{ role: "user", content: "x" }],
        },
        { "x-api-key": "sk-x" },
      ),
      rec.writer,
    );

    expect(rec.status()).toBe(429);
    const body = JSON.parse(rec.body());
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");
  });
});
