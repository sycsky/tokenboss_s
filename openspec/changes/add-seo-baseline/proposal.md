## Why

前端是纯 SPA（Vite + React + React Router），`index.html` 全站只有一个写死的 `<title>TokenBoss</title>`、没有 meta description、没有 OG / Twitter 卡片、没有 sitemap、没有 robots、没有结构化数据。不会执行 JS 的爬虫（Bing 部分场景、LinkedIn、Twitter、微信、飞书等）只看到一个空 `<div id="root">`；分享出去的链接是裸 URL，没有卡片预览。

这一刀下去，公开页（`/`、`/pricing`、`/primitive`、`/install/manual`）从「搜索引擎几乎不可见 + 社交平台分享无预览」变成「可被搜索 + 分享有完整卡片」。

## What Changes

- 新增 `frontend/public/robots.txt`，明确放行公开路由、屏蔽 `/console`、`/billing`、`/onboard`、`/verify-email`
- 新增 `frontend/public/sitemap.xml`，登记 4 张公开页（手写静态文件，v1 不做动态生成）
- `frontend/index.html` 注入兜底的 OG / Twitter 卡片元数据 + `Organization` JSON-LD
- 新增 `useDocumentMeta(title, description, og?)` hook（不引入 `react-helmet-async`，自己写一个 ~30 行的轻量实现，符合「在现有代码基础上迭代」原则）
- 给 4 张公开页（`Landing`、`Pricing`、`Primitive`、`InstallManual` 以及 `Login`、`Register`）接上各自的 title + description
- 引入 `vite-plugin-prerender` 之类工具，构建时把 4 张公开页生成为静态 HTML，登录后页面继续走 SPA
- 验证：本地 `pnpm build` 后检查生成的静态 HTML，并用 `gstack` 模拟无 JS 爬虫看渲染效果

不在本次范围：
- ~~i18n / hreflang~~（跟整体多语言策略绑在一起，单独立项）
- ~~迁移到 Next.js / Astro~~（v2 再说）
- ~~动态 sitemap~~（v1 路由有限，手写更省事）

## Capabilities

### New Capabilities
- `seo-meta`: 公开页的 SEO 元数据规范——每张公开页都有独立 title/description；HTML 层面有兜底 OG/Twitter/JSON-LD；爬虫文件（robots.txt + sitemap.xml）齐全；4 张目标公开页在构建时被预渲染成静态 HTML

### Modified Capabilities

（无现有 spec 受影响——`openspec/specs/` 为空）

## Impact

**新增依赖**
- `vite-plugin-prerender`（或评估后选定的同类插件，见 design.md）

**改动文件**
- `frontend/index.html` — 加 meta 兜底 + JSON-LD
- `frontend/public/robots.txt`（新建）
- `frontend/public/sitemap.xml`（新建）
- `frontend/vite.config.ts` — 接入预渲染插件
- `frontend/src/lib/useDocumentMeta.ts`（新建）
- `frontend/src/screens/Landing.tsx`、`Pricing.tsx`、`Primitive.tsx`、`InstallManual.tsx`、`Login.tsx`、`Register.tsx` — 调用 `useDocumentMeta`

**不影响**
- 后端 API
- 登录后路由（`/console`、`/billing/*`、`/onboard/*`）的渲染方式
- 现有路由结构 / URL

**风险**
- 预渲染插件对 React 18 + React Router 6 的兼容性需要先验证；如果选定的插件有坑，回退方案是「只做 1-5（meta + 文件 + JSON-LD），暂不预渲染」——SEO 上限会低一档但不阻塞其他价值
- 预渲染会改变 `dist/` 的产物结构，需要确认 Vercel SPA fallback 仍然兼容（已有页面走静态 HTML，未预渲染路由继续 fallback 到 `index.html`）
