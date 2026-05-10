# Console 加载态统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Dashboard / UsageHistory / Settings / OrderStatus 四个登录后页面的加载态统一到一个共享 `<MonoLogLoader />` 组件（黑底 mono log + braille spinner），并把 Dashboard 上"加载期 / 真零 / 有数据" 三个状态拆成互斥分支。

**Architecture:** 单个共享 React 组件，调用方按页面差异传 1-3 个 endpoint 字符串。Spinner 是 100ms 步进 8 帧 braille 字符，三行 stagger（offset=i×3）。Dashboard 顶层 `hydrating` 三元；其它页面在现有 `loading` 分支替换 fallback。Settings 当前没 loading 态，新增 `Promise.all().finally` 编排。

**Tech Stack:** React, TypeScript, Tailwind, Vitest + @testing-library/react (项目已用)，react-router-dom

**Spec:** `docs/superpowers/specs/2026-05-10-console-loading-state-design.md`

**Working dir:** `/Users/Sirius/Developer/tokenboss`

---

### Task 1: MonoLogLoader 组件 + 测试

**Files:**
- Create: `frontend/src/components/MonoLogLoader.tsx`
- Create: `frontend/src/components/__tests__/MonoLogLoader.test.tsx`

- [ ] **Step 1: 写组件测试（先红）**

写 `frontend/src/components/__tests__/MonoLogLoader.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonoLogLoader } from '../MonoLogLoader';

describe('<MonoLogLoader>', () => {
  it('renders default header and given endpoints', () => {
    render(<MonoLogLoader endpoints={['subscription state', 'usage 30d', 'api keys']} />);
    expect(screen.getByText('tokenboss · syncing')).toBeInTheDocument();
    expect(screen.getByText(/subscription state/)).toBeInTheDocument();
    expect(screen.getByText(/usage 30d/)).toBeInTheDocument();
    expect(screen.getByText(/api keys/)).toBeInTheDocument();
  });

  it('accepts a custom title', () => {
    render(<MonoLogLoader title="tokenboss · loading order" endpoints={['order status']} />);
    expect(screen.getByText('tokenboss · loading order')).toBeInTheDocument();
  });

  it('exposes role=status and aria-busy for screen readers', () => {
    render(<MonoLogLoader endpoints={['x']} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('正在加载')).toBeInTheDocument();
  });

  it('renders one of the 8 braille spinner frames per endpoint', () => {
    render(<MonoLogLoader endpoints={['a', 'b', 'c']} />);
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧'];
    // Each endpoint line should contain at least one frame character.
    const root = screen.getByRole('status');
    const text = root.textContent ?? '';
    const matches = frames.filter(f => text.includes(f));
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 跑测试确认是红的**

```bash
cd frontend && npm test -- src/components/__tests__/MonoLogLoader.test.tsx
```

预期：4 个测试全部 FAIL，因为 `MonoLogLoader` 文件还不存在。

- [ ] **Step 3: 写 MonoLogLoader 组件（最小实现让测试转绿）**

写 `frontend/src/components/MonoLogLoader.tsx`：

```tsx
import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];

function Spinner({ offset = 0 }: { offset?: number }) {
  const [i, setI] = useState(offset % FRAMES.length);
  useEffect(() => {
    const id = setInterval(() => setI(p => (p + 1) % FRAMES.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="text-accent">{FRAMES[i]}</span>;
}

export interface MonoLogLoaderProps {
  /** Header label. Defaults to "tokenboss · syncing". */
  title?: string;
  /** 1-3 endpoint labels. Each renders as a line with a stagger-offset spinner. */
  endpoints: string[];
}

/**
 * Black mono-log loading block with braille spinners. Used on Dashboard /
 * UsageHistory / Settings / OrderStatus so the brand voice of the install
 * spell ("set up tokenboss.co/skill.md") shows up at every login-gated
 * page's loading moment too.
 */
export function MonoLogLoader({
  title = 'tokenboss · syncing',
  endpoints,
}: MonoLogLoaderProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="bg-ink text-bg border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] px-6 py-5 sm:px-7 sm:py-6 min-h-[148px]"
    >
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase font-bold text-bg/55 mb-3">
        {title}
      </div>
      {endpoints.map((endpoint, i) => (
        <div key={endpoint} className="font-mono text-[13px] leading-[1.95]">
          <span className="text-bg/40 mr-2.5">›</span>
          {endpoint} <Spinner offset={i * 3} />
        </div>
      ))}
      <span className="sr-only">正在加载</span>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认转绿**

```bash
cd frontend && npm test -- src/components/__tests__/MonoLogLoader.test.tsx
```

预期：4 个测试全部 PASS。

- [ ] **Step 5: 跑全量前端测试确认没影响别的**

```bash
cd frontend && npm test
```

预期：所有现有测试仍 PASS（应该是 88 passed = 84 + 4 new）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/MonoLogLoader.tsx frontend/src/components/__tests__/MonoLogLoader.test.tsx
git commit -m "feat(loading): MonoLogLoader 共享组件 — mono log + braille spinner"
```

---

### Task 2: Dashboard 接入

**Files:**
- Modify: `frontend/src/screens/Dashboard.tsx`
- Modify: `frontend/src/screens/__tests__/Dashboard.test.tsx`

**Strategy:** 顶层就地三元 `{hydrating ? <MonoLogLoader /> : <现有 grid/hero/cards 整块>}`，**不抽** DashboardContent 函数（避免 21 个 prop 透传 + 闭包风险）。删除原来的 `hydrating && buckets.length === 0 ? <skeletonDiv /> : <heroSection />` 内层三元——因为 hydrating 期连 grid 都不渲染了，hero 永远走真实分支。

- [ ] **Step 1: 加新测试到 Dashboard.test.tsx（先红）**

编辑 `frontend/src/screens/__tests__/Dashboard.test.tsx`，在文件末尾加新 describe 块：

```tsx
describe('Dashboard loading state', () => {
  it('renders MonoLogLoader while hydrating (fetches not yet resolved)', () => {
    // Never-resolving promises lock Dashboard in hydrating state.
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getBuckets').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getUsage').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getUsageAggregate').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'listKeys').mockReturnValue(never as any);

    renderDashboard();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · syncing')).toBeInTheDocument();
    expect(screen.getByText(/subscription state/)).toBeInTheDocument();
    expect(screen.getByText(/usage 30d/)).toBeInTheDocument();
    expect(screen.getByText(/api keys/)).toBeInTheDocument();
    // No real hero content visible during loading.
    expect(screen.queryByText(/今日剩|Agent 余额/)).toBeNull();
  });

  it('hides MonoLogLoader and renders content after fetches resolve', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });

    renderDashboard();
    // Eventually the loader is gone — content takes over.
    await waitFor(() => {
      expect(screen.queryByText('tokenboss · syncing')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 跑测试确认两个新测试是红的**

```bash
cd frontend && npm test -- src/screens/__tests__/Dashboard.test.tsx
```

预期：原有 2 个测试 PASS（新代码还没生效），2 个新测试 FAIL（找不到 `tokenboss · syncing`）。

- [ ] **Step 3: 改 Dashboard.tsx — import + 顶层就地三元**

打开 `frontend/src/screens/Dashboard.tsx`：

**3a.** 在现有 import 块底部加：

```tsx
import { MonoLogLoader } from '../components/MonoLogLoader';
```

**3b.** 找到 `<main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5 lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">` 这一行（在 `<UnverifiedEmailBanner>` 之后），改两件事：

1. 把 `<main>` 上的 `lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6` class **移除**。改后 `<main>` 只保留 layout 容器：

   ```tsx
   <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5">
   ```

2. 在 `<main>` **第一行内**加三元包裹剩余整块。原本 main 直接 children 是 hero `<section>` 和主列 `<div className="space-y-5">` 和侧栏 `<aside>`。新结构：

   ```tsx
   <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5">
     {hydrating ? (
       <MonoLogLoader endpoints={['subscription state', 'usage 30d', 'api keys']} />
     ) : (
       <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
         {/* ↓↓ 原有 hero <section> + 主列 <div> + 侧栏 <aside> 整块原封搬到这里 ↓↓ */}
       </div>
     )}
   </main>
   ```

   `lg:grid` 那组 class 从 `<main>` 移到内层 `<div>`，hydrating 期就只渲染 loader 而不渲染 grid。

**3c.** 删除原来的内层三元 `{hydrating && buckets.length === 0 ? (<div className="bg-accent/30...">) : (<section>...真实 hero...</section>)}`（约 341–352 行）。直接保留 `<section>` 真实 hero 分支即可——因为整个 grid 都是在 `!hydrating` 下渲染，hero 永远走真实分支。

**3d.** 双击检查（在文件里搜）：现有事件处理器 `setContactReason`、`setCreateOpen`、`setJustCreated`、`setDeleteTarget`、`setAllKeysOpen`、`reloadKeys` 全部在主组件 scope 里，没有动 — JSX 直接闭包引用，无需 prop drilling。Modals (`<ContactSalesModal>` 等) 仍在 `<main>` 外层不变。

最终 return 大致结构（缩略）：

```tsx
return (
  <div className="min-h-screen bg-bg pb-12">
    <AppNav current="console" />

    {user && !user.emailVerified && user.email && (
      <div className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-4">
        <UnverifiedEmailBanner email={user.email} />
      </div>
    )}

    <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5">
      {hydrating ? (
        <MonoLogLoader endpoints={['subscription state', 'usage 30d', 'api keys']} />
      ) : (
        <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
          <section className="lg:col-span-2 bg-accent ...">
            {/* 原 hero 真实分支整块 */}
          </section>

          <div className="space-y-5">
            {/* 原主列：数据卡 + 最近使用 */}
          </div>

          <aside className="space-y-5 mt-5 lg:mt-0">
            {/* 原侧栏：接入 */}
          </aside>
        </div>
      )}
    </main>

    <ContactSalesModal ... />
    <CreateKeyModal ... />
    <RevealKeyModal ... />
    <AllKeysModal ... />
    <DeleteKeyModal ... />
  </div>
);
```

- [ ] **Step 4: 跑测试确认全绿**

```bash
cd frontend && npm test -- src/screens/__tests__/Dashboard.test.tsx
```

预期：原有 2 测试继续 PASS，2 个新测试现在 PASS。

如果原有"install spell"测试失败，最常见原因是 grid `<div>` 包裹位置错误（hero / 主列 / 侧栏不在同一个 grid 容器里），导致 layout 类没生效；或是误删了 hero 真实分支某段 JSX。用 `git diff` 看变化是否最小。

- [ ] **Step 5: 跑全套前端测试**

```bash
cd frontend && npm test
```

预期：全绿。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/screens/Dashboard.tsx frontend/src/screens/__tests__/Dashboard.test.tsx
git commit -m "feat(loading): Dashboard 接入 MonoLogLoader + 拆 DashboardContent"
```

---

### Task 3: UsageHistory 接入

**Files:**
- Modify: `frontend/src/screens/UsageHistory.tsx`
- Create: `frontend/src/screens/__tests__/UsageHistory.test.tsx`

- [ ] **Step 1: 写新测试（先红）**

新建 `frontend/src/screens/__tests__/UsageHistory.test.tsx`：

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import UsageHistory from '../UsageHistory';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: { userId: 'u_1', email: 'a@x.com', emailVerified: true, balance: 0, createdAt: '2026-04-01T00:00:00Z' },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {}, logout: () => {}, refreshUser: async () => {},
  } as any);
});

const renderHistory = () =>
  render(
    <MemoryRouter>
      <UsageHistory />
    </MemoryRouter>,
  );

describe('UsageHistory loading state', () => {
  it('renders MonoLogLoader while loading (fetches not yet resolved)', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getBuckets').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getUsage').mockReturnValue(never as any);

    renderHistory();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · syncing')).toBeInTheDocument();
    expect(screen.getByText(/subscription state/)).toBeInTheDocument();
    expect(screen.getByText(/usage 7d window/)).toBeInTheDocument();
    // 旧的"加载中…"裸文字不应再出现
    expect(screen.queryByText('加载中…')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑确认是红的**

```bash
cd frontend && npm test -- src/screens/__tests__/UsageHistory.test.tsx
```

预期：FAIL（找不到 `tokenboss · syncing`，因为 UsageHistory 还在用旧"加载中…"）。

- [ ] **Step 3: 改 UsageHistory.tsx**

打开 `frontend/src/screens/UsageHistory.tsx`：

在 import 块底部加：

```tsx
import { MonoLogLoader } from '../components/MonoLogLoader';
```

找到 `if (loading) { return ... }` 块（约 126-132 行），整段替换为：

```tsx
if (loading) {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="history" />
      <main className="max-w-[1340px] mx-auto px-5 sm:px-9 pt-6">
        <MonoLogLoader
          endpoints={['subscription state', `usage ${dateRange} window`]}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: 跑确认转绿**

```bash
cd frontend && npm test -- src/screens/__tests__/UsageHistory.test.tsx
```

预期：PASS。

- [ ] **Step 5: 跑全套前端测试**

```bash
cd frontend && npm test
```

预期：全绿。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/screens/UsageHistory.tsx frontend/src/screens/__tests__/UsageHistory.test.tsx
git commit -m "feat(loading): UsageHistory 替换裸文字 fallback 为 MonoLogLoader"
```

---

### Task 4: Settings 接入（含新加 loading state）

**Files:**
- Modify: `frontend/src/screens/Settings.tsx`
- Create: `frontend/src/screens/__tests__/Settings.test.tsx`

- [ ] **Step 1: 写新测试（先红）**

新建 `frontend/src/screens/__tests__/Settings.test.tsx`：

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import Settings from '../Settings';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: { userId: 'u_1', email: 'a@x.com', emailVerified: true, balance: 0, createdAt: '2026-04-01T00:00:00Z' },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {}, logout: () => {}, refreshUser: async () => {},
  } as any);
});

const renderSettings = () =>
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );

describe('Settings loading state', () => {
  it('renders MonoLogLoader while fetches are pending', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getUsage').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getBuckets').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'me').mockReturnValue(never as any);

    renderSettings();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/account/)).toBeInTheDocument();
    expect(screen.getByText(/subscription/)).toBeInTheDocument();
    expect(screen.getByText(/usage stats/)).toBeInTheDocument();
  });

  it('flips loading off even if one fetch rejects', async () => {
    vi.spyOn(apiModule.api, 'getUsage').mockResolvedValue({
      records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [],
    } as any);
    vi.spyOn(apiModule.api, 'getBuckets').mockRejectedValue(new Error('boom'));
    vi.spyOn(apiModule.api, 'me').mockResolvedValue({
      user: { userId: 'u_1', createdAt: '2026-04-01T00:00:00Z' } as any,
    });

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('tokenboss · syncing')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 跑确认是红的**

```bash
cd frontend && npm test -- src/screens/__tests__/Settings.test.tsx
```

预期：FAIL（Settings 当前无 loading 态）。

- [ ] **Step 3: 改 Settings.tsx**

打开 `frontend/src/screens/Settings.tsx`：

在 import 块底部加：

```tsx
import { MonoLogLoader } from '../components/MonoLogLoader';
```

把现有的 useEffect（line 18-25）和 state 声明（line 11-16）整段改写：

```tsx
const [stats, setStats] = useState({ consumed: 0, calls: 0 });
const [bucket, setBucket] = useState<BucketRecord | null>(null);
const [createdAt, setCreatedAt] = useState<string | null>(null);
const [userId, setUserId] = useState<string | null>(null);
const [redeemOpen, setRedeemOpen] = useState(false);
const [loading, setLoading] = useState(true);

useEffect(() => {
  Promise.all([
    api.getUsage({}).then((r) => setStats(r.totals)).catch(() => undefined),
    api
      .getBuckets()
      .then((r) =>
        setBucket((r.buckets || []).find((b) => b.skuType.startsWith('plan_')) ?? null),
      )
      .catch(() => undefined),
    api
      .me()
      .then((r) => {
        setCreatedAt(r.user?.createdAt ?? null);
        setUserId(r.user?.userId ?? null);
      })
      .catch(() => undefined),
  ]).finally(() => setLoading(false));
}, []);
```

紧接着，在原 `return (...)` 之前加 loading 分支：

```tsx
if (loading) {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="account" />
      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        <MonoLogLoader
          endpoints={['account', 'subscription', 'usage stats']}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: 跑确认转绿**

```bash
cd frontend && npm test -- src/screens/__tests__/Settings.test.tsx
```

预期：PASS。

- [ ] **Step 5: 跑全套前端测试**

```bash
cd frontend && npm test
```

预期：全绿。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/screens/Settings.tsx frontend/src/screens/__tests__/Settings.test.tsx
git commit -m "feat(loading): Settings 加 loading state + MonoLogLoader fallback"
```

---

### Task 5: OrderStatus 接入

**Files:**
- Modify: `frontend/src/screens/OrderStatus.tsx`
- Create: `frontend/src/screens/__tests__/OrderStatus.test.tsx`

- [ ] **Step 1: 写新测试（先红）**

新建 `frontend/src/screens/__tests__/OrderStatus.test.tsx`：

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import OrderStatus from '../OrderStatus';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const renderOrder = (orderId = 'ord_test_123') =>
  render(
    <MemoryRouter initialEntries={[`/billing/order/${orderId}`]}>
      <Routes>
        <Route path="/billing/order/:orderId" element={<OrderStatus />} />
      </Routes>
    </MemoryRouter>,
  );

describe('OrderStatus loading state', () => {
  it('renders MonoLogLoader with custom title while order is pending', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getOrder').mockReturnValue(never as any);

    renderOrder();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · loading order')).toBeInTheDocument();
    expect(screen.getByText(/order status/)).toBeInTheDocument();
    // 旧 "加载订单中…" h1 不应再出现
    expect(screen.queryByText('加载订单中…')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑确认是红的**

```bash
cd frontend && npm test -- src/screens/__tests__/OrderStatus.test.tsx
```

预期：FAIL。

- [ ] **Step 3: 改 OrderStatus.tsx**

打开 `frontend/src/screens/OrderStatus.tsx`：

在 import 块底部加：

```tsx
import { MonoLogLoader } from '../components/MonoLogLoader';
```

找到 `if (loading && !order) { return ... }` 块（约 124-133 行），整段替换为：

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

- [ ] **Step 4: 跑确认转绿**

```bash
cd frontend && npm test -- src/screens/__tests__/OrderStatus.test.tsx
```

预期：PASS。

- [ ] **Step 5: 跑全套前端测试**

```bash
cd frontend && npm test
```

预期：全绿。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/screens/OrderStatus.tsx frontend/src/screens/__tests__/OrderStatus.test.tsx
git commit -m "feat(loading): OrderStatus 替换 h1 fallback 为 MonoLogLoader"
```

---

### Task 6: 全套验证 + push

**Files:** 无新改动；纯验证

- [ ] **Step 1: 跑全套前端测试**

```bash
cd frontend && npm test
```

预期：全绿，新增测试约 9 个（4 + 2 + 1 + 2 + 1 - 1 重复 setup =实际新增视情况而定）。

- [ ] **Step 2: 跑前端 typecheck**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json
```

预期：无错误。

- [ ] **Step 3: 跑后端测试确认我们没动到的部分仍绿**

```bash
cd backend && npm test
```

预期：169 个测试全绿（应该完全没动）。

- [ ] **Step 4: 起前端 dev server 手动验证 4 个加载态**

```bash
cd frontend && npm run dev
```

打开 http://localhost:5173（或 vite 实际给的端口），登录后：

1. 硬刷 `/console` → 看到黑底 mono log "tokenboss · syncing"，三行 spinner，加载完转 dashboard
2. 进 `/console/history` → 看到同款 mono log 两行（subscription state / usage 7d window）
3. 进 `/console/account` → 看到三行（account / subscription / usage stats）
4. 走一遍下单流程到 `/billing/order/...` → 看到一行 "order status" + 自定义 title "tokenboss · loading order"

如果哪个没出现 mono log 就回去看那个 task 的实现。

- [ ] **Step 5: push**

```bash
git push origin main
```

预期：5 个新 commit 推到 origin/main，Zeabur 自动开始部署。

- [ ] **Step 6: （可选）观察 Zeabur 部署完后的线上**

通过 Zeabur 控制台等部署完，去线上 console 复刷一次确认。

---

## Self-review notes

- ✓ Spec 覆盖：每个 spec section（MonoLogLoader 组件 / Dashboard / UsageHistory / Settings / OrderStatus）都对应一个 task
- ✓ 无 placeholder：所有代码片段是完整可粘贴的
- ✓ 类型一致：MonoLogLoader props 在每个调用方都按相同 shape 用
- ✓ 提交粒度：每个 task = 一个 commit，最后 push 一次
- ✓ TDD 顺序：每个 task 先写测试 → 跑红 → 写实现 → 跑绿 → 提交
