/**
 * Conversion contract tests. Each describe block targets one of the four
 * exports and walks the corresponding fixture pairs. Fixtures live in
 * `fixtures/anthropic-openai/<name>.{anthropic,openai}.json` and are the
 * ground-truth pairs — if a mapping is wrong, the fixture is the spec
 * (update it deliberately, don't soften the assertion).
 */

import { describe, it, expect, vi } from "vitest";
import {
  requestToOpenAI,
  responseToAnthropic,
  errorToAnthropic,
  streamToAnthropic,
} from "../anthropicConvert.js";
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicSSEEvent,
  OpenAIChatChunk,
  OpenAIChatRequest,
  OpenAIChatResponse,
} from "../anthropicTypes.js";

// ---- Fixture imports (vitest + resolveJsonModule = direct JSON imports) ----

import simpleTextAnthropic from "./fixtures/anthropic-openai/simple-text.anthropic.json" with { type: "json" };
import simpleTextOpenAI from "./fixtures/anthropic-openai/simple-text.openai.json" with { type: "json" };

import withSystemAnthropic from "./fixtures/anthropic-openai/with-system.anthropic.json" with { type: "json" };
import withSystemOpenAI from "./fixtures/anthropic-openai/with-system.openai.json" with { type: "json" };

import multiTurnAnthropic from "./fixtures/anthropic-openai/multi-turn.anthropic.json" with { type: "json" };
import multiTurnOpenAI from "./fixtures/anthropic-openai/multi-turn.openai.json" with { type: "json" };

import withParamsAnthropic from "./fixtures/anthropic-openai/with-params.anthropic.json" with { type: "json" };
import withParamsOpenAI from "./fixtures/anthropic-openai/with-params.openai.json" with { type: "json" };

import toolUseAnthropic from "./fixtures/anthropic-openai/tool-use.anthropic.json" with { type: "json" };
import toolUseOpenAI from "./fixtures/anthropic-openai/tool-use.openai.json" with { type: "json" };

import toolResultAnthropic from "./fixtures/anthropic-openai/tool-result.anthropic.json" with { type: "json" };
import toolResultOpenAI from "./fixtures/anthropic-openai/tool-result.openai.json" with { type: "json" };

import streamingTextAnthropic from "./fixtures/anthropic-openai/streaming-text.anthropic.json" with { type: "json" };
import streamingTextOpenAI from "./fixtures/anthropic-openai/streaming-text.openai.json" with { type: "json" };

import streamingToolUseAnthropic from "./fixtures/anthropic-openai/streaming-tool-use.anthropic.json" with { type: "json" };
import streamingToolUseOpenAI from "./fixtures/anthropic-openai/streaming-tool-use.openai.json" with { type: "json" };

// Each JSON fixture's shape is a known union — cast at the import boundary
// rather than sprinkling `as` everywhere downstream.
interface PairFixture {
  request: unknown;
  response: unknown;
}
interface StreamPairFixture {
  meta: { messageId: string; model: string; inputTokens: number };
  events?: AnthropicSSEEvent[];
  chunks?: OpenAIChatChunk[];
}

const PAIRS: Array<{
  name: string;
  anthropic: PairFixture;
  openai: PairFixture;
}> = [
  { name: "simple-text", anthropic: simpleTextAnthropic as PairFixture, openai: simpleTextOpenAI as PairFixture },
  { name: "with-system", anthropic: withSystemAnthropic as PairFixture, openai: withSystemOpenAI as PairFixture },
  { name: "multi-turn", anthropic: multiTurnAnthropic as PairFixture, openai: multiTurnOpenAI as PairFixture },
  { name: "with-params", anthropic: withParamsAnthropic as PairFixture, openai: withParamsOpenAI as PairFixture },
  { name: "tool-use", anthropic: toolUseAnthropic as PairFixture, openai: toolUseOpenAI as PairFixture },
  { name: "tool-result", anthropic: toolResultAnthropic as PairFixture, openai: toolResultOpenAI as PairFixture },
];

// ============================================================================
// requestToOpenAI — fixtures 1..6
// ============================================================================

describe("requestToOpenAI", () => {
  for (const { name, anthropic, openai } of PAIRS) {
    it(`converts ${name} Anthropic request → OpenAI request`, () => {
      const got = requestToOpenAI(anthropic.request as AnthropicMessagesRequest);
      expect(got).toEqual(openai.request as OpenAIChatRequest);
    });
  }

  it("drops top_k with a warning (covered by with-params fixture, smoke-tested here)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = requestToOpenAI({
        model: "x",
        max_tokens: 10,
        top_k: 40,
        messages: [{ role: "user", content: "hi" }],
      });
      expect(out).not.toHaveProperty("top_k");
      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ============================================================================
// responseToAnthropic — fixtures 1..6
// ============================================================================

describe("responseToAnthropic", () => {
  for (const { name, anthropic, openai } of PAIRS) {
    it(`converts ${name} OpenAI response → Anthropic response`, () => {
      const anthropicReq = anthropic.request as AnthropicMessagesRequest;
      const got = responseToAnthropic(
        openai.response as OpenAIChatResponse,
        anthropicReq.model,
      );
      expect(got).toEqual(anthropic.response as AnthropicMessagesResponse);
    });
  }

  it("falls back to {} when tool_calls.arguments is malformed JSON", () => {
    const out = responseToAnthropic(
      {
        id: "chatcmpl-bad",
        object: "chat.completion",
        created: 0,
        model: "x",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "t1",
                  type: "function",
                  function: { name: "f", arguments: "{not-json" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "x",
    );
    expect(out.content).toEqual([
      { type: "tool_use", id: "t1", name: "f", input: {} },
    ]);
    expect(out.stop_reason).toBe("tool_use");
  });
});

// ============================================================================
// streamToAnthropic — fixtures 7..8
// ============================================================================

async function* iter<T>(arr: T[]): AsyncGenerator<T> {
  for (const v of arr) yield v;
}

async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of g) out.push(v);
  return out;
}

describe("streamToAnthropic", () => {
  const STREAM_CASES: Array<{
    name: string;
    openai: StreamPairFixture;
    anthropic: StreamPairFixture;
  }> = [
    {
      name: "streaming-text",
      openai: streamingTextOpenAI as StreamPairFixture,
      anthropic: streamingTextAnthropic as StreamPairFixture,
    },
    {
      name: "streaming-tool-use",
      openai: streamingToolUseOpenAI as StreamPairFixture,
      anthropic: streamingToolUseAnthropic as StreamPairFixture,
    },
  ];

  for (const { name, openai, anthropic } of STREAM_CASES) {
    it(`converts ${name} OpenAI chunks → Anthropic SSE events`, async () => {
      const chunks = openai.chunks ?? [];
      const expected = anthropic.events ?? [];
      const got = await collect(streamToAnthropic(iter(chunks), anthropic.meta));
      expect(got).toEqual(expected);
    });
  }

  it("streaming-text emits at minimum: message_start, content_block_delta, message_stop", async () => {
    const chunks = (streamingTextOpenAI as StreamPairFixture).chunks ?? [];
    const got = await collect(
      streamToAnthropic(
        iter(chunks),
        (streamingTextAnthropic as StreamPairFixture).meta,
      ),
    );
    const eventNames = got.map((e) => e.event);
    expect(eventNames[0]).toBe("message_start");
    expect(eventNames).toContain("content_block_delta");
    expect(eventNames[eventNames.length - 1]).toBe("message_stop");
    expect(got.length).toBeGreaterThanOrEqual(3);
  });

  it("streaming-tool-use accumulates input_json_delta fragments in order", async () => {
    const chunks = (streamingToolUseOpenAI as StreamPairFixture).chunks ?? [];
    const got = await collect(
      streamToAnthropic(
        iter(chunks),
        (streamingToolUseAnthropic as StreamPairFixture).meta,
      ),
    );
    const jsonDeltas = got
      .filter(
        (e): e is AnthropicSSEEvent & {
          data: { delta: { type: "input_json_delta"; partial_json: string } };
        } =>
          e.event === "content_block_delta" &&
          (e.data as { delta?: { type?: string } }).delta?.type ===
            "input_json_delta",
      )
      .map((e) => e.data.delta.partial_json);
    expect(jsonDeltas.join("")).toBe('{"city":"Tokyo"}');
  });

  it("empty stream emits nothing", async () => {
    const got = await collect(
      streamToAnthropic(iter<OpenAIChatChunk>([]), {
        messageId: "m_empty",
        model: "x",
        inputTokens: 0,
      }),
    );
    expect(got).toEqual([]);
  });
});

// ============================================================================
// errorToAnthropic
// ============================================================================

describe("errorToAnthropic", () => {
  it("maps invalid_request_error 1:1", () => {
    expect(
      errorToAnthropic({
        type: "invalid_request_error",
        message: "bad body",
        status: 400,
      }),
    ).toEqual({
      status: 400,
      body: {
        type: "error",
        error: { type: "invalid_request_error", message: "bad body" },
      },
    });
  });

  it("maps authentication aliases", () => {
    expect(errorToAnthropic({ type: "authentication", message: "x", status: 401 }).body.error.type).toBe(
      "authentication_error",
    );
    expect(
      errorToAnthropic({ type: "authentication_error", message: "x", status: 401 }).body.error.type,
    ).toBe("authentication_error");
  });

  it("maps permission, not_found, rate_limit aliases", () => {
    expect(errorToAnthropic({ type: "permission_denied", message: "x", status: 403 }).body.error.type).toBe(
      "permission_error",
    );
    expect(errorToAnthropic({ type: "not_found", message: "x", status: 404 }).body.error.type).toBe(
      "not_found_error",
    );
    expect(errorToAnthropic({ type: "rate_limit_exceeded", message: "x", status: 429 }).body.error.type).toBe(
      "rate_limit_error",
    );
  });

  it("maps overloaded / service_unavailable to overloaded_error", () => {
    expect(errorToAnthropic({ type: "overloaded", message: "x", status: 529 }).body.error.type).toBe(
      "overloaded_error",
    );
    expect(errorToAnthropic({ type: "service_unavailable", message: "x", status: 503 }).body.error.type).toBe(
      "overloaded_error",
    );
  });

  it("collapses server_error / unknown to api_error and preserves status", () => {
    expect(errorToAnthropic({ type: "server_error", message: "boom", status: 500 })).toEqual({
      status: 500,
      body: { type: "error", error: { type: "api_error", message: "boom" } },
    });
    expect(errorToAnthropic({ type: "totally_unknown_kind", message: "?", status: 500 }).body.error.type).toBe(
      "api_error",
    );
  });
});
