# Tasks · gh-3-tokenboss-cc-switch-integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐 task 实施。Step 使用 checkbox 语法跟踪。
>
> **Goal:** v1.0 把 TokenBoss 集成进 CC Switch deep link 生态 + 新增 Anthropic-compat shim 让 Claude Code native 能用。
>
> **Architecture:** Single PR 合 main，frontend 重写 `/install/manual` + 加 3 个 `/docs/protocols/*` 子路由，backend 加 `POST /v1/deep-link` 和 `POST /v1/messages` 两个 endpoint + 协议转换 lib。详见 [[design.md]]。
>
> **Tech Stack:** React 18 + Vite + Tailwind 3.4 (frontend) / Node 20+ + TypeScript + Lambda-shape (backend) / vitest + playwright (test) / Zeabur (deploy)
>
> **Worktree 策略：** Backend (Task 1-4) 和 frontend (Task 5-8) 可并行 worktree 跑，但 Task 11 Vertical Slice 必须串行（端到端验证）。Task 9 docs 跟 Task 8 同 worktree。

---

## Task 1: anthropicConvert lib + 8 组 fixture（含 streaming）

**估算：** 4-5 天（本 REQ 最大工作量，streaming 转换是难点）

**Files:**
- Create: `backend/src/lib/anthropicConvert.ts`
- Create: `backend/src/lib/anthropicTypes.ts`（Anthropic API 的 TypeScript types）
- Create: `backend/src/lib/__tests__/anthropicConvert.test.ts`
- Create: `backend/src/lib/__tests__/fixtures/anthropic-openai/*.json`（8 组对照 fixture）

**Sub-steps:**

- [ ] **Step 1.1: 定义 Anthropic API types**

Create `backend/src/lib/anthropicTypes.ts`，import 自 `@anthropic-ai/sdk` 或手写 types：

```typescript
export interface AnthropicMessage { role: "user" | "assistant"; content: string | AnthropicContentBlock[]; }
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[] };
export interface AnthropicMessagesRequest { /* ...见 design.md §3.2 */ }
export interface AnthropicMessagesResponse { /* ... */ }
export type AnthropicSSEEvent =
  | { event: "message_start"; data: { type: "message_start"; message: ... } }
  | { event: "content_block_start"; data: ... }
  | { event: "content_block_delta"; data: ... }
  | { event: "content_block_stop"; data: ... }
  | { event: "message_delta"; data: ... }
  | { event: "message_stop"; data: { type: "message_stop" } };
```

- [ ] **Step 1.2: 录 8 组 fixture（先写 fixture 再写 conversion）**

Create `backend/src/lib/__tests__/fixtures/anthropic-openai/`（每组一对 `<name>.anthropic.json` + `<name>.openai.json`）。最简单方法：用真实 SDK 抓样：

```bash
# 用临时 script 跑一次（不入 git，仅作为 fixture 录制工具）
cat > /tmp/record-fixtures.ts <<'EOF'
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
// ... 跑 8 个 case，把 request body + response body 各自 JSON.stringify 存到 fixture 文件
EOF
```

8 组 fixture：

| # | Fixture name | 内容 |
|---|---|---|
| 1 | `simple-text` | 单轮 user → text response，non-stream |
| 2 | `with-system` | system prompt + multi-turn |
| 3 | `multi-turn` | 5 轮对话历史 |
| 4 | `with-params` | 含 temperature/top_p/max_tokens/stop_sequences |
| 5 | `tool-use` | 含 `tools` + response 含 `tool_use` block |
| 6 | `tool-result` | request 含 tool_result content block |
| 7 | `streaming-text` | stream=true 的 chunks 列表（数组形式存 fixture）|
| 8 | `streaming-tool-use` | stream=true 含 tool_use 的复杂 SSE 流 |

- [ ] **Step 1.3: 写 `requestToOpenAI` 测试**

`backend/src/lib/__tests__/anthropicConvert.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { requestToOpenAI } from "../anthropicConvert.js";
import simpleTextAnthropic from "./fixtures/anthropic-openai/simple-text.anthropic.json";
import simpleTextOpenAI from "./fixtures/anthropic-openai/simple-text.openai.json";

describe("requestToOpenAI", () => {
  it("converts simple-text Anthropic request to OpenAI format", () => {
    expect(requestToOpenAI(simpleTextAnthropic.request)).toEqual(simpleTextOpenAI.request);
  });
  // 重复 7 次给其他 fixture...
});
```

- [ ] **Step 1.4: Run failing tests**

```bash
cd backend && npm test -- anthropicConvert
```

Expected: FAIL（`requestToOpenAI is not a function`）

- [ ] **Step 1.5: Implement `requestToOpenAI`（参照 design.md §4 mapping table）**

Create `backend/src/lib/anthropicConvert.ts`：

```typescript
import type { AnthropicMessagesRequest, AnthropicMessagesResponse, AnthropicSSEEvent } from "./anthropicTypes.js";
import type { OpenAIChatRequest, OpenAIChatResponse, OpenAIChatChunk } from "./openaiTypes.js";

export function requestToOpenAI(req: AnthropicMessagesRequest): OpenAIChatRequest {
  // 1. 处理 system prompt → 注入 messages[0] = role:system
  // 2. content array → 按 mapping table 转
  // 3. tools schema 包成 {type:"function",function:...}
  // 4. tool_choice 转
  // 5. tool_use / tool_result content blocks 转 assistant.tool_calls / role:tool
  // 6. 其他参数直传 / 不映射的 (top_k) log warning
}
```

Run tests until all 6 non-stream fixture tests pass。

- [ ] **Step 1.6: Implement `responseToAnthropic`，跑 fixture 1-6 response 测试**

```typescript
export function responseToAnthropic(res: OpenAIChatResponse, originalModel: string): AnthropicMessagesResponse {
  // choices[0].message.content → [{type:"text",text}]
  // tool_calls → [{type:"tool_use",id,name,input:JSON.parse(arguments)}]
  // finish_reason → stop_reason (mapping)
  // usage 字段名转
}
```

- [ ] **Step 1.7: Implement `streamToAnthropic`（最复杂的 step）**

```typescript
export async function* streamToAnthropic(
  openAIChunks: AsyncIterable<OpenAIChatChunk>,
  meta: { messageId: string; model: string; inputTokens: number },
): AsyncGenerator<AnthropicSSEEvent> {
  // 状态机：
  // - 第一个 chunk：emit message_start + content_block_start(text)
  // - delta.content 非空：emit content_block_delta(text_delta)
  // - 发现 tool_calls：先 emit content_block_stop 关 text，再 content_block_start(tool_use)
  //   累积 arguments string；finish 时 emit content_block_stop
  // - finish_reason：emit message_delta + message_stop
}
```

跑 fixture 7-8 streaming tests。Test 比对生成的 SSE event 序列跟 expected fixture 是否完全相同。

- [ ] **Step 1.8: Implement `errorToAnthropic`**

```typescript
export function errorToAnthropic(err: { type: string; message: string; status: number }): {
  body: { type: "error"; error: { type: string; message: string } };
  status: number;
} {
  // Map OpenAI error.type → Anthropic error.type
  // (e.g. "invalid_request_error" → "invalid_request_error",
  //       "authentication" → "authentication_error", etc.)
}
```

- [ ] **Step 1.9: Run all tests + lint + typecheck**

```bash
cd backend && npm test -- anthropicConvert && npm run typecheck
```

Expected: 所有 fixture tests PASS, typecheck CLEAN.

- [ ] **Step 1.10: Commit**

```bash
git add backend/src/lib/anthropicConvert.ts backend/src/lib/anthropicTypes.ts backend/src/lib/__tests__/anthropicConvert.test.ts backend/src/lib/__tests__/fixtures/anthropic-openai/
git commit -m "feat(backend): anthropicConvert lib + 8 fixture (incl. streaming SSE)

实现 Anthropic ↔ OpenAI 双向格式转换，是 /v1/messages shim 的核心。
含 8 组对照 fixture（含 streaming）+ 4 个 export 函数。

参考: gh-3 design.md §4 mapping table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ccSwitchUrl lib + 5 app × fixture

**估算：** 1 天

**Files:**
- Create: `backend/src/lib/ccSwitchUrl.ts`
- Create: `backend/src/lib/__tests__/ccSwitchUrl.test.ts`

**Sub-steps:**

- [ ] **Step 2.1: 写 5 个 app × URL 期望值的 test 表（参照 design.md §5 模板）**

```typescript
import { describe, it, expect } from "vitest";
import { buildCCSwitchUrl, CC_SWITCH_APPS, type CCSwitchUrlParams } from "../ccSwitchUrl.js";

const baseParams: Omit<CCSwitchUrlParams, "app"> = {
  name: "TokenBoss",
  endpoint: "https://api.tokenboss.co/v1",
  homepage: "https://www.tokenboss.co",
  apiKey: "sk-testtoken123456789012345678901234567890ABCDEF12",
};

describe("buildCCSwitchUrl", () => {
  it.each([
    ["openclaw", "simple" as const],
    ["hermes", "simple" as const],
    ["opencode", "simple" as const],
  ])("generates simple-schema URL for %s", (app, schema) => {
    const url = buildCCSwitchUrl({ ...baseParams, app: app as any });
    expect(url).toMatch(/^ccswitch:\/\/v1\/import\?resource=provider&app=/);
    expect(url).toContain(`app=${app}`);
    expect(url).toContain(`name=TokenBoss`);
    expect(url).toContain(`endpoint=${encodeURIComponent(baseParams.endpoint)}`);
    expect(url).toContain(`apiKey=${encodeURIComponent(baseParams.apiKey)}`);
  });

  it("generates Codex full-schema URL with base64 JSON config", () => {
    const url = buildCCSwitchUrl({ ...baseParams, app: "codex" });
    expect(url).toContain("app=codex");
    expect(url).toContain("configFormat=json");
    const configParam = new URL(url.replace("ccswitch://", "https://x/")).searchParams.get("config")!;
    const decoded = JSON.parse(Buffer.from(configParam, "base64").toString());
    expect(decoded.auth.OPENAI_API_KEY).toBe(baseParams.apiKey);
    expect(decoded.config).toContain('base_url = "https://api.tokenboss.co/v1"');
  });

  it("generates Claude full-schema URL with ANTHROPIC_BASE_URL stripped of /v1", () => {
    const url = buildCCSwitchUrl({ ...baseParams, app: "claude" });
    const configParam = new URL(url.replace("ccswitch://", "https://x/")).searchParams.get("config")!;
    const decoded = JSON.parse(Buffer.from(configParam, "base64").toString());
    expect(decoded.env.ANTHROPIC_AUTH_TOKEN).toBe(baseParams.apiKey);
    expect(decoded.env.ANTHROPIC_BASE_URL).toBe("https://api.tokenboss.co");  // 不带 /v1 — design.md D8
    expect(decoded.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-5");
  });

  it("URL-encodes the API key", () => {
    const url = buildCCSwitchUrl({ ...baseParams, app: "openclaw", apiKey: "sk-with/special&chars" });
    expect(url).toContain(`apiKey=${encodeURIComponent("sk-with/special&chars")}`);
  });

  it("throws on unsupported app", () => {
    expect(() => buildCCSwitchUrl({ ...baseParams, app: "gemini" as any })).toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 2.2: Run failing tests** — Expected: FAIL（function not defined）

- [ ] **Step 2.3: Implement `buildCCSwitchUrl`（参照 design.md §5 模板）**

```typescript
// backend/src/lib/ccSwitchUrl.ts
export type CCSwitchApp = "openclaw" | "hermes" | "codex" | "opencode" | "claude";

export const CC_SWITCH_APPS = [
  { app: "openclaw", displayName: "OpenClaw", schema: "simple" },
  { app: "hermes", displayName: "Hermes Agent", schema: "simple" },
  { app: "codex", displayName: "Codex CLI", schema: "full" },
  { app: "opencode", displayName: "OpenCode", schema: "simple" },
  { app: "claude", displayName: "Claude Code", schema: "full" },
] as const;

export interface CCSwitchUrlParams { app: CCSwitchApp; name: string; endpoint: string; homepage: string; apiKey: string; }

export function buildCCSwitchUrl(p: CCSwitchUrlParams): string {
  const baseUrlNoV1 = p.endpoint.replace(/\/v1\/?$/, "");
  switch (p.app) {
    case "openclaw":
    case "hermes":
    case "opencode": {
      const q = new URLSearchParams({
        resource: "provider", app: p.app, name: p.name,
        endpoint: p.endpoint, homepage: p.homepage, apiKey: p.apiKey,
      });
      return `ccswitch://v1/import?${q.toString()}`;
    }
    case "codex": {
      const config = {
        auth: { OPENAI_API_KEY: p.apiKey },
        config: `[model_providers.tokenboss]\nbase_url = "${p.endpoint}"\n\n[general]\nmodel = "claude-sonnet-4-5"`,
      };
      const b64 = Buffer.from(JSON.stringify(config)).toString("base64");
      const q = new URLSearchParams({ resource: "provider", app: "codex", name: p.name, configFormat: "json", config: b64 });
      return `ccswitch://v1/import?${q.toString()}`;
    }
    case "claude": {
      const config = {
        env: {
          ANTHROPIC_AUTH_TOKEN: p.apiKey,
          ANTHROPIC_BASE_URL: baseUrlNoV1,  // D8: 不带 /v1
          ANTHROPIC_MODEL: "claude-sonnet-4-5",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-5",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4",
        },
      };
      const b64 = Buffer.from(JSON.stringify(config)).toString("base64");
      const q = new URLSearchParams({ resource: "provider", app: "claude", name: p.name, configFormat: "json", config: b64 });
      return `ccswitch://v1/import?${q.toString()}`;
    }
    default: throw new Error(`buildCCSwitchUrl: unsupported app "${p.app}"`);
  }
}
```

- [ ] **Step 2.4: Run tests** — Expected: ALL PASS

- [ ] **Step 2.5: Commit**

```bash
git add backend/src/lib/ccSwitchUrl.ts backend/src/lib/__tests__/ccSwitchUrl.test.ts
git commit -m "feat(backend): ccSwitchUrl lib generating 5-app deep link URLs

支持 simple schema (openclaw/hermes/opencode) 和 full schema (codex/claude)。
Claude app 的 ANTHROPIC_BASE_URL 故意不带 /v1 (Claude Code 客户端自动拼)。

参考: gh-3 design.md §5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: deepLinkHandler + reserved "CC Switch" key 管理

**估算：** 1.5 天

**Files:**
- Create: `backend/src/handlers/deepLinkHandler.ts`
- Modify: `backend/src/handlers/keysHandlers.ts:80`（把 `requireNewapiLink` 从 file-private function 改成 `export`，让 deepLinkHandler 复用）
- Modify: `backend/src/local.ts:159`（routes array 加新 entry）
- Create: `backend/src/handlers/__tests__/deepLinkHandler.test.ts`

**Sub-steps:**

- [ ] **Step 3.1: Plan path 已 verify — 用 `newapi.createAndRevealToken`**

newapi 函数实际叫 `createAndRevealToken` (`backend/src/lib/newapi.ts:744`)，签名：

```typescript
async createAndRevealToken(input: {
  session: { cookie: string; userId: number };
  name: string;
  unlimited_quota?: boolean;
  remain_quota?: number;
  expired_time?: number;   // -1 = never
  models?: string[];
  group?: string;
}): Promise<{ tokenId: number; apiKey: string }>
```

也需要把 `requireNewapiLink` from `keysHandlers.ts:80` 改成 `export`（不要在 deepLinkHandler 里 copy 实现 — DRY 原则）。

- [ ] **Step 3.2: 写 deepLinkHandler 测试**

```typescript
// backend/src/handlers/__tests__/deepLinkHandler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deepLinkHandler } from "../deepLinkHandler.js";
// Mock newapi + auth helpers...

describe("deepLinkHandler POST /v1/deep-link", () => {
  it("returns 401 without session", async () => {
    const event = { headers: {}, body: null } as any;
    const result = await deepLinkHandler(event);
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.type).toBe("authentication_error");
  });

  it("deletes existing 'CC Switch' token before creating new one (D7 删旧建新)", async () => {
    // Setup: mock newapi.listUserTokens to return [{ id: 42, name: "CC Switch" }]
    // Mock newapi.deleteUserToken + newapi.createUserToken
    // Expected: deleteUserToken called with id=42 BEFORE createUserToken
  });

  it("creates new token if no existing 'CC Switch' token", async () => {
    // Setup: listUserTokens returns []
    // Expected: deleteUserToken NOT called, createUserToken called
  });

  it("returns 5 deep_links with the new plaintext key", async () => {
    // Setup: createUserToken returns { id: 99, key: "sk-newkey..." }
    // Expected: response.deep_links has 5 entries (openclaw, hermes, codex, opencode, claude)
    //           each url contains "sk-newkey..." (encoded)
  });

  it("propagates newapi 429 as 503 newapi_rate_limited", async () => {
    // Setup: newapi calls throw NewapiError with status=429
    // Expected: response.statusCode === 503, code === "newapi_rate_limited"
  });
});
```

- [ ] **Step 3.3: Run failing tests** — Expected: FAIL

- [ ] **Step 3.4: Implement deepLinkHandler（参照 design.md §6.2 流程序列 + keysHandlers.ts pattern）**

```typescript
// backend/src/handlers/deepLinkHandler.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { isAuthFailure, verifySessionHeader } from "../lib/auth.js";
import { isNewapiConfigured, newapi, NewapiError } from "../lib/newapi.js";
import { newapiUsername } from "../lib/newapiIdentity.js";
import { buildCCSwitchUrl, CC_SWITCH_APPS } from "../lib/ccSwitchUrl.js";

const TOKENBOSS_API_BASE = "https://api.tokenboss.co/v1";
const TOKENBOSS_HOMEPAGE = "https://www.tokenboss.co";
const RESERVED_KEY_NAME = "CC Switch";

export const deepLinkHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const auth = await verifySessionHeader(event.headers?.authorization ?? event.headers?.Authorization);
  if (isAuthFailure(auth)) return jsonError(auth.status, "authentication_error", auth.message, auth.code);

  // requireNewapiLink (copy pattern from keysHandlers.ts)
  if (!isNewapiConfigured()) return jsonError(503, "service_unavailable", "...", "newapi_not_configured");
  if (auth.user.newapiUserId === undefined || !auth.user.newapiPassword)
    return jsonError(409, "conflict", "...", "newapi_not_linked");

  try {
    const session = await newapi.loginUser({ username: newapiUsername(auth.userId), password: auth.user.newapiPassword });
    const tokens = await newapi.listUserTokens(session);
    const existing = tokens.find(t => t.name === RESERVED_KEY_NAME);
    if (existing) await newapi.deleteUserToken(session, existing.id);
    const created = await newapi.createAndRevealToken({
      session,
      name: RESERVED_KEY_NAME,
      unlimited_quota: true,
      expired_time: -1,
    });

    const deep_links = CC_SWITCH_APPS.map(({ app, displayName }) => ({
      app, display_name: displayName,
      url: buildCCSwitchUrl({ app, name: "TokenBoss", endpoint: TOKENBOSS_API_BASE, homepage: TOKENBOSS_HOMEPAGE, apiKey: created.apiKey }),
    }));

    return jsonResponse(200, { user_id: auth.userId, key_name: RESERVED_KEY_NAME, key_id: created.tokenId, deep_links, issued_at: new Date().toISOString() });
  } catch (err) {
    return handleNewapiError(err);  // 沿用 keysHandlers.ts 的 handleNewapiError pattern
  }
};
```

- [ ] **Step 3.5: 注册路由到 local.ts**

```typescript
// backend/src/local.ts:159 附近，紧贴 /v1/keys 后加：
import { deepLinkHandler } from "./handlers/deepLinkHandler.js";
// ...
const routes: Route[] = [
  // ...
  { method: "DELETE", path: "/v1/keys/{keyId}", handler: deleteKeyHandler },
  { method: "POST", path: "/v1/deep-link", handler: deepLinkHandler },  // <- NEW
  // ...
];
```

- [ ] **Step 3.6: Run tests + typecheck** — Expected: PASS

- [ ] **Step 3.7: Commit**

```bash
git add backend/src/handlers/deepLinkHandler.ts backend/src/handlers/__tests__/deepLinkHandler.test.ts backend/src/local.ts
# 如果 newapi.ts 改了
git add backend/src/lib/newapi.ts
git commit -m "feat(backend): POST /v1/deep-link endpoint + reserved 'CC Switch' key 删旧建新

实现 D7 决策：每用户 newapi 端最多 1 个 name='CC Switch' token，每次调用
删旧 (如存在) + 建新 + 返回 plaintext 填进 5 个 ccswitch:// URL。

参考: gh-3 design.md §3.1 + §6

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: messagesProxy endpoint（Anthropic-compat shim）+ streaming round-trip 集成测试

**估算：** 2-3 天

**Files:**
- Create: `backend/src/lib/messagesProxyCore.ts`（核心逻辑，可在 local + Lambda 跑）
- Create: `backend/src/handlers/messagesProxy.ts`（Lambda streamifyResponse wrapper，mirror chatProxy.ts）
- Modify: `backend/src/local.ts:159`（routes array + STREAM_ROUTES 加 /v1/messages）
- Create: `backend/src/lib/__tests__/messagesProxyCore.test.ts`（集成测试）

**Sub-steps:**

- [ ] **Step 4.1: 写 messagesProxyCore 集成测试 — non-streaming**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runMessagesCore } from "../messagesProxyCore.js";

describe("messagesProxyCore (non-stream)", () => {
  it("translates Anthropic request → calls chatProxy → translates response back to Anthropic", async () => {
    // Mock chatProxyCore.streamChatCore to return a fixed OpenAI completion
    // Send a simple Anthropic request, assert response shape matches Anthropic format
  });

  it("normalizes x-api-key header to Authorization: Bearer", async () => {
    // Request has x-api-key: sk-..., assert chatProxyCore received Authorization: Bearer sk-...
  });

  it("returns Anthropic-format error on chatProxy 401", async () => {
    // Mock chatProxy to throw 401, assert response { type: "error", error: { type: "authentication_error", ... } }
  });
});
```

- [ ] **Step 4.2: 写 messagesProxyCore 集成测试 — streaming**

```typescript
describe("messagesProxyCore (streaming)", () => {
  it("converts OpenAI SSE chunks to Anthropic SSE events", async () => {
    // Mock chatProxy to emit a sequence of OpenAI chunks
    // Capture written SSE events via mock StreamWriter
    // Assert sequence: message_start, content_block_start, content_block_delta..., content_block_stop, message_delta, message_stop
  });

  it("handles tool_use streaming (content_block 切换)", async () => {
    // Mock chatProxy stream with tool_calls
    // Assert text content_block closes, tool_use content_block opens, arguments accumulated, closes
  });
});
```

- [ ] **Step 4.3: Run failing tests** — Expected: FAIL

- [ ] **Step 4.4: Implement messagesProxyCore（mirror chatProxyCore 的 StreamWriter 模式）**

```typescript
// backend/src/lib/messagesProxyCore.ts
import type { StreamWriter } from "./chatProxyCore.js";
import { streamChatCore } from "./chatProxyCore.js";
import { requestToOpenAI, responseToAnthropic, streamToAnthropic, errorToAnthropic } from "./anthropicConvert.js";

export interface MessagesCoreInput {
  authHeader: string | undefined;       // x-api-key OR Authorization
  body: string;                          // raw JSON Anthropic request
  isStream: boolean;
  writer?: StreamWriter;                 // streaming 时必传
}

export async function runMessagesCore(input: MessagesCoreInput): Promise<APIGatewayProxyResultV2 | void> {
  // 1. Parse Anthropic body
  // 2. requestToOpenAI(body)
  // 3. Normalize auth header (x-api-key → Authorization: Bearer)
  // 4. if isStream:
  //    - call streamChatCore({ writer: openAIStreamCapture, ...openAIRequest })
  //    - openAIStreamCapture transforms chunks via streamToAnthropic, writes to user `writer`
  // 5. if not isStream:
  //    - call streamChatCore({ writer: bufferingWriter, ...openAIRequest })
  //    - collect full response, responseToAnthropic, return as JSON
  // 6. on error → errorToAnthropic
}
```

- [ ] **Step 4.5: Implement messagesProxy.ts Lambda wrapper（mirror chatProxy.ts）**

```typescript
// backend/src/handlers/messagesProxy.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Writable } from "node:stream";
import { runMessagesCore } from "../lib/messagesProxyCore.js";

declare const awslambda: { streamifyResponse: ...; HttpResponseStream: ... };

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  // 完全 mirror chatProxy.ts，调用 runMessagesCore 而不是 streamChatCore
});
```

- [ ] **Step 4.6: 注册路由 + STREAM_ROUTES**

```typescript
// backend/src/local.ts
// routes array 加（非 stream 用，理论上不会命中）：
{ method: "POST", path: "/v1/messages", handler: ... },  

// STREAM_ROUTES 加（stream=true 时走这条）：
const STREAM_ROUTES = [
  // ... 现有
  { method: "POST", path: "/v1/messages" },  // <- NEW
];

// handleChatStream 函数里加 dispatch 逻辑判断 /v1/messages 路由
```

- [ ] **Step 4.7: Run tests + typecheck + 跑本地 dev server 用 curl 手动试一次**

```bash
cd backend && npm test -- messagesProxy
npm run typecheck

# 手动验证 non-stream:
npm run dev:mock &  # 用 mock upstream
sleep 2
curl -X POST http://localhost:3000/v1/messages \
  -H "x-api-key: sk-test" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"ping"}],"max_tokens":10}'
# 期望返回 Anthropic-format JSON
```

- [ ] **Step 4.8: Commit**

```bash
git add backend/src/lib/messagesProxyCore.ts backend/src/handlers/messagesProxy.ts backend/src/lib/__tests__/messagesProxyCore.test.ts backend/src/local.ts
git commit -m "feat(backend): POST /v1/messages Anthropic-compat shim with streaming SSE

mirror chatProxy.ts 的 Lambda streamifyResponse 模式。messagesProxyCore.ts
处理 Anthropic ↔ OpenAI 双向转换 + dispatch 给 chatProxyCore (内部不走 HTTP)。
Streaming 走 SSE 事件序列转换 (message_start → content_block_* → message_stop)。

参考: gh-3 design.md §3.2 + §4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend lib · agentDefs + api.getDeepLink()

**估算：** 0.5 天

**Files:**
- Create: `frontend/src/lib/agentDefs.ts`
- Modify: `frontend/src/lib/api.ts:??`（在合适位置加 `getDeepLink` 函数）
- Create: `frontend/src/lib/__tests__/api.deepLink.test.ts`

**Sub-steps:**

- [ ] **Step 5.1: Create agentDefs.ts**

```typescript
// frontend/src/lib/agentDefs.ts
export type CLIAppId = "openclaw" | "hermes" | "codex" | "opencode" | "claude";

export interface CLIAppDef {
  id: CLIAppId;
  displayName: string;
  homepage: string;
  iconAsset: string;  // path to logo SVG/PNG
  protocolFamily: "openai-compat" | "anthropic-shim" | "gemini-proxy";
  description: string;  // 1-line 介绍
}

export const CLI_APPS: CLIAppDef[] = [
  { id: "openclaw", displayName: "OpenClaw", homepage: "https://openclaw.ai", iconAsset: "/agents/openclaw.svg", protocolFamily: "openai-compat", description: "本地 Agent + Gateway" },
  { id: "hermes", displayName: "Hermes Agent", homepage: "https://hermes.ai", iconAsset: "/agents/hermes.png", protocolFamily: "openai-compat", description: "..." },
  { id: "codex", displayName: "Codex CLI", homepage: "https://github.com/openai/codex", iconAsset: "/agents/codex.svg", protocolFamily: "openai-compat", description: "OpenAI 官方 CLI" },
  { id: "opencode", displayName: "OpenCode", homepage: "https://opencode.ai", iconAsset: "/agents/opencode.svg", protocolFamily: "openai-compat", description: "..." },
  { id: "claude", displayName: "Claude Code", homepage: "https://www.anthropic.com/claude-code", iconAsset: "/agents/claude.svg", protocolFamily: "anthropic-shim", description: "经 TokenBoss Anthropic 转换层" },
];
```

- [ ] **Step 5.2: 写 api.getDeepLink test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { getDeepLink } from "../api.js";

describe("getDeepLink", () => {
  it("POSTs to /v1/deep-link with session token", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user_id: "u1", key_name: "CC Switch", key_id: 99, deep_links: [], issued_at: "2026-05-13T..." })));
    localStorage.setItem("tb_session", "fake-jwt");
    const r = await getDeepLink();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/deep-link"), expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Authorization": "Bearer fake-jwt" }),
    }));
    expect(r.key_name).toBe("CC Switch");
  });

  it("throws ApiError on 401", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { type: "authentication_error", message: "no session", code: "missing_session" } }), { status: 401 }));
    await expect(getDeepLink()).rejects.toMatchObject({ status: 401, code: "missing_session" });
  });
});
```

- [ ] **Step 5.3: Implement `getDeepLink` in api.ts**

```typescript
// 在 frontend/src/lib/api.ts 现有 helpers 之后加：

export interface DeepLink {
  app: CLIAppId;
  display_name: string;
  url: string;
}

export interface DeepLinkResponse {
  user_id: string;
  key_name: string;
  key_id: number;
  deep_links: DeepLink[];
  issued_at: string;
}

export async function getDeepLink(): Promise<DeepLinkResponse> {
  return request<DeepLinkResponse>("/v1/deep-link", { method: "POST" });
}
```

- [ ] **Step 5.4: Run tests + typecheck** — Expected: PASS

- [ ] **Step 5.5: Commit**

```bash
git add frontend/src/lib/agentDefs.ts frontend/src/lib/api.ts frontend/src/lib/__tests__/api.deepLink.test.ts
git commit -m "feat(frontend): agentDefs + getDeepLink() api client

CLI_APPS 集中 5 个 CLI 的 metadata (id/displayName/icon/homepage/protocolFamily)。
getDeepLink() 调 POST /v1/deep-link 拿 5 个 ccswitch:// URL。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 7 个新组件

**估算：** 3 天

**Files:**
- Create: `frontend/src/components/PrimaryImportButton.tsx`
- Create: `frontend/src/components/ImportScopeNote.tsx`
- Create: `frontend/src/components/KeyInjectionFlow.tsx`
- Create: `frontend/src/components/LoggedInKeyPicker.tsx`
- Create: `frontend/src/components/AnonKeyPasteInput.tsx`
- Create: `frontend/src/components/CCSwitchDetector.tsx`
- Create: `frontend/src/components/ProtocolFamilyLinks.tsx`
- Create: `frontend/src/components/AdvancedManualRecipes.tsx`
- Create: `frontend/src/components/__tests__/PrimaryImportButton.test.tsx`
- Create: `frontend/src/components/__tests__/AnonKeyPasteInput.test.tsx`

**Sub-steps:**

- [ ] **Step 6.1: PrimaryImportButton — 写测试**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimaryImportButton } from "../PrimaryImportButton.js";
import * as api from "../../lib/api.js";

describe("PrimaryImportButton", () => {
  it("calls getDeepLink and triggers 5 window.location.assign on click", async () => {
    const assignSpy = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    vi.spyOn(api, "getDeepLink").mockResolvedValue({
      user_id: "u1", key_name: "CC Switch", key_id: 99,
      deep_links: ["openclaw","hermes","codex","opencode","claude"].map(app => ({ app, display_name: app, url: `ccswitch://...${app}` })),
      issued_at: "2026-05-13T00:00:00Z",
    });
    render(<PrimaryImportButton />);
    await userEvent.click(screen.getByRole("button", { name: /一键导入/i }));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(5));
    expect(assignSpy.mock.calls[0][0]).toBe("ccswitch://...openclaw");
    expect(assignSpy.mock.calls[4][0]).toBe("ccswitch://...claude");
  });

  it("shows error toast on getDeepLink failure", async () => {
    vi.spyOn(api, "getDeepLink").mockRejectedValue(new ApiError(503, { error: { type: "service_unavailable", message: "...", code: "newapi_rate_limited" } }, ""));
    render(<PrimaryImportButton />);
    await userEvent.click(screen.getByRole("button", { name: /一键导入/i }));
    expect(await screen.findByText(/请等几十秒再重试|失败/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Run failing tests** — Expected: FAIL

- [ ] **Step 6.3: Implement PrimaryImportButton**

```tsx
// frontend/src/components/PrimaryImportButton.tsx
import { useState } from "react";
import { getDeepLink } from "../lib/api.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function PrimaryImportButton() {
  const [state, setState] = useState<"idle" | "fetching" | "triggering">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setState("fetching");
    try {
      const { deep_links } = await getDeepLink();
      setState("triggering");
      for (const dl of deep_links) {
        window.location.assign(dl.url);
        await sleep(200);
      }
      // TODO: showToast(`${deep_links.length} 张确认卡片已发送`)
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={state !== "idle"} className="...">
        {state === "idle" ? "一键导入到 CC Switch" : state === "fetching" ? "正在生成..." : "正在发送..."}
      </button>
      {error && <p role="alert" className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6.4: AnonKeyPasteInput — 写测试 + 实现**

```typescript
// 测试要点:
// - 输入 invalid key (空 / 不带 sk- / 长度不对) → 校验失败 + 错误提示
// - 输入 valid key → enable 按钮，点击 → 5 个 client-side buildCCSwitchUrl
//   + window.location.assign
```

Implementation：复用 backend `ccSwitchUrl.ts` 的逻辑（拷一份到 frontend 同样的 file 路径 `frontend/src/lib/ccSwitchUrl.ts`，或者 share via 共享 module — backend 用 Node fs，frontend 是浏览器，没共享 module 路径。采用 **复制** — frontend lib 自己实现 buildCCSwitchUrl，相同逻辑，再加 frontend 单测确保 frontend 实现跟 backend 行为一致）。

- [ ] **Step 6.5: KeyInjectionFlow — 用 auth context 分流**

```tsx
import { useAuth } from "../lib/auth.tsx";
import { LoggedInKeyPicker } from "./LoggedInKeyPicker.js";
import { AnonKeyPasteInput } from "./AnonKeyPasteInput.js";

export function KeyInjectionFlow() {
  const { user } = useAuth();
  return user ? <LoggedInKeyPicker /> : <AnonKeyPasteInput />;
}
```

- [ ] **Step 6.6: LoggedInKeyPicker — 简单包装 PrimaryImportButton + ImportScopeNote**

- [ ] **Step 6.7: ImportScopeNote — 静态文案组件**

```tsx
import { CLI_APPS } from "../lib/agentDefs.js";

export function ImportScopeNote() {
  const directApps = CLI_APPS.filter(a => a.protocolFamily === "openai-compat").map(a => a.displayName).join(" · ");
  const claudeApp = CLI_APPS.find(a => a.id === "claude")!;
  return (
    <p className="text-sm text-stone-600 mt-3 leading-relaxed">
      本次会同时导入：<strong>{directApps}</strong>（OpenAI-compat 直连）
      + <strong>{claudeApp.displayName}</strong>（经 TokenBoss Anthropic 转换层）。
      CC Switch 会弹 {CLI_APPS.length} 张确认卡片，逐个接受即可。
    </p>
  );
}
```

- [ ] **Step 6.8: CCSwitchDetector — 静态引导卡**

```tsx
export function CCSwitchDetector() {
  return (
    <div className="border-2 border-ink rounded-md p-4 bg-amber-50">
      <h3 className="font-bold">还没装 CC Switch？</h3>
      <p className="text-sm">前往 <a href="https://ccswitch.io" target="_blank" rel="noopener" className="underline">ccswitch.io</a> 下载（Mac / Windows / Linux 都有）。装完回来直接点上面的按钮就行。</p>
    </div>
  );
}
```

- [ ] **Step 6.9: ProtocolFamilyLinks — 3 个外链卡**

```tsx
const PROTOCOLS = [
  { id: "openai-compat", title: "OpenAI-compat 协议", desc: "OpenClaw / Hermes / Codex / OpenCode / Cursor 等工具用", to: "/docs/protocols/openai-compat" },
  { id: "anthropic-shim", title: "Claude 协议接入", desc: "Claude Code via TokenBoss Anthropic 转换层", to: "/docs/protocols/anthropic-shim" },
  { id: "gemini-proxy", title: "Gemini 协议接入", desc: "Gemini CLI via CC Switch local proxy（唯一手动配置的）", to: "/docs/protocols/gemini-proxy" },
];

export function ProtocolFamilyLinks() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {PROTOCOLS.map(p => (
        <Link key={p.id} to={p.to} className="block border-2 border-ink rounded-md p-4 hover:bg-stone-50">
          <h4 className="font-bold">{p.title}</h4>
          <p className="text-sm text-stone-600 mt-1">{p.desc}</p>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 6.10: AdvancedManualRecipes — 包旧 RECIPES 数据，沿用旧 RecipeCard / Step / CodeBlock 子组件**

```tsx
// 把 ManualConfigPC.tsx 里的 RECIPES 数组 + RecipeCard + Step + CodeBlock 子组件抽取到这里
// 旧组件接口保持不变（避免重写），只是从主屏顶层下沉到这个 disclosure 子组件内
import { RECIPES, AGENTS } from "./AdvancedManualRecipesData.js";  // 抽取数据到 data file

export function AdvancedManualRecipes() {
  return (
    <div className="mt-4 space-y-6">
      {RECIPES.map(recipe => <RecipeCard key={recipe.id} recipe={recipe} />)}
    </div>
  );
}
```

- [ ] **Step 6.11: 跑全部组件 tests + typecheck**

```bash
cd frontend && npm test
npm run typecheck
```

- [ ] **Step 6.12: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): 7 个新组件 for /install/manual 一键导入流

PrimaryImportButton (主按钮 + 5 URL 序列) / ImportScopeNote (文案预期) /
KeyInjectionFlow (登录态分流) / LoggedInKeyPicker / AnonKeyPasteInput
(贴 key 兜底 + 客户端 buildCCSwitchUrl) / CCSwitchDetector (永远显示的
未装引导) / ProtocolFamilyLinks (3 协议族外链) / AdvancedManualRecipes
(收纳旧 753 行 recipe)

参考: gh-3 design.md §2 + §7

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ManualConfigPC.tsx 整屏重写

**估算：** 1.5 天

**Files:**
- Modify: `frontend/src/screens/ManualConfigPC.tsx`（**整屏重写**，旧 RECIPES 数据搬到 Task 6 创建的 data file 中由 AdvancedManualRecipes 复用）
- Create: `frontend/src/screens/__tests__/ManualConfigPC.test.tsx`

**Sub-steps:**

- [ ] **Step 7.1: 抽取旧 RECIPES + RecipeCard / Step / CodeBlock 到独立 data + 子组件 file（在 Task 6.10 已完成准备）**

- [ ] **Step 7.2: 写新 ManualConfigPC integration test**

```typescript
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ManualConfigPC from "../ManualConfigPC.js";

describe("ManualConfigPC", () => {
  it("renders Hero with CCSwitchDetector + KeyInjectionFlow + ProtocolFamilyLinks + collapsed AdvancedManualRecipes", () => {
    render(<MemoryRouter><ManualConfigPC /></MemoryRouter>);
    expect(screen.getByText(/还没装 CC Switch/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /一键导入/i })).toBeInTheDocument();
    expect(screen.getByText(/OpenAI-compat 协议/i)).toBeInTheDocument();
    // disclosure 默认 closed
    const details = screen.getByText(/高级 · 手动配置 recipe/i).closest("details")!;
    expect(details.open).toBe(false);
  });
});
```

- [ ] **Step 7.3: 写新 ManualConfigPC.tsx**

```tsx
import { useDocumentMeta } from "../lib/useDocumentMeta.js";
import { AppNav, Breadcrumb } from "../components/AppNav.js";
import { CCSwitchDetector } from "../components/CCSwitchDetector.js";
import { KeyInjectionFlow } from "../components/KeyInjectionFlow.js";
import { ImportScopeNote } from "../components/ImportScopeNote.js";
import { ProtocolFamilyLinks } from "../components/ProtocolFamilyLinks.js";
import { AdvancedManualRecipes } from "../components/AdvancedManualRecipes.js";

export default function ManualConfigPC() {
  useDocumentMeta({ title: "一键导入 TokenBoss - 配置教程 | TokenBoss", description: "..." });
  return (
    <>
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Breadcrumb items={[{label:"首页",to:"/"},{label:"配置教程"}]} />
        <section className="mt-6 space-y-6">
          <h1 className="text-3xl font-bold">一键把 TokenBoss 接进你的 Agent CLI</h1>
          <CCSwitchDetector />
        </section>
        <section className="mt-8 space-y-4">
          <KeyInjectionFlow />
          <ImportScopeNote />
        </section>
        <section className="mt-12">
          <h2 className="text-xl font-bold mb-4">延伸阅读 · 协议族文档</h2>
          <ProtocolFamilyLinks />
        </section>
        <section className="mt-12">
          <details className="border-t-2 border-stone-200 pt-4">
            <summary className="cursor-pointer font-bold text-stone-700">高级 · 手动配置 recipe（旧版完整教程）</summary>
            <AdvancedManualRecipes />
          </details>
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 7.4: Run tests + typecheck + npm run build** — Expected: PASS + build success

- [ ] **Step 7.5: Commit**

```bash
git add frontend/src/screens/ManualConfigPC.tsx frontend/src/screens/__tests__/ManualConfigPC.test.tsx
git commit -m "feat(frontend): ManualConfigPC.tsx 整屏重写 / 旧 753 行 recipe 收纳

主屏 = Hero CTA + CCSwitchDetector + KeyInjectionFlow + ImportScopeNote
+ ProtocolFamilyLinks + 折叠的 AdvancedManualRecipes。
旧 753 行 RECIPES + RecipeCard 已抽取到 AdvancedManualRecipes，URL 已修正
为 api.tokenboss.co/v1。

参考: gh-3 design.md §1 (架构图)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 3 个 /docs/protocols/* 子路由屏

**估算：** 2-2.5 天

**Files:**
- Create: `frontend/src/screens/docs/ProtocolOpenAICompat.tsx`
- Create: `frontend/src/screens/docs/ProtocolAnthropicShim.tsx`
- Create: `frontend/src/screens/docs/ProtocolGeminiProxy.tsx`
- Modify: `frontend/src/App.tsx:??`（加 3 个 Route）
- 内容**重写自** `docs/AI配置指令-TokenBoss厂商.md` 但改成人类用户视角（不再是 "给 AI 看的执行清单"）

**Sub-steps:**

- [ ] **Step 8.0: 先创建 `frontend/src/screens/docs/` 目录**

```bash
mkdir -p /Users/Sirius/Developer/tokenboss/frontend/src/screens/docs
```

（Write tool 创建 nested file 时自动 mkdir，这步是 safety net）

- [ ] **Step 8.1: 加 3 个 Route 到 App.tsx**

```tsx
import ProtocolOpenAICompat from "./screens/docs/ProtocolOpenAICompat.js";
import ProtocolAnthropicShim from "./screens/docs/ProtocolAnthropicShim.js";
import ProtocolGeminiProxy from "./screens/docs/ProtocolGeminiProxy.js";

// 在 Routes 中加：
<Route path="/docs/protocols/openai-compat" element={<ProtocolOpenAICompat />} />
<Route path="/docs/protocols/anthropic-shim" element={<ProtocolAnthropicShim />} />
<Route path="/docs/protocols/gemini-proxy" element={<ProtocolGeminiProxy />} />
```

- [ ] **Step 8.2: ProtocolOpenAICompat — 8 个 section（协议总览 / TokenBoss 自定义模型 / Cursor 配置 / Cherry Studio / Chatbox / NextChat / LobeChat / 错误码表 / troubleshooting）**

参考 `docs/AI配置指令-TokenBoss厂商.md` 的 RECOMMENDED_MODELS / ERROR_HANDLING / CONSTRAINTS 段，改成 humanreader 语言（去掉 "AI 必须遵守"、"DONE_CRITERIA" 等 AI-instruction 措辞），base URL 全部用 `api.tokenboss.co/v1`。

```tsx
export default function ProtocolOpenAICompat() {
  useDocumentMeta({ title: "OpenAI-compat 协议接入 | TokenBoss" });
  return (
    <>
      <AppNav />
      <main className="prose mx-auto px-4 py-8">
        <h1>OpenAI-compatible 协议接入</h1>
        <p>TokenBoss 作为 OpenAI-compatible provider，可接入任何支持自定义 base URL 的 AI 工具...</p>
        <h2>关键参数</h2>
        <TerminalBlock>{`base_url:       https://api.tokenboss.co/v1\nauth_header:    Authorization: Bearer <API_KEY>\nmodels_endpoint: GET /v1/models\nchat_endpoint:   POST /v1/chat/completions\nstreaming:      supported (SSE, stream:true)`}</TerminalBlock>
        <h2>推荐模型</h2>
        {/* ... claude-sonnet-4-5 / claude-opus-4 / 等 */}
        <h2>具体工具配置</h2>
        {/* Cursor / Cherry Studio / Chatbox / NextChat / LobeChat / OpenWebUI / Dify */}
        <h2>错误码</h2>
        {/* 401 / 402 / 404 / 429 / 5xx / model_not_found */}
      </main>
    </>
  );
}
```

- [ ] **Step 8.3: ProtocolAnthropicShim — backend shim 工作原理 + Claude Code 配置说明 + 手动配置 fallback**

```tsx
export default function ProtocolAnthropicShim() {
  return (
    <>
      <h1>Claude 协议接入（经 TokenBoss Anthropic 转换层）</h1>
      <h2>工作原理</h2>
      <p>TokenBoss 的 base API 是 OpenAI-compatible，不直接暴露 Anthropic 原生 /v1/messages。
      为让 Claude Code 等 Anthropic-native 客户端能用，TokenBoss backend 实现了协议转换层：
      接收 Anthropic-format 请求 → 内部转 OpenAI-format → 上游执行 → 响应转回 Anthropic-format。
      Streaming SSE 双向支持。</p>
      <h2>Claude Code 配置</h2>
      <p>用 /install/manual "一键导入" 自动配；或在 CC Switch 内手动添加 provider，env 用：</p>
      <CodeBlock language="env">{`ANTHROPIC_BASE_URL=https://api.tokenboss.co\nANTHROPIC_AUTH_TOKEN=sk-...\nANTHROPIC_MODEL=claude-sonnet-4-5`}</CodeBlock>
      <h2>限制</h2>
      <ul>
        <li>当前支持 Anthropic messages API。其他 Anthropic 端点（如 /v1/complete legacy）暂不支持</li>
        <li>Streaming 已实测可用，tool_use 已支持</li>
      </ul>
    </>
  );
}
```

- [ ] **Step 8.4: ProtocolGeminiProxy — 协议不兼容声明 + CC Switch local proxy 手动配教学**

```tsx
export default function ProtocolGeminiProxy() {
  return (
    <>
      <h1>Gemini CLI 协议接入（手动）</h1>
      <h2>为什么 Gemini 不在一键导入里？</h2>
      <p>Gemini CLI 使用 Google AI native 协议（generateContent API），跟 TokenBoss 的 OpenAI-compat 协议
      差异较大。v1 没做 Gemini-native shim（视后续数据决定是否补）。</p>
      <h2>用 CC Switch local proxy 手动配置</h2>
      <p>CC Switch 提供 "Format conversion" local proxy 功能，可以做协议转换。手动步骤：</p>
      <ol>
        <li>在 CC Switch 内启用 Gemini local proxy</li>
        <li>填 upstream URL: https://api.tokenboss.co/v1</li>
        <li>填 conversion: Gemini → OpenAI</li>
        <li>填 API key: 来自 /install/manual 的 key</li>
        <li>在 Gemini CLI 配置中指向 CC Switch local proxy 端口</li>
      </ol>
      <p>详细参考 <a href="https://ccswitch.io/docs/proxy">CC Switch 官方 proxy 文档</a>。</p>
    </>
  );
}
```

- [ ] **Step 8.5: Run tests + typecheck + npm run build**

- [ ] **Step 8.6: Commit**

```bash
git add frontend/src/screens/docs/ frontend/src/App.tsx
git commit -m "feat(frontend): 3 个 /docs/protocols/* 子路由屏 (OpenAI/Anthropic/Gemini)

OpenAI-compat 协议详解、Claude 协议经 shim 接入、Gemini 经 CC Switch
local proxy 手动配。重写自 docs/AI配置指令-TokenBoss厂商.md (改成人类用户
视角，base URL 修正为 api.tokenboss.co/v1)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 全仓 URL 修正 + 老 doc 归档

**估算：** 0.5 天

**Files:**
- Modify: `ROUTER_DEV.md`（替换 `tokenboss-backend.zeabur.app` → `api.tokenboss.co`）
- Move: `docs/AI配置指令-TokenBoss厂商.md` → `docs/legacy/AI配置指令-TokenBoss厂商.md` + 顶部加归档声明
- Verify: AdvancedManualRecipes data 里的 RECIPES 内嵌 URL 已修（Task 6.10 时已做，这里再 grep 一次确认）

**Sub-steps:**

- [ ] **Step 9.1: grep 当前残留**

```bash
grep -rln "tokenboss-backend.zeabur.app" /Users/Sirius/Developer/tokenboss --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" | grep -v node_modules
```

- [ ] **Step 9.2: 批量修 ROUTER_DEV.md**

```bash
# 实测 grep 输出，确认要改的精确路径，再 sed -i 替换
sed -i '' 's|tokenboss-backend\.zeabur\.app|api.tokenboss.co|g' /Users/Sirius/Developer/tokenboss/ROUTER_DEV.md
```

- [ ] **Step 9.3: 移 docs/AI配置指令-TokenBoss厂商.md 到 docs/legacy/，顶部加归档声明**

```bash
git mv docs/AI配置指令-TokenBoss厂商.md docs/legacy/AI配置指令-TokenBoss厂商.md
```

在文件最顶部插入：

```markdown
> **本文档已归档 · 2026-05-13**
>
> 内容已重组到三个协议族子路由：
> - [/docs/protocols/openai-compat](/docs/protocols/openai-compat) — OpenAI-compat 协议详解
> - [/docs/protocols/anthropic-shim](/docs/protocols/anthropic-shim) — Claude 协议经 shim 接入
> - [/docs/protocols/gemini-proxy](/docs/protocols/gemini-proxy) — Gemini 经 CC Switch local proxy 手动配
>
> 一键导入流程见 [/install/manual](/install/manual)。
>
> 原文档保留作为历史归档。

---
```

- [ ] **Step 9.4: 跑一次全仓 grep 确认无残留**

```bash
grep -rln "tokenboss-backend.zeabur.app" /Users/Sirius/Developer/tokenboss --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" | grep -v node_modules
# Expected: empty output
```

- [ ] **Step 9.5: Commit**

```bash
git add ROUTER_DEV.md docs/legacy/AI配置指令-TokenBoss厂商.md
git commit -m "docs: 全仓 URL 修正 tokenboss-backend.zeabur.app → api.tokenboss.co + 老 AI 配置文档归档

ROUTER_DEV.md / ManualConfigPC RECIPES 数据等位置的过时内部域名替换为正式
公开 API endpoint。docs/AI配置指令-TokenBoss厂商.md 归档到 docs/legacy/，
内容已重组到 /docs/protocols/* 三个子路由。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: E2E playwright 测试

**估算：** 1 天

**Files:**
- Create: `frontend/e2e/install-manual.spec.ts`（或沿用 .playwright-mcp/ 现有 pattern）

**Sub-steps:**

- [ ] **Step 10.1: 探明现有 playwright 配置**

```bash
ls /Users/Sirius/Developer/tokenboss/.playwright-mcp/
cat /Users/Sirius/Developer/tokenboss/frontend/playwright.config.ts 2>&1 || echo "no config — use default"
```

- [ ] **Step 10.2: 写 E2E test — 主路径（mock API）**

```typescript
import { test, expect } from "@playwright/test";

test.describe("/install/manual 一键导入", () => {
  test("登录态用户点按钮 → 5 个 window.location 调用", async ({ page }) => {
    // 1. mock /v1/deep-link response
    await page.route("**/v1/deep-link", route =>
      route.fulfill({ json: {
        user_id: "u1", key_name: "CC Switch", key_id: 99,
        deep_links: ["openclaw","hermes","codex","opencode","claude"].map(app => ({
          app, display_name: app, url: `ccswitch://v1/import?app=${app}&...`
        })),
        issued_at: "2026-05-13T00:00:00Z",
      }})
    );
    // 2. fake login (localStorage.setItem)
    await page.addInitScript(() => localStorage.setItem("tb_session", "fake-jwt"));
    // 3. capture window.location.assign calls
    const assignCalls: string[] = [];
    await page.addInitScript(() => {
      (window as any).__assignCalls = [];
      const orig = window.location.assign;
      window.location.assign = (url: string) => { (window as any).__assignCalls.push(url); };
    });
    // 4. navigate + click
    await page.goto("/install/manual");
    await page.click("button:has-text('一键导入')");
    await page.waitForTimeout(1500);  // wait for 5 × 200ms
    const calls = await page.evaluate(() => (window as any).__assignCalls);
    expect(calls).toHaveLength(5);
    expect(calls[0]).toContain("app=openclaw");
    expect(calls[4]).toContain("app=claude");
  });

  test("未登录用户走贴 key 兜底", async ({ page }) => {
    await page.goto("/install/manual");
    await expect(page.getByPlaceholder(/sk-/i)).toBeVisible();
    // invalid key → button disabled
    await page.fill("input[placeholder*='sk-']", "not-a-key");
    await expect(page.locator("button:has-text('一键导入')")).toBeDisabled();
    // valid key
    await page.fill("input[placeholder*='sk-']", "sk-" + "a".repeat(48));
    await expect(page.locator("button:has-text('一键导入')")).toBeEnabled();
  });
});
```

- [ ] **Step 10.3: Run E2E** — Expected: PASS

```bash
cd frontend && npx playwright test install-manual
```

- [ ] **Step 10.4: Commit**

```bash
git add frontend/e2e/install-manual.spec.ts
git commit -m "test(e2e): /install/manual 主路径 + 未登录贴 key 兜底 playwright

mock /v1/deep-link response，断言点按钮触发 5 个 window.location.assign
+ URL 含正确 app 参数。未登录路径校验 key 格式 enable 按钮。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Stage 3.5 Vertical Slice 实操 + 录屏

**估算：** 0.5 天

**Files:** 无新文件，跑 + 录屏 + 写 verification 报告到 `openspec/changes/gh-3-tokenboss-cc-switch-integration/mock/vertical-slice-report.md`

**Sub-steps:**

- [ ] **Step 11.1: 部署 backend 到 staging 或本地 dev server（含 /v1/deep-link + /v1/messages）**

```bash
cd backend && npm run dev  # 本地 8080 port
```

- [ ] **Step 11.2: 部署 frontend 到本地 5173**

```bash
cd frontend && npm run dev
```

- [ ] **Step 11.3: 真实流程实操（不用 mock）**

1. 浏览器访问 http://localhost:5173/install/manual
2. 登录测试账号
3. 点 "一键导入到 CC Switch" 按钮
4. **观察 CC Switch 真的弹 5 张确认卡片**
5. 在 CC Switch 内接受 5 张
6. 打开 ~/.codex/config.toml 验证写入了 TokenBoss provider
7. 跑 `codex` 或 `claude` 真实发起一次 chat 请求
8. 验证响应正常（OpenAI-compat + Anthropic shim 都跑通）

- [ ] **Step 11.4: 录屏 happy path（用 QuickTime Mac 内置 / Loom / 等）**

录 1-2 分钟 screencast：
- 浏览器 → /install/manual
- 点按钮
- CC Switch 弹 5 张卡片
- 接受
- 切到 Terminal 跑 `claude` 命令
- 看到响应

存到 `openspec/changes/gh-3-tokenboss-cc-switch-integration/mock/vertical-slice-demo.mp4`（或 .gif）。

- [ ] **Step 11.5: 写 verification 报告**

```markdown
# Vertical Slice Report · gh-3 v1.0

## 实测路径
1. 登录态用户 → /install/manual → 点按钮 → CC Switch 弹 X 张卡片（实际数: __）
2. 接受全部 → 各 CLI config 写入：
   - ~/.codex/config.toml: ✓ / ✗
   - ~/.openclaw/config.json: ✓ / ✗
   - ~/.claude/settings.json: ✓ / ✗
3. CLI 真实请求 happy path：
   - codex "ping": ✓ / ✗  延迟: __ ms  上游模型: __
   - claude "ping" (streaming): ✓ / ✗ 流式 chunk 数: __

## Spec drift 发现（如有）
（实测期间发现的 spec 跟现实偏差，回写到 [[design.md]] 的 ## Spec Drift 章节）

## 录屏 / GIF
- mock/vertical-slice-demo.mp4 (2:30)

## 通过结论
（pass / partial pass + 阻塞项 / fail + 回 Stage 2）
```

- [ ] **Step 11.6: Commit + 决策点**

```bash
git add openspec/changes/gh-3-tokenboss-cc-switch-integration/mock/
git commit -m "test(vertical-slice): /install/manual + CC Switch + CLI 端到端实测

报告 + 录屏存到 mock/。Stage 3.5 是 WORKFLOW.md 的 HARD-GATE，pass 后才能
进 Stage 4-6。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**决策点：** Vertical Slice pass → 走 Stage 4-6（测试 + review + ship）。Partial pass → 回 Stage 2 改 design。Fail → 回 brainstorming。

---

## 完成判定

11 个 task 全部完成 + Stage 3.5 vertical slice pass + Stage 4 测试 5 项绿 → 进 Stage 5 review → 进 Stage 6 archive。

WORKFLOW.md §6 Stage 6 archive 时：
- `openspec/changes/gh-3-tokenboss-cc-switch-integration/` → `openspec/changes/archive/YYYY-MM-DD-gh-3-tokenboss-cc-switch-integration/`
- spec drift 反向回写到 `openspec/specs/cc-switch-integration/spec.md`（capability spec 长期累积）
- GitHub Issue #3 状态切到 closed
- worktree + branch refs 清理
