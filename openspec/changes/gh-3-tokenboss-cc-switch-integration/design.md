# Design · gh-3-tokenboss-cc-switch-integration

> **状态：Stage 2 待填**
>
> 这个文件由 Stage 2 `superpowers:writing-plans` skill 填充。Stage 1 brainstorming 阶段已经在 [[proposal.md]] §"关键技术决策" 给出 6 条决策（D1-D6），但具体架构图 / 数据模型 / API 接口 schema / 错误处理细节等需要 writing-plans 出具。
>
> **Stage 2 writing-plans 应覆盖的内容**：
>
> 1. 完整架构图（frontend / backend / CC Switch / 各 CLI / 上游 LLM 关系）
> 2. 各组件职责矩阵（§2 已有粗略版，writing-plans 细化）
> 3. `POST /api/me/deep-link` 完整 request/response schema（含 auth / rate limit / error response shape）
> 4. `POST /v1/messages` 完整 Anthropic shim 接口 schema（含 streaming SSE event sequence）
> 5. `anthropicConvert` 函数签名 + 双向 mapping table（field-by-field）
> 6. `ccSwitchUrl` 函数签名 + 5 app × URL template
> 7. 5 app 各自的 deep link 完整 payload（特别是 `claude` / `codex` 需要 configFormat=json + base64 编码）
> 8. Reserved "CC Switch" key 的 backend 创建 / 查找 / revoke 流程详图
> 9. Frontend 各组件的 state machine（特别是 `KeyInjectionFlow` 登录/未登录分流）
> 10. Spec drift 追踪机制（Stage 3 实施期间发现 spec 偏离时回写到这个文件的 `## Spec Drift` 章节）
>
> 不要在这里写文件级 / 代码级实施步骤 — 那是 [[tasks.md]] 的工作。

## Spec Drift

（Stage 3 实施期间发现 spec 跟现实偏离时记录在这里，Stage 6 archive 时反向回写到 capability spec）
