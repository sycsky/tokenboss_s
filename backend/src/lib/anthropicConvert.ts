/**
 * Anthropic ↔ OpenAI bidirectional conversion — the core of the
 * `POST /v1/messages` shim that lets Claude Code talk to TokenBoss.
 *
 * Four exports:
 *   - {@link requestToOpenAI}   Anthropic Messages request → OpenAI Chat request
 *   - {@link responseToAnthropic} OpenAI Chat response → Anthropic Messages response
 *   - {@link errorToAnthropic}  OpenAI error envelope → Anthropic error envelope
 *   - {@link streamToAnthropic} OpenAI streaming chunks (AsyncIterable) → Anthropic SSE events
 *
 * All functions are pure (no IO, no globals). The streaming converter is a
 * single AsyncGenerator that maintains a small state machine internally —
 * see comments inside {@link streamToAnthropic} for the state diagram.
 *
 * Reference: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §4
 */

import type {
  AnthropicErrorBody,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicSSEEvent,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  OpenAIChatChunk,
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIToolCall,
  OpenAIToolChoice,
  OpenAIToolDefinition,
} from "./anthropicTypes.js";

// ============================================================================
// Request: Anthropic → OpenAI
// ============================================================================

/**
 * Convert an Anthropic Messages API request body into an OpenAI Chat
 * Completions request body.
 *
 * Behavior summary (full mapping table in design.md §4):
 *   - `system` field (string or text-block array) is collapsed into a single
 *     `{role:"system", content:string}` injected at messages[0].
 *   - User/assistant content blocks: `text` → string; `tool_use` →
 *     `assistant.tool_calls`; `tool_result` → `{role:"tool", ...}`.
 *   - Tools: `input_schema` → `function.parameters`, wrapped under
 *     `{type:"function", function:{...}}`.
 *   - `tool_choice`: `auto` → `"auto"`, `any` → `"required"`, `tool` →
 *     `{type:"function", function:{name}}`.
 *   - `top_k` is dropped with a console warning (no OpenAI equivalent).
 *   - `stop_sequences` is renamed to `stop`.
 *   - `metadata.user_id` becomes top-level `user`.
 *   - `max_tokens` / `temperature` / `top_p` / `stream` pass through.
 */
export function requestToOpenAI(req: AnthropicMessagesRequest): OpenAIChatRequest {
  const out: OpenAIChatRequest = {
    model: req.model,
    max_tokens: req.max_tokens,
    messages: [],
  };

  // ---- system → messages[0] role:system ----
  if (req.system !== undefined) {
    const sysText = collapseSystem(req.system);
    if (sysText.length > 0) {
      out.messages.push({ role: "system", content: sysText });
    }
  }

  // ---- messages: per-message conversion (may emit >1 OpenAI message
  // because tool_result blocks become separate role:"tool" messages) ----
  for (const m of req.messages) {
    out.messages.push(...anthropicMessageToOpenAI(m));
  }

  // ---- sampling params ----
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.top_k !== undefined) {
    console.warn(
      "[anthropicConvert] top_k=%s has no OpenAI equivalent; dropping.",
      String(req.top_k),
    );
  }
  if (req.stop_sequences !== undefined && req.stop_sequences.length > 0) {
    out.stop = req.stop_sequences;
  }
  if (req.stream === true) out.stream = true;

  // ---- tools ----
  if (req.tools !== undefined && req.tools.length > 0) {
    out.tools = req.tools.map<OpenAIToolDefinition>((t) => ({
      type: "function",
      function: {
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        parameters: t.input_schema,
      },
    }));
  }

  if (req.tool_choice !== undefined) {
    out.tool_choice = mapToolChoice(req.tool_choice);
  }

  if (req.metadata?.user_id !== undefined) {
    out.user = req.metadata.user_id;
  }

  return out;
}

function collapseSystem(system: string | AnthropicTextBlock[]): string {
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("");
}

function mapToolChoice(
  tc: NonNullable<AnthropicMessagesRequest["tool_choice"]>,
): OpenAIToolChoice {
  switch (tc.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return { type: "function", function: { name: tc.name } };
  }
}

/**
 * Convert one Anthropic message into one or more OpenAI messages.
 *
 * The common case is 1:1, but a single Anthropic user message containing
 * a `tool_result` block must split into one `{role:"tool", tool_call_id}`
 * message per block (OpenAI has no notion of multiple tool results inside
 * a single user message).
 *
 * An assistant message containing both text and tool_use blocks becomes a
 * single `{role:"assistant", content, tool_calls}` (both fields populated).
 */
function anthropicMessageToOpenAI(m: AnthropicMessage): OpenAIChatMessage[] {
  // Plain string content → straight pass-through.
  if (typeof m.content === "string") {
    if (m.role === "user") return [{ role: "user", content: m.content }];
    return [{ role: "assistant", content: m.content }];
  }

  // Block-array content. Walk blocks and partition into:
  //   - text → joined into one string (per role)
  //   - tool_use → assistant.tool_calls
  //   - tool_result → separate role:tool messages
  const out: OpenAIChatMessage[] = [];
  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  const toolResults: Array<{ tool_call_id: string; content: string }> = [];

  for (const block of m.content) {
    switch (block.type) {
      case "text":
        textParts.push(block.text);
        break;
      case "tool_use":
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
        break;
      case "tool_result":
        toolResults.push({
          tool_call_id: block.tool_use_id,
          content: collapseToolResultContent(block.content),
        });
        break;
    }
  }

  // Emit the role-appropriate message, then any tool results (which are
  // always their own role:"tool" messages regardless of source role).
  if (m.role === "assistant") {
    // Assistant can carry text + tool_calls in one message.
    const hasText = textParts.length > 0;
    const hasTools = toolCalls.length > 0;
    if (hasText || hasTools) {
      const msg: OpenAIChatMessage = {
        role: "assistant",
        content: hasText ? textParts.join("") : null,
        ...(hasTools ? { tool_calls: toolCalls } : {}),
      };
      out.push(msg);
    }
  } else if (textParts.length > 0) {
    // User text-only (tool_results are appended after).
    out.push({ role: "user", content: textParts.join("") });
  }

  for (const tr of toolResults) {
    out.push({ role: "tool", tool_call_id: tr.tool_call_id, content: tr.content });
  }

  return out;
}

function collapseToolResultContent(
  content: string | AnthropicTextBlock[],
): string {
  if (typeof content === "string") return content;
  return content.map((b) => b.text).join("");
}

// ============================================================================
// Response: OpenAI → Anthropic (non-stream)
// ============================================================================

/**
 * Convert a non-streaming OpenAI Chat response into an Anthropic Messages
 * response. Only the first choice is consumed (Anthropic Messages API has
 * no `n>1` analogue).
 *
 * - `content` text → single `[{type:"text", text}]` block.
 * - `tool_calls` → one `tool_use` content block each, with `arguments`
 *   parsed as JSON for `input`. Malformed JSON falls back to `{}` rather
 *   than throwing (matches Anthropic's permissive behavior — clients
 *   typically just retry).
 * - `finish_reason` maps via {@link mapFinishReason}.
 * - The original Anthropic-side model name is passed through as
 *   `originalModel` because OpenAI upstreams sometimes echo a normalized
 *   variant in `response.model` that confuses clients (e.g. provider
 *   strips prefix); we surface what the client asked for.
 */
export function responseToAnthropic(
  res: OpenAIChatResponse,
  originalModel: string,
): AnthropicMessagesResponse {
  const choice = res.choices[0];
  if (!choice) {
    throw new Error(
      "anthropicConvert.responseToAnthropic: OpenAI response had no choices",
    );
  }

  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];

  if (
    typeof choice.message.content === "string" &&
    choice.message.content.length > 0
  ) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: safeParseJsonObject(tc.function.arguments),
      });
    }
  }

  const usage = res.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return {
    id: res.id,
    type: "message",
    role: "assistant",
    content,
    model: originalModel,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
    },
  };
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  if (!raw || raw.length === 0) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function mapFinishReason(
  reason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): AnthropicStopReason | null {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      // No exact Anthropic equivalent; closest is end_turn so clients don't
      // think they need to retry.
      return "end_turn";
    case null:
      return null;
  }
}

// ============================================================================
// Error: OpenAI / upstream error envelope → Anthropic
// ============================================================================

/**
 * Convert an upstream error envelope into an Anthropic-style error body
 * paired with the original HTTP status. Status code is passed through
 * unchanged so client retry/backoff logic still sees the correct semantics
 * (401 / 429 / 5xx).
 */
export function errorToAnthropic(err: {
  type: string;
  message: string;
  status: number;
}): { body: AnthropicErrorBody; status: number } {
  return {
    status: err.status,
    body: {
      type: "error",
      error: {
        type: mapErrorType(err.type),
        message: err.message,
      },
    },
  };
}

function mapErrorType(t: string): AnthropicErrorBody["error"]["type"] {
  const norm = t.toLowerCase();
  if (norm === "invalid_request_error" || norm === "invalid_request") {
    return "invalid_request_error";
  }
  if (norm === "authentication_error" || norm === "authentication") {
    return "authentication_error";
  }
  if (norm === "permission_denied" || norm === "permission" || norm === "permission_error") {
    return "permission_error";
  }
  if (norm === "not_found_error" || norm === "not_found") {
    return "not_found_error";
  }
  if (norm === "rate_limit_exceeded" || norm === "rate_limit" || norm === "rate_limit_error") {
    return "rate_limit_error";
  }
  if (norm === "overloaded" || norm === "overloaded_error" || norm === "service_unavailable") {
    return "overloaded_error";
  }
  // server_error / internal_error / unknown all collapse to api_error.
  return "api_error";
}

// ============================================================================
// Streaming: OpenAI chunks (AsyncIterable) → Anthropic SSE events
// ============================================================================

/**
 * State machine that converts an OpenAI streaming-chunks AsyncIterable into
 * the Anthropic SSE event sequence required by Claude Code et al.
 *
 * Block-index discipline (matches Anthropic wire format):
 *   - Text always occupies block index 0 if any content is emitted.
 *   - Each tool_call occupies its own block index, starting at 1 if text
 *     was present, otherwise the OpenAI tool_call index + (text? 1 : 0).
 *   - A block must be opened with `content_block_start` and closed with
 *     `content_block_stop` exactly once; transitioning from text → tool_use
 *     means closing text first.
 *
 * The implementation buffers the minimum state needed:
 *   - whether `message_start` has been emitted
 *   - whether the text block is currently open
 *   - per-tool-call: started flag + Anthropic block index + accumulated
 *     output_tokens contribution (we just count chunks, since OpenAI delta
 *     chunks generally don't carry per-chunk usage)
 *
 * Output-token count: We prefer the upstream `usage.completion_tokens` if
 * the final chunk carries `usage`; otherwise we report 0 (Anthropic clients
 * still parse the stream successfully — usage is informational).
 *
 * `meta.messageId` and `meta.model` are surfaced on `message_start` so the
 * caller controls the user-visible message identity (typically synthesized
 * `msg_<random>` upstream of this fn).
 */
export async function* streamToAnthropic(
  openAIChunks: AsyncIterable<OpenAIChatChunk>,
  meta: { messageId: string; model: string; inputTokens: number },
): AsyncGenerator<AnthropicSSEEvent> {
  // --- State ---
  let started = false;
  let textOpen = false;
  let textBlockIndex = -1; // assigned when text first opens
  let nextBlockIndex = 0;
  let finishReason:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | null = null;
  let outputTokens = 0;

  /** Map OpenAI tool_call.index → { anthropic block index, opened } */
  const toolBlocks = new Map<
    number,
    { blockIndex: number; opened: boolean; closed: boolean }
  >();

  const emitMessageStart = (): AnthropicSSEEvent => ({
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: meta.messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: meta.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: meta.inputTokens, output_tokens: 0 },
      },
    },
  });

  for await (const chunk of openAIChunks) {
    // Capture trailing usage if upstream included it on the final chunk.
    if (chunk.usage) outputTokens = chunk.usage.completion_tokens;

    if (!started) {
      started = true;
      yield emitMessageStart();
    }

    const choice = chunk.choices[0];
    if (!choice) {
      // Some upstreams send a trailing usage-only chunk with empty choices.
      // Nothing to emit per-delta; loop continues.
      continue;
    }

    const delta = choice.delta;

    // ---- text delta ----
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!textOpen) {
        textOpen = true;
        textBlockIndex = nextBlockIndex++;
        yield {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: textBlockIndex,
            content_block: { type: "text", text: "" },
          },
        };
      }
      yield {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: textBlockIndex,
          delta: { type: "text_delta", text: delta.content },
        },
      };
    }

    // ---- tool_call deltas ----
    if (Array.isArray(delta.tool_calls)) {
      // If text is open, close it before opening tool_use blocks.
      if (textOpen) {
        yield {
          event: "content_block_stop",
          data: { type: "content_block_stop", index: textBlockIndex },
        };
        textOpen = false;
      }

      for (const tc of delta.tool_calls) {
        const openaiIdx = tc.index;
        let entry = toolBlocks.get(openaiIdx);
        if (!entry) {
          entry = {
            blockIndex: nextBlockIndex++,
            opened: false,
            closed: false,
          };
          toolBlocks.set(openaiIdx, entry);
        }

        // Open on first sight of id + name (typically the first chunk
        // carrying this tool_call has both; we wait until we have a name
        // so the content_block_start has the real function name).
        if (!entry.opened) {
          if (tc.id !== undefined && tc.function?.name !== undefined) {
            entry.opened = true;
            yield {
              event: "content_block_start",
              data: {
                type: "content_block_start",
                index: entry.blockIndex,
                content_block: {
                  type: "tool_use",
                  id: tc.id,
                  name: tc.function.name,
                  input: {},
                },
              },
            };
          }
        }

        // Stream `arguments` fragments as input_json_delta. Empty-string
        // fragments (which OpenAI emits with the opening chunk) are skipped.
        const argFragment = tc.function?.arguments;
        if (
          entry.opened &&
          typeof argFragment === "string" &&
          argFragment.length > 0
        ) {
          yield {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: entry.blockIndex,
              delta: {
                type: "input_json_delta",
                partial_json: argFragment,
              },
            },
          };
        }
      }
    }

    // ---- finish ----
    if (choice.finish_reason !== null) {
      finishReason = choice.finish_reason;
    }
  }

  // ---- Close any still-open blocks ----
  if (textOpen) {
    yield {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: textBlockIndex },
    };
    textOpen = false;
  }

  for (const entry of toolBlocks.values()) {
    if (entry.opened && !entry.closed) {
      entry.closed = true;
      yield {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: entry.blockIndex },
      };
    }
  }

  // ---- message_delta + message_stop ----
  // If we never started (empty stream), don't emit terminal events — the
  // caller can decide whether to surface an error envelope instead.
  if (!started) return;

  const stopReason = mapFinishReason(finishReason);
  yield {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
  };
  yield {
    event: "message_stop",
    data: { type: "message_stop" },
  };
}
