/**
 * Anthropic Messages API + minimal OpenAI Chat Completions types.
 *
 * Hand-written rather than importing from `@anthropic-ai/sdk` / `openai`
 * because:
 *   1. The SDK packages aren't in `package.json` (we only proxy, never call
 *      the SDKs).
 *   2. We only need wire-format shapes for the conversion layer; importing
 *      full SDK type trees would balloon dependencies for no runtime gain.
 *
 * References:
 *   - Anthropic Messages API: https://docs.anthropic.com/en/api/messages
 *   - OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
 */

// ============================================================================
// Anthropic — request side
// ============================================================================

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  /** Anthropic spec allows string OR a sub-array of text blocks. */
  content: string | AnthropicTextBlock[];
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  /** Anthropic puts system as a top-level field, not in messages. */
  system?: string | AnthropicTextBlock[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
  metadata?: { user_id?: string };
}

// ============================================================================
// Anthropic — response side
// ============================================================================

export type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use";

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  /** Response content excludes tool_result (those are user-side input). */
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  model: string;
  stop_reason: AnthropicStopReason | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// ============================================================================
// Anthropic — SSE events
// ============================================================================

export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface AnthropicContentBlockStartTextEvent {
  type: "content_block_start";
  index: number;
  content_block: { type: "text"; text: "" };
}

export interface AnthropicContentBlockStartToolUseEvent {
  type: "content_block_start";
  index: number;
  content_block: {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, never>;
  };
}

export interface AnthropicContentBlockDeltaTextEvent {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string };
}

export interface AnthropicContentBlockDeltaInputJsonEvent {
  type: "content_block_delta";
  index: number;
  delta: { type: "input_json_delta"; partial_json: string };
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: AnthropicStopReason | null;
    stop_sequence: string | null;
  };
  usage: { output_tokens: number };
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export type AnthropicSSEEventData =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartTextEvent
  | AnthropicContentBlockStartToolUseEvent
  | AnthropicContentBlockDeltaTextEvent
  | AnthropicContentBlockDeltaInputJsonEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent;

/** SSE wire shape: `{ event: "<name>", data: <payload object> }`. */
export interface AnthropicSSEEvent {
  event:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop";
  data: AnthropicSSEEventData;
}

export interface AnthropicErrorBody {
  type: "error";
  error: {
    type:
      | "invalid_request_error"
      | "authentication_error"
      | "permission_error"
      | "not_found_error"
      | "rate_limit_error"
      | "api_error"
      | "overloaded_error";
    message: string;
  };
}

// ============================================================================
// OpenAI Chat Completions — minimal types we need for conversion I/O
// ============================================================================

/** Each entry of `messages` in an OpenAI chat completions request. */
export type OpenAIChatMessage =
  | {
      role: "system" | "user";
      content: string | Array<{ type: "text"; text: string }>;
      name?: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      name?: string;
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAIToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "function"; function: { name: string } };

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: OpenAIToolDefinition[];
  tool_choice?: OpenAIToolChoice;
  user?: string;
}

export interface OpenAIChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

/** Streaming delta — one entry of `choices[]` inside a chunk. */
export interface OpenAIStreamChoice {
  index: number;
  delta: {
    role?: "assistant";
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface OpenAIChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}
