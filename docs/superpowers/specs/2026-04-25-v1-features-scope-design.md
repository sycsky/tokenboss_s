# v1 完整功能清单 + scope 拆分

**Date:** 2026-04-25
**Status:** Approved, pending implementation
**Topic:** TokenBoss v1 上线的功能 scope。v1 拆分为 **v1.0（无支付，内测）** + **v1.1（支付接入，由同事接手）** 两个阶段。

## Context

credits 经济模型已锁定（参见 [`2026-04-25-credits-economy-design.md`](./2026-04-25-credits-economy-design.md)）。本 spec 决定**实际 v1 上线哪些 feature / 哪些推迟 / 哪些不做**。

**关键策略决定**：v1 不一次推完整支付 + 套餐购买流程。先做 **v1.0（无真实支付）** 给内部朋友试用 → 验证整条用户体验 → **v1.1（同事接手补支付）**。这样：

1. 提前 1-2 周上线 → 早收用户反馈
2. 虎皮椒商户注册 + 集成测试 + 退款流程不阻塞 v1.0
3. 内测朋友的 credit 由后端 SQL 直接发放（无需 admin UI）
4. 支付集成模块隔离清晰 → 同事接手时改动最小

**v1.0 用户视角**：所有 UI 流畅可用，唯一停在"点击支付按钮 → 支付页"。该页显示"请联系管理员获取额度"+ 客服微信。

## v1.0 Scope · 必做

### 1. Frontend / 网站（10 个页面）

| 页面 | 状态 | 说明 |
|---|---|---|
| Landing | 重写 | 已被说服 + 30 秒确信 + 套餐价位锚点；展示 Plus / Super / Ultra 套餐入口；现有 `Landing.tsx` 文案重写 |
| Register | 改造 | **去掉密码字段**；只用邮箱 + 验证码；现有 `Register.tsx` 改 |
| Login | 改造 | **去掉密码字段**；邮箱 → 收码 → 输码 → 进；现有 `Login.tsx` 改 |
| Onboarding（welcome / install / pair / success）| 重写 | 礼物卡视觉（$10 / 24h）+ 复制命令到 OpenClaw / Hermes hero 路径 + "其他工具"二级入口；现有 4 个 onboard 页全部重做 |
| Dashboard | 重写 | `$X.XX` 美金余额 hero + 当前活跃 bucket + 今日消耗；现有 `Dashboard.tsx` 单位是积分，改 $ |
| Billing / Pricing | 重写 | 3 张套餐卡（Plus + Super + Ultra-SOLD OUT）+ 5 档 topup 表；按钮**正常显示**"立即订阅"；现有 `Plans.tsx` 全替 |
| Payment（v1.0 stub）| 新建 | 用户从 Billing 点购买跳到这里。**v1.0 显示**："支付通道即将开放，请联系管理员获取额度 + 微信 [二维码 / ID]" |
| 使用历史 | 改造 | 沿用现有 `UsageHistory.tsx` 结构；积分→$ + 加 tokens 列 + 加 模式列 |
| 设置 / 账户 | 新建 | 邮箱（不可改）+ 退出登录。无密码相关 |
| 接入文档 | 新建 | 非 hero 工具（NanoClaw / Codex / OpenAI 兼容）的手动配置 PC tab 列表 |
| API key 管理 | 微调 | 现有 `Keys.tsx` 文案微调即可 |

### 2. Backend / 后端（6 件 surgical 改动）

> **原则**：保留现有 tsx server / Lambda handler / SQLite store / newapi 上游集成。**只补足 v15 经济模型必需的功能**。架构不动。

| 改动 | 说明 |
|---|---|
| **邮箱 + 验证码 auth** | 加 `POST /v1/auth/send-code` + `POST /v1/auth/verify-code`。短 TTL 内存 / SQLite store，限频防滥用。**移除现有 scrypt 密码逻辑**（register / login 改成只验证 code）|
| **Bucket 数据模型** | 新建 `credit_bucket` 表（详情见 credits-economy spec）。所有 sku_type 都先实现（`trial` / `topup` / `plan_plus` / `plan_super` / `plan_ultra`）—— 因为内测朋友会被手动 grant 套餐 bucket，这些类型必须可工作 |
| **Cron 任务** | (a) 每日 0:00 重置所有 active 套餐 bucket 的 `daily_remaining_usd`；(b) 28 天后周期结束清零；(c) 试用 24h 过期 |
| **模式锁 + 模型池检查** | 在 chatProxy 里：扣费前查用户 active bucket 的 `mode_lock` / `model_pool`，不符合 → 返回 in-chat 文本提示 |
| **Pairing code 流程** | 新建 `pairing_codes` 表 + 生成端点 `POST /api/pairing/issue` + 验证端点 `POST /api/pairing/verify`。TB-XXXXXX 6 位 base62，10 分钟 TTL，单次有效。绑定设备到用户。|
| **路由 wiring** | 利用现有 `backend/src/router/` 内置路由（已有 auto / eco / premium / agentic profiles）。v1.0 wiring：用户 active bucket → 选 profile（Plus → eco；Super → auto；Ultra → premium；trial → 强制 eco；Manual → bypass router）|

### 3. Admin · 0 个页面

v1.0 不做任何 admin UI。**理由**：v1.0 没有真实支付 → 无支付纠纷需求 → admin 主要价值（手动补发 / 退款）暂时不存在。

**替代方案**：内测期间 credit 发放走 **直接 SQLite 操作**。spec 提供示例 SQL（见下面 implementation hooks）。

### 4. Agent 集成（4 件）

| 项 | 说明 |
|---|---|
| 复制命令机制 | 自然语言指令 + 嵌入的 pairing code TB-XXXXXX。用户从 onboarding 页复制 → 粘到 OpenClaw / Hermes |
| ⚡ Model footer | 每条 Auto 路由回复末尾追加 `⚡ [model] · 自动路由` |
| In-chat 摩擦消息（5 模板）| 付费模型撞墙 / 试用切付费 / 当日额度耗尽 / 周期结束 / 服务异常 |
| Pairing code 流程 | 跟后端 pairing 端点配套 |

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

- Skills 市场（Phase 2+）
- 邀请裂变 / 分销
- 残余额度跨周期结转
- 每日 / 每小时细粒度 rate limit
- 团队 / 企业账户
- 多 Agent 专属适配（除 OpenClaw + Hermes 外，靠 API Key 通用兼容即可）

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
| `Landing.tsx` | 重写文案 + CTA |
| `LandingVision.tsx` | 删除（v1 不需要） |
| `Register.tsx` | 改造：去密码字段，加验证码 |
| `Login.tsx` | 改造：去密码字段，加验证码 |
| `OnboardWelcome.tsx` | 重写：礼物卡视觉 |
| `OnboardInstall.tsx` | 重写：复制命令 hero + 二级 docs 入口 |
| `OnboardPairCode.tsx` | 重写：等待 pairing code 输入 |
| `OnboardBind.tsx` | 重写：实际验证 pairing |
| `OnboardSuccess.tsx` | 重写：成功庆祝 |
| `Dashboard.tsx` | 重写：$ 单位 + bucket 显示 |
| `Plans.tsx` | 重写：Plus / Super / Ultra-SOLD OUT |
| `Payment.tsx` | 改造：v1.0 stub「联系管理员获取额度」+ 微信 |
| `PaymentSuccess.tsx` | 删除（v1.0 不会到达此页） |
| `AddOns.tsx` / `AddOnSuccess.tsx` | 删除（topup UI 合并到 Plans）|
| `Keys.tsx` | 微调文案 |
| `UsageHistory.tsx` | 改造：$ 单位 + tokens / 模式列 |
| `LowBalance.tsx` / `BalanceCommand.tsx` / `FlowIndex.tsx` | 删除（mock 演示页） |
| 设置页（新建）| 邮箱 + 退出 |
| 接入文档页（新建）| 非 hero 工具 manual config |

### Backend 端点清单

| 端点 | v1.0 状态 |
|---|---|
| `POST /v1/auth/send-code` | **新建** |
| `POST /v1/auth/verify-code` | **新建** |
| `POST /v1/auth/register` | 改造（无密码） |
| `POST /v1/auth/login` | 改造（验证码版） |
| `GET /v1/me` | 保留 |
| `GET /v1/keys` / `POST /v1/keys` / `DELETE /v1/keys/:id` / `GET /v1/keys/:id/reveal` | 保留（已有） |
| `POST /api/pairing/issue` | **新建** |
| `POST /api/pairing/verify` | **新建** |
| `POST /v1/chat/completions` | 改造（加 mode lock + 模型池检查 + 路由 wiring） |
| `GET /v1/usage` | 保留（数据格式微调） |
| `GET /v1/router/tiers` | 保留 |
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
- [ ] 用户从 Onboarding 页复制命令 → 粘到 OpenClaw（或 Hermes） → bot 跑安装 → bind 成功 → trial 激活
- [ ] 用户在 OpenClaw 里聊任务 → 收到带 ⚡ Model 的回复
- [ ] 用户切到 Manual paid model → 路由层拒绝 → 收到 in-chat 文本"试用仅限智能路由"
- [ ] 试用 24h 后 → 第一次调用收到"试用已结束，请联系管理员"
- [ ] 内测朋友被手动 grant Plus 套餐 → 当日 $30 cap 生效，到 24:00 重置
- [ ] Plus 用户尝试 Manual `claude-opus-4` → 收到"此模型需 Super 或 topup"
- [ ] Dashboard 显示 `$X.XX` 余额 + 当前 bucket 倒计时
- [ ] 使用历史显示每条 `−$X.XXXX` + 模型 + tokens + 模式
- [ ] Billing 页 3 张套餐卡 + 5 档 topup 都显示 → 点购买 → 跳 Payment stub → 看到客服微信

## Risk & rollback

- **如果验证码邮件发不出去** → 注册全卡。需要监控 + 备用 SMTP
- **如果手动 SQL 出错（发错 bucket）** → 直接 SQL 改回。无 admin UI 意味着错误更容易但也更容易修
- **如果 v1.0 内测发现核心 UX 问题** → 推迟 v1.1 接支付，先迭代 v1.0
- **如果同事接手 v1.1 时间晚于预期** → v1.0 可继续运行，靠手动发 credit 度过
