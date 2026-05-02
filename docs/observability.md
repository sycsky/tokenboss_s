# Observability — Tier 1 (free)

最小可观测栈，目标：99% 严重问题（崩溃 / 宕机 / 异常 burst）能在 1-5 分钟内通知到 oncall。

---

## 1. Sentry — 异常上报

### 当前状态

Backend `local.ts` 已经集成 `@sentry/node`。三个层级的 catch 都接了 Sentry：
- 路由 handler 抛错 → `Sentry.captureException(err, { tags: { route } })`
- streaming 路径（`/v1/chat/completions` / `/v1/responses`）抛错 → 同上
- 顶层未捕获 promise reject → 同上

`SENTRY_DSN` 环境变量空时 Sentry 完全 no-op（dev / CI 跑不会触发上报）。

### 部署步骤

1. **注册 Sentry 账号**：https://sentry.io（免费 tier 5k events/月，对早期 v1 够用）
2. **新建 Project**：选 Node.js
3. **复制 DSN**：项目 settings → Client Keys → 形如 `https://abc@o123.ingest.sentry.io/456`
4. **zeabur 后端服务加 env**：
   ```
   SENTRY_DSN=https://abc@o123.ingest.sentry.io/456
   ```
5. **重新部署**。看到日志 `[sentry] initialised` 即生效。
6. **测试**：访问 `https://api.tokenboss.co/healthz` 返回 200。然后人为触发一次异常（比如带个不合法 body 的 POST），看 Sentry dashboard 5-30 秒内有 issue。

### 配置注意

- `tracesSampleRate: 0` —— 不收性能 trace 数据，避免 free tier 配额被刷爆。需要看 perf 时再调
- `beforeSend` —— 自动从 issue URL 里 strip 掉 query string，避免 `?token=xxx` 这种 secret 误入 Sentry

---

## 2. Healthchecks.io — Uptime 探针

### 部署步骤

1. **注册** https://healthchecks.io（免费 20 个 check）
2. **新建 Check**：
   - Name: `tokenboss-backend`
   - Schedule: every 1 minute
   - Grace period: 1 minute
3. **拿到 ping URL**（形如 `https://hc-ping.com/abc-def-...`）
4. **配 HTTP probe**（Healthchecks 也支持反向 — 它去 ping 你的 endpoint）：
   - 切换到 "HTTP" mode
   - URL: `https://api.tokenboss.co/healthz`
   - Method: GET
   - Expected status: 200
5. **设 Notification**：邮件 / Slack / Telegram / 微信（webhook 方式）

`/healthz` endpoint 故意做得轻量 — 只返回 `{status:"ok"}`，不调 DB 不调 newapi。下游慢 / newapi 挂时不会触发误报。

### 替代选项

Healthchecks.io 不顺手可以换：
- **UptimeRobot** —— 50 个 monitor 免费，5 分钟间隔
- **Better Stack Uptime** —— 10 个 monitor 免费，30 秒间隔
- **Cronitor** —— 5 个免费

---

## 3. 看什么指标（清单）

按业务影响优先级排序。Tier 1 阶段靠 **Sentry issue 流 + 每天扫一眼 zeabur 日志** 看：

### 日常需要扫的（每天 1 次）

- **Sentry inbox** —— 有新 issue 就看一下，是真错还是噪音
- **zeabur backend 日志** —— grep 这些标记：
  - `[webhook/epusdt]` 或 `[webhook/xunhupay]` —— 看有没有 `failed` / `signature verification failed`
  - `[sub-poller]` —— 看有没有 `skipped:` 行（user 失败计数）
  - `[source-attribution] fallback=other` —— 用户在用没识别的 Agent UA
  - `error` / `Error` —— 兜底

### 自动告警（Healthchecks）

- `/healthz` 1 分钟没响应 → 邮件
- 出现新 Sentry issue（首次出现时邮件，之后默认静默降噪）

### 暂时还没做的（Tier 2 准备）

- HTTP 5xx rate / 4xx rate 趋势（要加 metrics endpoint）
- 订单 created → paid → settled 转化率（要 query orders 表）
- newapi 调用 p95 延迟（要打点）
- 单 IP 请求量异常（防 brute force）—— 这块如果用了 Cloudflare 自带，可以直接看

### 红灯信号（应该立刻响应）

| 信号 | 原因 | 应对 |
|---|---|---|
| `/healthz` 持续返回失败 | 进程崩 / OOM / 部署挂 | 看 zeabur restart 日志，回滚或重启 |
| Sentry 5 分钟内 ≥10 同类 issue | 某条线大面积失败 | grep zeabur 日志找 root cause |
| `[webhook/*]` `failed` rate 突增 | 钱付了没到账 | 立刻看 `applyTopupToUser` / `applyPlanToUser` 错误，手动补单 |
| `[sub-poller] skipped` 持续多个用户 | newapi 挂 / token 失效 | 看 `NEWAPI_BASE_URL` env / newapi 服务自身 |

---

## 4. 后续路径（按需要再做）

- **Tier 2** (~$10/月)：metrics endpoint + Grafana Cloud free / Better Stack 拉数据画图，看 silent failure 趋势
- **Tier 3** (~$30/月)：PostHog 前端 session replay，用户报 bug 直接看视频复现
