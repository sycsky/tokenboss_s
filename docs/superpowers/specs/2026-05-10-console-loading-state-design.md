# TokenBoss 加载态统一设计：mono log 风格 + 状态语义独立

**Date:** 2026-05-10
**Status:** Approved (brainstorm), pending implementation plan
**Topic:** 把四个登录后页面（Dashboard / UsageHistory / Settings / OrderStatus）的加载态统一成黑底 mono log 风格的 `<MonoLogLoader />` 组件，并在 Dashboard 上把混在一起的"加载期 / 真零 / 有数据"状态拆成互斥分支。
**Out of scope:** Topup / Payment / Onboard* 等表单页（无并发 fetch loading 态需求，inline button loading 已足够）；Login / Register / VerifyEmail / AdminLogin 等表单页；动效语言全局化（暂不约束公开页 Landing / Pricing）。

## Context

之前 console 的「特别慢」靠 5 个 perf fix 收尾后，加载窗口从 10–20 秒降到 1–2 秒（冷启）。但加载态视觉跟产品语言没对齐：

1. **Dashboard 骨架太空 + 动效不搭**：单块 `bg-accent/30` 橙色矩形 + `animate-pulse`，柔和呼吸跟整套 ink 边 + 4px 硬阴影 + mono 字体的 neo-brutalist 美学不和。
2. **Dashboard 状态语义错乱**：`(usage.totals?.calls ?? 0) === 0` 这一根条件被同时用于"数据正在加载"和"加载完用户真的零调用"，加载期会错误地渲染 "等 Agent 第一笔调用…" 面板。
3. **UsageHistory 加载态裸文字**：`<div>加载中…</div>` 居中文本，毫无品牌语汇，跟 Dashboard 即将做的 mono log 完全不一致。
4. **Settings 根本没 loading 态**：3 个并发 fetch（me / buckets / usage）期间用户看到一闪而过的 0 数字 + "无" 套餐，体感像数据丢了。
5. **OrderStatus 加载态裸 h1**：`加载订单中…` 居中大标题，撑不住"在轮询订单状态"的语义。

设计上的阻力来自一个事实：TokenBoss 的目标用户是 **AI Agent 用户**（OpenClaw / Hermes / Codex / Claude Code 这一群），他们对 mono / terminal 美学有很强的本能亲和。装机咒语 `set up tokenboss.co/skill.md` 已经走了这条路。把所有登录后页面的加载态接进去，是对现有品牌语汇的复用，不是新增。

## Decisions

### 1. 共享组件 `<MonoLogLoader />`

四个页面共用一个组件，调用方按页面差异传 1-3 个 endpoint 标签。视觉一致，行数差异承载页面差异。

**Props：**

```ts
interface MonoLogLoaderProps {
  /** Header 行，默认 "tokenboss · syncing"；OrderStatus 用 "tokenboss · loading order" */
  title?: string;
  /** 每行一个 endpoint 标签。1-3 个；超过 3 个的页面应该重新审视加载架构。 */
  endpoints: string[];
}
```

**视觉规格：**

```
背景      bg-ink (#1C1917)
文字      text-bg (#F7F3EE) for body
          text-bg/55 for header label
          text-bg/40 for gutter ›
强调      text-accent (#E8692A) for spinner
边框      border-2 border-ink rounded-lg
阴影      shadow-[4px_4px_0_0_#1C1917]
内边距    px-6 py-5 (sm:px-7 sm:py-6)
最小高度  min-h-[148px]
```

**结构：**

```
TOKENBOSS · SYNCING                    ← header label, uppercase, tracking-[0.18em], text-[9.5px] bold
› {endpoints[0]} ⠹                     ← line 1
› {endpoints[1]} ⠙                     ← line 2 (if exists)
› {endpoints[2]} ⠼                     ← line 3 (if exists)
```

字体：`font-mono`，正文 `text-[13px] leading-[1.95]`，header `text-[9.5px]` bold + uppercase + tracking-[0.18em]。

**Spinner 动效：** Unicode braille `⠋⠙⠹⠸⠼⠴⠦⠧`，8 帧，每 100ms 步进一帧。每行 spinner 起始 offset 不同（第 i 行 offset = i×3）做 stagger，看起来更有机。不追踪 per-endpoint 完成状态——所有 spinner 同时 spin 直到调用方把组件卸下。

**Spinner 实现：** 内部子组件 + React hook：

```tsx
const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧'];
function Spinner({ offset = 0 }: { offset?: number }) {
  const [i, setI] = useState(offset % FRAMES.length);
  useEffect(() => {
    const id = setInterval(() => setI(p => (p + 1) % FRAMES.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="text-accent">{FRAMES[i]}</span>;
}
```

**可达性：** 顶层加 `aria-busy="true" role="status"` + 视觉隐藏的 `<span className="sr-only">正在加载</span>`，让屏幕阅读器报"正在加载"。

### 2. Dashboard `/console` — 三个互斥状态

| 状态 | 触发条件 | 渲染 |
|---|---|---|
| **A · 加载期** | `hydrating === true` | 仅渲染 `<MonoLogLoader endpoints={['subscription state','usage 30d','api keys']} />`，整页主区其它内容（数据卡 / 最近使用 / 接入侧栏）**完全不渲染** |
| **B · 加载完 + 真零** | `!hydrating && (usage.totals?.calls ?? 0) === 0` | 真实 hero（即使 `$0.0000`）+ 现有的 "等 Agent 第一笔调用…" 面板 |
| **C · 加载完 + 有数据** | `!hydrating && calls > 0` | 现状的完整 dashboard，无变化 |

`hydrating` 的现有语义保持：首屏冷启（无 `dashboardCache.cachedAt`）= true；返回访问（命中前端缓存）= false。返回访问者直接走 stale-while-revalidate，加载态完全不出现。

**结构调整：** 顶层就地三元，**不抽组件函数**（避免 prop 透传 + 闭包风险）。把现有 `<main>` 上的 `lg:grid` class 下沉到内层 `<div>`，hydrating 期连 grid 都不渲染：

```tsx
return (
  <div className="min-h-screen bg-bg pb-12">
    <AppNav current="console" />
    {bannerForUnverified}
    <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5">
      {hydrating ? (
        <MonoLogLoader endpoints={['subscription state', 'usage 30d', 'api keys']} />
      ) : (
        <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
          {/* hero <section> + 主列 <div> + 侧栏 <aside> 全部现状 JSX 原封搬入 */}
        </div>
      )}
    </main>
    {/* modals 保持外层（独立于 hydrating） */}
  </div>
);
```

`hydrating && buckets.length === 0` 的内层组合判断退化成单条件 `hydrating`：因为 `MonoLogLoader` 不依赖 buckets 且加载期下方根本不渲染，"防闪烁 0 余额 hero" 的设计意图被新结构替代。

### 3. UsageHistory `/console/history`

**当前：**

```tsx
if (loading) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center font-mono text-[#A89A8D]">
      加载中…
    </div>
  );
}
```

**改成：**

```tsx
if (loading) {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="history" />
      <main className="max-w-[1340px] mx-auto px-5 sm:px-9 pt-6">
        <MonoLogLoader endpoints={['subscription state', `usage ${dateRange} window`]} />
      </main>
    </div>
  );
}
```

变化：保留 `AppNav` 让返回按钮在加载期可用；把 max-width 容器和 padding 跟非加载态对齐避免布局闪。`endpoints[1]` 用模板字符串带上当前 dateRange（`7d` / `30d`）。

`loading` 现状只在首次 mount 时为 true（`useEffect` 的 `.finally` 后不再 set true），所以切换 dateRange / 翻页不会重新进入加载态——这是有意的现状，本设计不动。

### 4. Settings `/console/account`

**当前：** 没有 loading 态，3 个并发 fetch 时用户看到 0 / null 状态闪过。

**改成：** 加 `loading` state，所有三个 fetch settle 后才放行：

```tsx
const [loading, setLoading] = useState(true);

useEffect(() => {
  Promise.all([
    api.getUsage({}).then((r) => setStats(r.totals)).catch(() => {}),
    api.getBuckets().then((r) => setBucket((r.buckets || []).find((b) => b.skuType.startsWith('plan_')) ?? null)).catch(() => {}),
    api.me().then((r) => {
      setCreatedAt(r.user?.createdAt ?? null);
      setUserId(r.user?.userId ?? null);
    }).catch(() => {}),
  ]).finally(() => setLoading(false));
}, []);

if (loading) {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="account" />
      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        <MonoLogLoader endpoints={['account', 'subscription', 'usage stats']} />
      </main>
    </div>
  );
}
```

每个 fetch 加 `.catch(() => {})` 让单个失败不阻塞全局 loading 翻 false（同 Dashboard 在 commit `a16f15a` 里已采用的 resilience 模式）。

### 5. OrderStatus `/billing/order/:id`

**当前：**

```tsx
if (loading && !order) {
  return (
    <Shell>
      <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-3">
        BILLING · 订单状态
      </div>
      <h1 className="text-[28px] font-bold mb-3">加载订单中…</h1>
    </Shell>
  );
}
```

**改成：**

```tsx
if (loading && !order) {
  return (
    <Shell>
      <MonoLogLoader
        title="tokenboss · loading order"
        endpoints={['order status']}
      />
    </Shell>
  );
}
```

单 endpoint = 单行 + spinner。`Shell` 提供 AppNav + breadcrumb + max-width 容器，结构不动。轮询逻辑（`POLL_INTERVAL_MS` / `POLL_MAX_DURATION_MS`）不在本设计范围——`loading && !order` 仍只在首次拉取时为 true。

### 6. 文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新建 | `frontend/src/components/MonoLogLoader.tsx` | 共享组件 + 内部 `Spinner` 子组件，~50 行 |
| 新建 | `frontend/src/components/__tests__/MonoLogLoader.test.tsx` | 组件测试 |
| 修改 | `frontend/src/screens/Dashboard.tsx` | `<main>` 上的 grid class 下沉到内层 `<div>`，加 `hydrating` 三元，删旧 skeleton `<div>`。**就地修改不抽函数**。约 15 行结构调整，无新逻辑 |
| 修改 | `frontend/src/screens/UsageHistory.tsx` | `loading` fallback 替换为 `<MonoLogLoader />` 块（约 8 行改动） |
| 修改 | `frontend/src/screens/Settings.tsx` | 加 `loading` state；3 个 fetch 用 `Promise.all().finally`；`loading` 时 fallback `<MonoLogLoader />`（约 25 行改动） |
| 修改 | `frontend/src/screens/OrderStatus.tsx` | `loading && !order` 分支替换为 `<MonoLogLoader />`（约 6 行改动） |
| 不动 | `frontend/src/lib/bucketsCache.ts` | 共享缓存逻辑不变 |
| 不动 | `dashboardCache` 模块状态 | 现有 stale-while-revalidate 不变 |

### 7. 边界情况

- **极快返回（< 100ms）**：spinner 只闪一帧。这是好状态。无需做 min-display-time。
- **fetch 全部 reject**：`Promise.all(...).finally` 仍然 fire（因为每个 fetch 有 `.catch` 兜底），加载态撤掉，进入对应"无数据"分支。Dashboard 在 `a16f15a` 已采用此模式；Settings 同步采用。
- **cache 命中（returning visitor）**：Dashboard 的 `dashboardCache.cachedAt` 让 `hydrating` 直接为 false，加载态完全不出现。其它三个页面无 cache，每次 mount 都会经历 1-2s 加载态。
- **键盘可达性**：`MonoLogLoader` 是纯展示性，不接收焦点；`aria-busy="true"` 和 `role="status"` + sr-only 一行 `正在加载` 给屏幕阅读器。
- **暗色模式**：项目当前没有 dark mode，无需考虑。

## Test plan

- 组件单测：`frontend/src/components/__tests__/MonoLogLoader.test.tsx`
  - 渲染 header（默认 "tokenboss · syncing"）
  - 接受 `title` 覆盖
  - 渲染传入的每个 endpoint 标签
  - 包含 8 帧 spinner 字符之一（`⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧`）
  - `aria-busy="true"` 和 `role="status"`
  - sr-only 含"正在加载"
- Dashboard 集成测：`frontend/src/screens/__tests__/Dashboard.test.tsx`（扩展现有文件）
  - `hydrating === true` 时渲染 MonoLogLoader 而不是真实 hero
  - `hydrating === false && calls === 0` 时渲染 noActivity 面板
  - `hydrating === false && calls > 0` 时渲染数据卡数字
- UsageHistory 集成测：`frontend/src/screens/__tests__/UsageHistory.test.tsx`（新建）
  - `loading === true` 时渲染 MonoLogLoader，endpoints 包含 `subscription state` 和 `usage 7d window`
  - dateRange=30d 时第二行变成 `usage 30d window`
  - `loading === false` 时渲染正常表格
- Settings 集成测：`frontend/src/screens/__tests__/Settings.test.tsx`（新建）
  - 三个 fetch 任意一个 reject 不会阻塞 loading 翻 false
  - loading 期渲染 MonoLogLoader，endpoints 含 `account / subscription / usage stats`
- OrderStatus 集成测：`frontend/src/screens/__tests__/OrderStatus.test.tsx`（新建）
  - `loading && !order` 时渲染 MonoLogLoader，title 为 `tokenboss · loading order`
- 手动验证：四个页面冷启都看到 mono log 而非旧 fallback；fast-cache 复访不出现加载态；切 dateRange / 翻页不重新进 loading

## Future work（不在本设计内）

- 把 `Spinner` 抽成项目级共享组件，给 `Payment.tsx` 和 `OnboardSuccess.tsx` 替换 `animate-pulse`（独立小重构）
- 加 per-endpoint ✓ 状态追踪（如果用户反馈想看到这个细节）
- `MonoLogLoader` 加可选 `minDisplayMs` 参数防止极快返回的"闪一下"（如果手动验证发现是问题）
