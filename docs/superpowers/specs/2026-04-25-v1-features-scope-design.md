# v1 完整功能清单 + scope 拆分

**Date:** 2026-04-25 (revised 2026-04-26)
**Status:** Approved, pending implementation
**Topic:** TokenBoss v1 上线的功能 scope。v1 拆分为 **v1.0（无支付，内测）** + **v1.1（支付接入，由同事接手）** 两个阶段。

**2026-04-26 修订**：
- Onboarding 改 **`set up tokenboss.com/skill.md` 一行咒语**（Agent 拉远程 markdown → 自动注册到 skill 目录）→ 完全替代 4 步 manual config + pairing code TB-XXX 流程。
- 网页 Dashboard 命名 → **控制台**（更本地化）。
- ⚡ Model footer 不可行（聊天回复无 hook 可注入）→ 改在控制台显示"最近调用"strip 替代。
- v2 路线锁定：**第一方 Skills + 第三方 SaaS 集成**（不做 Agent OEM / 不做 Sell API marketplace）。v1.0 网页 nav 不喊 v2，保留扩展位即可。
- 目标用户：**AI Agent 用户**（OpenClaw / Hermes 主推；Claude Code / Codex 兼容）。**不放** Cursor / Windsurf 等纯 IDE 编程工具。
- Less-is-more 原则：每个 UI 元素都要"挣得"展示资格；默认怀疑式删除。

## Context

credits 经济模型已锁定（参见 [`2026-04-25-credits-economy-design.md`](./2026-04-25-credits-economy-design.md)）。本 spec 决定**实际 v1 上线哪些 feature / 哪些推迟 / 哪些不做**。

**关键策略决定**：v1 不一次推完整支付 + 套餐购买流程。先做 **v1.0（无真实支付）** 给内部朋友试用 → 验证整条用户体验 → **v1.1（同事接手补支付）**。这样：

1. 提前 1-2 周上线 → 早收用户反馈
2. 虎皮椒商户注册 + 集成测试 + 退款流程不阻塞 v1.0
3. 内测朋友的 credit 由后端 SQL 直接发放（无需 admin UI）
4. 支付集成模块隔离清晰 → 同事接手时改动最小

**v1.0 用户视角**：所有 UI 流畅可用，唯一停在"点击支付按钮 → 支付页"。该页显示"请联系管理员获取额度"+ 客服微信。

## v1.0 Scope · 必做

### 1. Frontend / 网站（7 个页面）

| 页面 | 状态 | 说明 |
|---|---|---|
| **Landing** (v10) | 重写 | Hero **"你的 Agent 钱包"** + 黑底终端块 `$ set up tokenboss.com/skill.md` + COPY 按钮 + 兼容 Agent compat row 抬到 hero 上方（OC / CX / HM / CC 4 个 logo） + 套餐 3 卡 + 充值 ¥50→$50 + footer。砍掉 3 步上手 / 已支持工具区 / 杠杆卡（与套餐 tile 重复） / 销售感 CTA meta |
| **Auth** (Register + Login, auth-v0) | 改造 | 邮箱 + 6 位验证码（无密码）。Register 送 $10 / 24h 试用。现有 `Register.tsx` / `Login.tsx` 改造 |
| **Onboarding** (onboarding-v0) | 重写 | 4 屏：**I am Agent / I am Human 选择** → **一行咒语 `set up tokenboss.com/skill.md`** → API key 一次显示 + 复制 → 搞定庆祝。**砍 pairing code TB-XXX 流程**（被 skill.md 替代）|
| **控制台** (dashboard-v1, 原 Dashboard) | 重写 | `$X.XX` 余额 hero + 今日 cap 进度 + 黑底"最近调用"strip + 活跃 bucket 列表 + **接入中心卡** + 内嵌使用历史 4 行 + 内嵌 API Key 列表 + 快捷链接。控制台 = 账号一切，使用历史 / API Key 不再单独占顶导 |
| **套餐定价页** (pricing-v8) | 重写 | 顶部 ¥1=$1 baseline 锚卡 + 编号 01/02 + 3 张卡（Plus ¥288 / Super ¥688 / Ultra ¥1688 SOLD） + ×3/×4/×12 优惠 pill + ≈$X 总额度 + i hover tooltip。CTA 按 auth state 分叉：访客 → 免费注册试用，登录用户 → 联系客服开通 |
| **Payment**（v1.0 stub）| 新建 | 客服微信 + 二维码。等 v1.1 同事补支付 |
| **使用历史子页** (history-v1.2) | 改造 | 当前余额 pill + 24h 消耗柱状图 + 类型列（消耗/重置/作废，颜色编码） + $变化列 + 完整 timestamp + 筛选 selects + 首/末页分页。删 CSV 导出 / 用量列 / 搜索框 / 日期分组 |
| **账户设置页** (settings-v1) | 新建 | 邮箱 + 套餐 + 注册时间 + 用量摘要（消耗 + 调用）+ 联系客服 + 退出登录。**砍头像 / 显示名 / 最常用模型** |
| **接入文档页** (manual-config-pc) | 改造 | 主路径 `set up tokenboss.com/skill.md` 一行咒语。传统 4 步 fallback（克隆 → install → 配 key → 测试）折叠为二级 |

### 2. Backend / 后端（6 件 surgical 改动）

> **原则**：保留现有 tsx server / Lambda handler / SQLite store / newapi 上游集成。**只补足经济模型必需的功能**。架构不动。

| 改动 | 说明 |
|---|---|
| **邮箱 + 验证码 auth** | 加 `POST /v1/auth/send-code` + `POST /v1/auth/verify-code`。短 TTL 内存 / SQLite store，限频防滥用。**移除现有 scrypt 密码逻辑**（register / login 改成只验证 code）|
| **Bucket 数据模型** | 新建 `credit_bucket` 表（详情见 credits-economy spec）。所有 sku_type 都先实现（`trial` / `topup` / `plan_plus` / `plan_super` / `plan_ultra`）—— 因为内测朋友会被手动 grant 套餐 bucket，这些类型必须可工作 |
| **Cron 任务（双事件）** | (a) 每日 0:00 双事件原子操作：先 `expire`（−剩余）后 `reset`（+cap）；(b) 28 天后周期结束清零；(c) 试用 24h 过期 |
| **usage_log 加 event_type** | 现有表加 `event_type` 字段（`consume` / `reset` / `expire` / `topup` / `refund`）。重置 / 作废由 cron 写入 |
| **模式锁 + 模型池检查** | 在 chatProxy 里：扣费前查用户 active bucket 的 `mode_lock` / `model_pool`，不符合 → 返回 in-chat 文本提示 |
| **`/skill.md` 静态托管** | 把 `tokenboss.com/skill.md` 内容生成静态文件（YAML frontmatter + Quick Start + Models + Routing & Limits）。可考虑动态生成（按用户当前套餐显示具体 daily cap），但 v1.0 静态即可 |
| **路由 wiring** | 利用现有 `backend/src/router/` 内置路由（已有 auto / eco / premium / agentic profiles）。v1.0 wiring：用户 active bucket → 选 profile（Plus → eco；Super → auto；Ultra → premium；trial → 强制 eco；Manual → bypass router）|

**砍掉的（已废）**：
- ~~Pairing code 流程~~ —— 被 `set up tokenboss.com/skill.md` 一行咒语替代。Agent 直接拉远程 markdown，不需要 6 位 TB-XXX 配对码。`pairing_codes` 表 / 端点都不实现。

### 3. Admin · 0 个页面

v1.0 不做任何 admin UI。**理由**：v1.0 没有真实支付 → 无支付纠纷需求 → admin 主要价值（手动补发 / 退款）暂时不存在。

**替代方案**：内测期间 credit 发放走 **直接 SQLite 操作**。spec 提供示例 SQL（见下面 implementation hooks）。

### 4. Agent 集成（2 件）

| 项 | 说明 |
|---|---|
| **`set up tokenboss.com/skill.md` 一行咒语** | 用户在 Agent 终端粘贴这行 → Agent 拉远程 markdown → 解析 frontmatter → 注册到本地 skill 目录。Claude Code / Codex / OpenClaw / Hermes 都识别。**替代之前的 4 步 manual config + pairing code 流程** |
| **In-chat 摩擦消息（5 模板）**| 付费模型撞墙 / 试用切付费 / 当日额度耗尽 / 周期结束 / 服务异常 |

**砍掉的（已废）**：
- ~~复制命令机制（自然语言 + TB-XXX）~~ → skill.md 一行咒语取代
- ~~⚡ Model footer~~ → 聊天回复末尾不可注入。改在控制台显示"最近调用"strip
- ~~Pairing code 流程~~ → skill.md 自带认证（用户复制粘贴时 API key 已包含或一次性显示后填入 config）

## v1.0 不做（→ v1.1 同事接手）

| 项 | 备注 |
|---|---|
| 虎皮椒 webhook 处理（`POST /api/payments/webhook`） | 同事写。stub 位置：参考 `frontend/src/screens/Payment.tsx` |
| `/api/checkout` 下单端点 | 同事写。需要：根据 sku_type 创建虎皮椒订单 + 返回支付链接 |
| `/api/payments/status/:orderId` 状态轮询 | 同事写 |
| 支付页真实组件（替换 stub）| 同事写：移动 H5 唤起 / PC 二维码扫码 |
| Admin UI（login / users / orders / 等）| Phase 1.5 |
| ClawRouter 独立云端部署 | **不做** —— 路由逻辑已在 backend 内置 |
| 微信支付 | Phase 1.5（需公司执照 + Ping++）|
| 密码重置 / 修改密码 | **永久不做**（无密码体系）|
| 设备管理独立页 | Phase 1.5 |
| Health / Config admin 页 | Phase 1.5 |
| 多区部署（HK + US 隧道）| Phase 1.5 |

## v1.0 永久不做

- 邀请裂变 / 分销
- 残余额度跨周期结转
- 每日 / 每小时细粒度 rate limit
- 团队 / 企业账户
- 多 Agent 专属适配（除 OpenClaw + Hermes 外，靠 OpenAI 兼容 endpoint + skill.md 通用）

## v2 路线图（明确）

- **第一方 Skills**（重点）：平台自营，基于 v1 已有 API + per-call billing 底座，TokenBoss 团队创建开箱即用 Skill（YouTube News 视频生成 / 周报自动生成 / 代码 review 工作流 等）
- **第三方 SaaS 集成**（配套）：让 Skills 能跑起来，对接 GitHub / Notion / Slack / Lark / 飞书 / 高德 等用户日常工具
- **Google OAuth 登录**（v1.1 free win）

## v2 明确不做

- Agent Companies / OEM 路线（skillboss "用户付钱给你不是我们 + 零抽成"那套）
- Sell API 创作者层（不开放第三方 API 提供商上架）
- Marketplace（不做用户互卖 skill 的双边市场）

## 目标用户

**AI Agent 用户**，不是纯 IDE 编程工具用户。具体：
- ✅ OpenClaw（中文 Agent，主推）
- ✅ Hermes Agent（主推）
- ✅ Claude Code（Anthropic CLI）
- ✅ Codex（OpenAI CLI）
- ✅ Claude Agent SDK（开发者构建 Agent）
- ✅ NanoClaw / OpenAI 兼容 endpoint
- ❌ Cursor / Windsurf / Replit / Lovable / Bolt / GitHub Copilot（IDE，不放）

## Implementation hooks

### 内测朋友手动 grant credit · SQL 示例

给 `friend@example.com` 加一份 Plus 套餐 bucket（28 天）：

```sql
-- 1. 查 user_id
SELECT userId FROM users WHERE email = 'friend@example.com';
-- 假设返回 'u_e41e143f8a54461e8d05'

-- 2. 插 bucket
INSERT INTO credit_bucket (
  id, user_id, sku_type, amount_usd, daily_cap_usd, daily_remaining_usd,
  total_remaining_usd, started_at, expires_at, mode_lock, model_pool, created_at
) VALUES (
  lower(hex(randomblob(16))),
  'u_e41e143f8a54461e8d05',
  'plan_plus',
  840.00,    -- 28 天累计上限（仅展示，实际看 daily_cap）
  30.00,     -- Plus 日 cap
  30.00,     -- 当日剩余（满血）
  NULL,      -- topup 才用
  datetime('now'),
  datetime('now', '+28 days'),
  'auto_only',
  'gpt_only',
  datetime('now')
);
```

类似的可以做 Super（daily_cap=80）/ Ultra（daily_cap=720）/ topup（无 expires_at）。

### Frontend 改动文件清单

| 现有文件 | 操作 |
|---|---|
| `Landing.tsx` | 重写：hero "你的 Agent 钱包" + 一行咒语终端块 + 砍冗余 |
| `LandingVision.tsx` | 删除（v1 不需要） |
| `Register.tsx` | 改造：去密码字段，加验证码 |
| `Login.tsx` | 改造：去密码字段，加验证码 |
| `OnboardWelcome.tsx` | 重写：I am Agent / I am Human 选择 |
| `OnboardInstall.tsx` | 重写：一行咒语 `set up tokenboss.com/skill.md` + COPY 按钮 |
| ~~`OnboardPairCode.tsx`~~ | **删除**（pairing code 流程已废） |
| ~~`OnboardBind.tsx`~~ | **删除**（pairing code 流程已废） |
| `OnboardSuccess.tsx` | 重写：搞定庆祝 + 简化 |
| `Dashboard.tsx` → 改名为**控制台** | 重写：`$X.XX` 余额 hero + bucket 列表 + 接入中心卡 + 内嵌历史 + 内嵌 API Key |
| `Plans.tsx` → 改名为**套餐** | 重写：baseline 锚 + Plus / Super / Ultra-SOLD + ×N pill |
| `Payment.tsx` | 改造：v1.0 stub「联系客服开通」+ 微信 QR |
| `PaymentSuccess.tsx` | 删除（v1.0 不会到达此页） |
| `AddOns.tsx` / `AddOnSuccess.tsx` | 删除（充值 UI 合并到 Pricing 底部 baseline 行）|
| `Keys.tsx` | 删除（API Key 列表收纳进控制台内嵌区）|
| `UsageHistory.tsx` | 改造：$ 单位 + 24h 图表 + 类型列 + 完整 timestamp |
| `LowBalance.tsx` / `BalanceCommand.tsx` / `FlowIndex.tsx` | 删除（mock 演示页） |
| 账户设置页（新建）| 邮箱 + 套餐 + 注册时间 + 用量摘要 + 退出 |
| 接入文档页（新建）| `manual-config-pc`：一行咒语主路径 + 4 步 fallback 折叠 |

### Backend 端点清单

| 端点 | v1.0 状态 |
|---|---|
| `POST /v1/auth/send-code` | **新建** |
| `POST /v1/auth/verify-code` | **新建** |
| `POST /v1/auth/register` | 改造（无密码） |
| `POST /v1/auth/login` | 改造（验证码版） |
| `GET /v1/me` | 保留 |
| `GET /v1/keys` / `POST /v1/keys` / `DELETE /v1/keys/:id` / `GET /v1/keys/:id/reveal` | 保留（已有） |
| `POST /v1/chat/completions` | 改造（加 mode lock + 模型池检查 + 路由 wiring） |
| `GET /v1/usage` | 改造（加 `event_type` 字段：consume/reset/expire/topup/refund） |
| `GET /v1/router/tiers` | 保留 |
| **`GET /skill.md`** | **新建静态资源**：返回 markdown 文件，YAML frontmatter + Quick Start + Models + Routing。可考虑用 Express middleware 设 `Content-Type: text/markdown` |
| **`GET /api/catalog.json`** | **新建**：当前可用模型列表（model_id + 单价 + 兼容套餐 pool），供 skill.md 中的 "live model list" 链接 |
| ~~`POST /api/pairing/issue`~~ | **不做**（pairing 流程已废） |
| ~~`POST /api/pairing/verify`~~ | **不做** |
| `POST /v1/payments/webhook` | **不做** → v1.1 同事 |
| `POST /api/checkout` | **不做** → v1.1 同事 |
| `GET /api/payments/status/:orderId` | **不做** → v1.1 同事 |

### v1.1 同事接手交付物

为了让同事接手时改动最小，v1.0 交付时 Payment.tsx 应该是：

```tsx
// Payment.tsx · v1.0 stub
export function Payment() {
  const { plan } = useLocation().state;
  return (
    <div>
      <h2>支付通道即将开放</h2>
      <p>当前为内测期间，请联系管理员获取 {plan} 额度</p>
      <img src="/wechat-qr.png" alt="客服微信" />
      <p>客服微信：<code>tokenboss_admin</code></p>
      {/* TODO v1.1: replace this stub with real 支付宝 H5 / 扫码 */}
    </div>
  );
}
```

同事接手时只需替换该组件 + 加上面 3 个 backend 端点 + 加 webhook 后 bucket 创建逻辑（参考 SQL 示例）。

### Email 服务（验证码）

v1.0 简单方案：用 Resend / SendGrid / 阿里云邮件。env 变量配 API key + 发件人。验证码 6 位数字，5 分钟有效。每邮箱每分钟最多请求 1 次。

## Acceptance · v1.0 上线 checklist

- [ ] 用户注册（邮箱 + 验证码）→ 自动赠 trial bucket（$10 / 24h / Auto-ECO）
- [ ] 用户从 onboarding 复制 `set up tokenboss.com/skill.md` → 粘到 OpenClaw（或 Hermes / Claude Code / Codex） → Agent 拉远程 markdown → 注册 skill → trial 激活
- [ ] `tokenboss.com/skill.md` 静态资源可访问（YAML frontmatter + Quick Start + Models + Routing）
- [ ] 用户在 OpenClaw 里聊任务 → 调用记录写入 usage_log（event_type=consume）
- [ ] 用户切到 Manual paid model → 路由层拒绝 → 收到 in-chat 文本"试用仅限智能路由"
- [ ] 试用 24h 后 → 第一次调用收到"试用已结束，请联系客服"
- [ ] 内测朋友被手动 grant Plus 套餐 → 当日 $30 cap 生效
- [ ] 每日 0:00 cron：作废 + 重置双事件正确写入 usage_log（剩余 > 0 写 expire；永远写 reset）
- [ ] 控制台显示 `$X.XX` 余额 hero + bucket 列表（套餐 / 充值 + 优先扣套餐 → 充值）
- [ ] 使用历史页显示 24h 柱状图 + 完整时间戳 + 类型 pill（消耗/重置/作废）+ 颜色编码
- [ ] 套餐页 3 张卡（¥288 Plus / ¥688 Super / ¥1688 Ultra-SOLD）+ ×N pill + 顶部 baseline 锚卡
- [ ] 访客（未登录）打开 /pricing → Ultra 显示 "免费注册试用 →" CTA；登录后才显示 "名额已满"
- [ ] 账户页极简（邮箱 + 套餐 + 注册时间 + 总消耗/调用 + 退出）— 无头像 / 显示名 / 最常用模型
- [ ] Plus 用户尝试 Manual `claude-opus-4` → 收到 in-chat "此模型需 Super 或加买充值"
- [ ] Payment 跳转 → 客服微信二维码（v1.0 stub）

## Risk & rollback

- **如果验证码邮件发不出去** → 注册全卡。需要监控 + 备用 SMTP
- **如果手动 SQL 出错（发错 bucket）** → 直接 SQL 改回。无 admin UI 意味着错误更容易但也更容易修
- **如果 v1.0 内测发现核心 UX 问题** → 推迟 v1.1 接支付，先迭代 v1.0
- **如果同事接手 v1.1 时间晚于预期** → v1.0 可继续运行，靠手动发 credit 度过
