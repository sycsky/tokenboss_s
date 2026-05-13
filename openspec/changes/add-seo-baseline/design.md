## Context

前端栈：Vite 5 + React 18 + React Router 6，纯 CSR。`vercel.json` 把所有路由 fallback 到 `index.html`。`frontend/index.html:16` 写死 `<title>TokenBoss</title>`，公开路由 8 条但只有 4 条真正有 SEO 价值（landing / pricing / primitive / install/manual）；剩下的 `/login`、`/register`、`/verify-email`、`/login/magic` 是次要登入门户。

之前在 `/opsx:explore` 阶段评估过四条路（A 维持 SPA 贴 meta、B 选页预渲染、C 整体迁 Next.js、D 写自定义 SSR），用户选定 **B**：投入小、上限够高、不动现有架构。

约束 / 偏好（来自 memory）：
- 「在现有代码基础上迭代，不另起炉灶」——不引入大库，能自己写就自己写
- 「less is more」——v1 不做动态 sitemap、不做 i18n hreflang、不上结构化数据全套
- 目标用户是 AI Agent 使用者，公开页主要给「先了解再装」的人类用户看 + 让搜索 / 分享有体面入口

## Goals / Non-Goals

**Goals**
- 4 张公开页 build 时生成各自的静态 HTML，head 里已经填好 title / description / OG / Twitter
- 不会跑 JS 的爬虫（LinkedIn / Twitter / 微信 / 飞书）抓任意路由都能拿到完整卡片
- 给 React 端补一个轻量 hook，让 SPA 路由切换时 title / description 跟着更新
- robots.txt + sitemap.xml 齐全
- 上 Organization JSON-LD（一段，10 行）
- 改动尽量收口在 `frontend/`，不动后端、不动路由结构

**Non-Goals**
- 不上 `react-helmet-async`（重，自己写一个 30 行 hook 就够）
- 不做动态 sitemap（4 条静态 URL，手写更省事）
- 不做 i18n / hreflang（跟整体多语言策略一起处理，单独立项）
- 不迁 Next.js / Astro（v2 再说）
- 不做 FAQPage / Product / BreadcrumbList 等更多 schema（一个 Organization 够 v1）
- 不动登录后路由（`/console`、`/billing/*`、`/onboard/*`）

## Decisions

### D1: 用 `vite-plugin-prerender` 还是别的预渲染方案？

**选定：`vite-plugin-prerender`（基于 Puppeteer）**——但要先做一次兼容性 spike。

候选对比：

| 方案 | 工作方式 | 适合 React Router 6 | 风险 |
|------|---------|---------------------|------|
| **vite-plugin-prerender**（puppeteer） | 起 headless Chrome，跑路由抓 HTML | ✅ 直接抓真实渲染 | 构建变重、需要装 Chromium |
| **vite-plugin-ssg** | 编译期跑 React renderToString | ✅ 但要给 RouterProvider 套个 server entry | 需要拆 client/server entry |
| **`react-snap`** | 老牌，puppeteer 派 | ⚠️ Vite 兼容性参差 | 维护活跃度一般 |
| **手写脚本** | 起 dev server + curl 4 个 URL 存 HTML | ✅ 完全可控 | 自己处理 hydration 标记、~半天工作量 |

**先验证 `vite-plugin-prerender`**（最快），如果它对当前栈不兼容（特别是 React Router 6 的某些 hooks 在 puppeteer 里 throw），fallback 到 `vite-plugin-ssg`。这两个都跑通不了，再考虑手写脚本。

**为什么不直接选 SSG**：SSG 要拆 client / server entry，对现在这个项目（一切从 `main.tsx` 起手）侵入更大。puppeteer 派的好处是「黑盒抓最终 HTML」，对应用代码零侵入。

### D2: 不引入 react-helmet-async，自己写 `useDocumentMeta`

```ts
// frontend/src/lib/useDocumentMeta.ts （目标形态，不在本文件实现）
export function useDocumentMeta(opts: {
  title: string;
  description: string;
  og?: { title?: string; description?: string; image?: string };
}): void {
  useEffect(() => {
    document.title = opts.title;
    setMeta('name', 'description', opts.description);
    setMeta('property', 'og:title', opts.og?.title ?? opts.title);
    setMeta('property', 'og:description', opts.og?.description ?? opts.description);
    if (opts.og?.image) setMeta('property', 'og:image', opts.og.image);
    setMeta('name', 'twitter:title', opts.og?.title ?? opts.title);
    setMeta('name', 'twitter:description', opts.og?.description ?? opts.description);
  }, [opts.title, opts.description, opts.og?.title, opts.og?.description, opts.og?.image]);
}
```

**理由**：
- react-helmet-async 解决的两个问题（嵌套合并、SSR 同步）我们都不需要——我们是 SPA，单页只有一个 meta 调用方
- 30 行能搞定的事不要拖一个依赖进来
- 符合「在现有代码基础上迭代」原则

**不回退 meta 的妥协**：hook 卸载时不主动清理（避免「从 /pricing 跳到 /console，title 短暂闪回 TokenBoss」的体验抖动）。每个公开路由都自己调用 `useDocumentMeta`，互相覆盖；登录后路由不调，title 保留为最后一次设置的值——这在 SPA 里是常见做法，且爬虫不受影响（爬虫看的是预渲染产物）。

### D3: meta 文案的来源：路由内 hardcode，不抽配置文件

每个公开页组件里直接写自己的 title / description 字符串。

**为什么不抽到 `seo.config.ts` 集中管理**：
- v1 阶段只有 4-6 张页面，集中化的边际收益低
- 内容跟页面强绑定，写在组件里 grep 更直接
- 将来如果要做 i18n，反正都得改写法，现在抽出去等于白干

### D4: sitemap 静态写死

```xml
<!-- frontend/public/sitemap.xml （示例形态） -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://tokenboss.co/</loc><lastmod>2026-05-09</lastmod></url>
  <url><loc>https://tokenboss.co/pricing</loc><lastmod>2026-05-09</lastmod></url>
  <!-- ... -->
</urlset>
```

公开路由就这 4-6 条，手写比生成简单。每次新增路由顺手更新 sitemap，进 PR review 单的检查项。

**域名硬编码 `tokenboss.co`**：从 `EMAIL_FROM` 默认值（`backend/src/lib/emailService.ts`）和 newapi 业务能推出这是生产域名。如果有 staging / preview 部署，preview 的 sitemap 不被搜索引擎索引（preview 一般有 `noindex` 头或非公开域名），不需要单独处理。

### D5: OG image 用现有截图还是新设计？

选 **现有截图**：复用 `landing-loggedin-final.png` 或类似，丢到 `frontend/public/og-cover.png`，1200×630。

**理由**：v1 不为这个单独做设计稿；现有截图能用就用，将来要换在 `index.html` 改一行就行。

### D6: 「弱 SEO 价值的页面」要不要预渲染？

`/login`、`/register`、`/verify-email` 这几个：
- **预渲染** ✓ —— 本来就得有独立 title 防 SERP 重复，顺手生成静态 HTML
- 但它们**不写入 sitemap**（用户不会从 Google 搜「登录」过来）

`/login/magic`、`/onboard/*`、`/console`、`/billing/*` 全部不预渲染、不进 sitemap、`robots.txt` 显式 disallow。

## Risks / Trade-offs

**[R1] vite-plugin-prerender 跟 React Router 6 不兼容**
→ 缓解：开工第一步先做 spike，验证不通过就切 SSG / 手写脚本。即便预渲染整套都跑不起来，meta + sitemap + robots + JSON-LD（D2-D5）已经独立可交付，SEO 上限会低一档但不阻塞。

**[R2] 预渲染产物把 Vercel SPA fallback 行为改坏**
→ 缓解：`vercel.json` 的 `rewrites` 是「文件不存在时 fallback」，预渲染只新增静态文件不删任何东西，行为应当兼容。验证步骤：`pnpm build` 后用 `vercel dev` 本地起一遍，curl 测 `/console` 仍走 SPA fallback。

**[R3] hydration 错配**
预渲染的 HTML 和 React 接管时的 DOM 不一致 → React 18 在 dev 会 warn、prod 会强制重渲染（不崩但白闪一下）。
→ 缓解：组件里不用 `Date.now()` / `Math.random()` / 浏览器 API 之类有副作用的初始 state；如果有就 wrap `useEffect`。spike 阶段先扫一遍 4 张页面的代码确认。

**[R4] OG 图被 CDN 缓存住改不掉**
→ 缓解：图片文件名加哈希或日期后缀（例如 `og-cover-2026q2.png`），换图就换文件名。

**[R5] robots.txt 写错把生产页全屏蔽**
→ 缓解：上线前用 `curl https://<domain>/robots.txt` 双确认；用 [Google Search Console robots tester](https://www.google.com/webmasters/tools/robots-testing-tool) 测 `/`、`/pricing` 应当 allowed、`/console` 应当 disallowed。

**[R6] 自己写的 `useDocumentMeta` 在快速 SPA 跳转时 meta 短暂错位**
→ 缓解：useEffect 同步执行 `document.title = ...`，比异步抓取快得多；爬虫看到的是预渲染产物，受影响的只有真实用户的浏览器 tab 标签——可接受。

## Migration Plan

**部署顺序**（每一步都能独立部署、独立回滚）：
1. 加 `useDocumentMeta` hook + 给 4-6 张公开页接上调用 → 部署 → 验证浏览器 tab title 正确
2. 加 `index.html` 兜底 OG / Twitter / JSON-LD → 部署 → 用 LinkedIn Post Inspector / Twitter Card Validator 看卡片
3. 加 `robots.txt` + `sitemap.xml` → 部署 → curl 验证 + Google Search Console 提交 sitemap
4. 接入预渲染插件 → 部署 → curl `-A "LinkedInBot"` 测 4 张公开页 HTML 已含完整 head + body

**回滚**：每步都是独立文件 / 配置变更，回滚只需 `git revert` 对应 commit。预渲染步骤如果出问题，删掉插件配置 + 回到普通 vite build 即可——其他三步的成果保留。

## Open Questions

（已全部确认）

- ~~Q1: 是否在 sitemap 里包含 `/login` `/register`？~~ → **不加**。sitemap 只列 4 张真正有 SEO 价值的公开页：`/`、`/pricing`、`/primitive`、`/install/manual`。
- ~~Q2: 生产域名~~ → **`tokenboss.co`**。robots.txt 的 `Sitemap:` 行、sitemap.xml 的 `<loc>`、`og:url` 兜底全部用这个域名。
- ~~Q3: `Organization.sameAs`？~~ → **暂无社交链接，`sameAs` 字段省略**。将来有了官方 GitHub / Twitter / 飞书再补。
