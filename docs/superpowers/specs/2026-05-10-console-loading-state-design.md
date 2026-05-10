# Console 加载态设计：用 mono log 做骨架，状态语义独立

**Date:** 2026-05-10
**Status:** Approved (brainstorm), pending implementation plan
**Topic:** 把 `/console` 首屏的"加载中"视觉换成黑底 mono log（`tokenboss · syncing`），并把当前混在一起的"加载期 / 真零 / 有数据"三个状态拆成互斥分支。
**Out of scope:** UsageHistory 页（`/console/history`）的加载态；其它非 console 页面的骨架；动效设计语言全局化（暂不约束 Settings / Pricing / Onboard 等页面）。

## Context

之前 console 的「特别慢」靠 5 个 perf fix 收尾后，加载窗口从 10–20 秒降到 1–2 秒（冷启）。但这个 1–2 秒的视觉表现还没跟产品语言对齐：

1. **骨架太空**：当前是单块 `bg-accent/30` 的橙色矩形 + `animate-pulse`，看起来像广告位 / 错误状态，不像"内容快来了"。
2. **`pulse` 动效不搭**：整套 ink 边 + 4px 硬阴影 + mono 字体是 neo-brutalist，柔和呼吸不和。
3. **覆盖范围窄**：骨架只占 hero。下面的「调用 / 已用」数据卡 + "最近使用" 列表 + API Key 区在加载期显示 0 / 空。
4. **状态语义错乱**：`(usage.totals?.calls ?? 0) === 0` 这一根条件被同时用于「数据正在加载（值还是默认 0）」和「数据加载完用户真的零调用」两种语义，所以加载期会错误地渲染 "等 Agent 第一笔调用…" 面板，跟"加载中"信号叠加。

设计上的阻力来自一个事实：TokenBoss 的目标用户是 **AI Agent 用户**（OpenClaw / Hermes / Codex / Claude Code 这一群），他们对 mono / terminal 美学有很强的本能亲和。装机咒语 `set up tokenboss.co/skill.md` 已经走了这条路。把加载态也接进去，是对现有品牌语汇的复用，不是新增。

## Decisions

### 1. 三个互斥状态

| 状态 | 触发条件 | 渲染 |
|---|---|---|
| **A · 加载期** | `hydrating === true` | 仅渲染 `<LoadingHero />`，整页主区其它内容（数据卡 / 最近使用 / 接入侧栏）**完全不渲染** |
| **B · 加载完 + 真零** | `!hydrating && (usage.totals?.calls ?? 0) === 0` | 真实 hero（即使 `$0.0000`）+ 现有的 "等 Agent 第一笔调用…" 面板 |
| **C · 加载完 + 有数据** | `!hydrating && calls > 0` | 现状的完整 dashboard，无变化 |

`hydrating` 的现有语义保持：首屏冷启（无 `dashboardCache.cachedAt`）= true；返回访问（命中前端缓存）= false。返回访问者直接走 stale-while-revalidate，骨架完全不出现。

`AppNav` 和 `UnverifiedEmailBanner` 始终渲染，不被加载期吞掉（它们不依赖 dashboard 数据）。

### 2. `<LoadingHero />` 视觉规格

```
背景      bg-ink (#1C1917)
文字      text-bg (#F7F3EE) for body, text-bg/55 for label, text-bg/40 for gutter ›
强调      text-accent (#E8692A) for spinner
边框      border-2 border-ink rounded-lg
阴影      shadow-[4px_4px_0_0_#1C1917]
内边距    px-6 py-5 (sm:px-7 sm:py-6)
跨列      lg:col-span-2 (占满 hero 原本宽度)
最小高度  min-h-[148px]，比真实 hero 略高，避免 swap 时高度收缩
```

**内容（三行）：**

```
TOKENBOSS · SYNCING                                          ← header label, uppercase, tracking-[0.18em]
› subscription state ⠹                                       ← line 1
› usage 30d ⠙                                                ← line 2
› api keys ⠼                                                 ← line 3
```

字体：`font-mono`，正文 `text-[13px] leading-[1.95]`，header `text-[9.5px]` bold。

**Spinner 动效：** Unicode braille `⠋⠙⠹⠸⠼⠴⠦⠧`，8 帧，每 100ms 步进一帧。三行的 spinner 起始帧 offset 不同（0 / 3 / 6）做 stagger，看起来更有机。

实现选择小型 React hook：

```tsx
function Spinner({ offset = 0 }) {
  const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧'];
  const [i, setI] = useState(offset);
  useEffect(() => {
    const id = setInterval(() => setI(p => (p + 1) % FRAMES.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="text-accent">{FRAMES[i]}</span>;
}
```

三行的 spinner 渲染方式：

```tsx
<Spinner offset={0} />  {/* subscription line */}
<Spinner offset={3} />  {/* usage line */}
<Spinner offset={6} />  {/* api keys line */}
```

不追踪 per-line 完成状态。三行**同时** spin 直到 `hydrating` 翻 false，整块替换。理由：现有 `Promise.all(...).finally(setHydrating(false))` 一次性翻 flag，per-line ✓ 需要拆 4 个 settle 时机各跟一个 state，复杂度收益不值。

### 3. Dashboard.tsx 结构调整

现状：

```tsx
return (
  <div className="min-h-screen bg-bg pb-12">
    <AppNav current="console" />
    {bannerForUnverified}
    <main>
      {hydrating && buckets.length === 0 ? <skeletonDiv /> : <heroSection />}
      {/* 主列：数据卡 + 最近使用 */}
      {/* 侧栏：接入 */}
    </main>
    {/* modals */}
  </div>
);
```

目标：

```tsx
return (
  <div className="min-h-screen bg-bg pb-12">
    <AppNav current="console" />
    {bannerForUnverified}
    <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5">
      {hydrating
        ? <LoadingHero />
        : <DashboardContent ... />
      }
    </main>
    {/* modals 保持在外层（独立于 hydrating，比如未登录态也能展开 ContactSales） */}
  </div>
);
```

`<DashboardContent />` 内部：现有的 `lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6` 包裹 + hero + 主列 + 侧栏，所有现状逻辑（subBucket 分支 / topupBucket / progress bar / 数据卡 / 最近使用 / APIKeyList）原样搬进去，不动。

`hydrating && buckets.length === 0` 这个组合判断退化成单条件 `hydrating`：因为 `LoadingHero` 不依赖 buckets，且 hydrating 期间下方根本不渲染，原本"防止闪烁 0 余额 hero"的设计意图被新结构替代。

### 4. 文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新建 | `frontend/src/components/LoadingHero.tsx` | ~50 行（含 `Spinner` 子组件） |
| 修改 | `frontend/src/screens/Dashboard.tsx` | 顶层加 `hydrating` 三元，主区内容抽到 `<DashboardContent />` 函数（同文件内）。删除现有的 skeleton `<div>`。约 80 行结构调整，无新逻辑 |
| 不动 | `frontend/src/lib/bucketsCache.ts` | 共享缓存逻辑不变 |
| 不动 | `dashboardCache` 模块状态 | 现有 stale-while-revalidate 不变 |

### 5. 边界情况

- **`hydrating === true` 但 fetch 全部 reject**（newapi 全挂）：`Promise.all(...).finally` 仍然 fire，`setHydrating(false)`。LoadingHero 撤掉，进入状态 B 或 C。这是上一个 commit `a16f15a` 已经验证过的：每个 fetch 有独立 `.catch`，不会一直挂在加载态。
- **极快返回（< 100ms）**：spinner 可能只闪一帧。这是合理的——加载非常快本身就是好状态。无需做 min-display-time 兜底。
- **键盘可达性**：LoadingHero 是纯展示性，不接收焦点；可以加 `aria-busy="true"` 和 `role="status"` + visually-hidden 一行 `<span className="sr-only">正在加载</span>` 给屏幕阅读器。
- **暗色模式**：项目当前没有 dark mode，无需考虑。

## Test plan

- 单元测试：`frontend/src/components/__tests__/LoadingHero.test.tsx`
  - 渲染包含 "tokenboss · syncing" header（不区分大小写）
  - 渲染三行 endpoint 标签：`subscription state` / `usage 30d` / `api keys`
  - 包含 8 帧 spinner 字符之一（`⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧`）
  - `aria-busy="true"`
- Dashboard 集成测试：`frontend/src/screens/__tests__/Dashboard.test.tsx`
  - 当 `hydrating` 为 true 时，渲染 LoadingHero 而不是真实 hero
  - 当 `hydrating` 为 false 时，不渲染 LoadingHero
  - 当 `hydrating === false && calls === 0` 时，渲染 noActivity 面板
  - 当 `hydrating === false && calls > 0` 时，渲染数据卡数字
- 手动验证：
  - 线上 / 本地（接通 newapi 后）冷启动 `/console`，应看到三行 mono log 而不是橙色 pulse 块
  - 60 秒内复访：缓存命中，骨架完全不出现，直接出真实 dashboard

## Future work（不在本设计内）

- UsageHistory 页加载态用同款 mono log 风格统一（独立 spec）
- 把 `Spinner` 抽成项目级共享组件，supply 给 `Payment.tsx` 和 `OnboardSuccess.tsx` 替换 `animate-pulse`（独立小重构）
- 加 per-line ✓ 状态追踪，让 spinner 在对应 endpoint settle 时变 ✓（如果用户反馈想看到这个细节，再做）
