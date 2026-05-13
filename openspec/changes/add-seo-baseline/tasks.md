## 1. 准备 / 对齐

- [x] 1.1 跟用户确认：生产域名 = `tokenboss.co`；无官方社交链接，`Organization.sameAs` 省略
- [x] 1.2 选定 OG 封面图：复用 `landing-visitor-final.png`（1200×901，OG 不严格要求 1.91:1，主流平台会 center-crop），落地到 `frontend/public/og-cover.png`
- [x] 1.3 准备 6 张公开页的 title + description 文案（直接写在各自 `useDocumentMeta` 调用里，不抽集中配置——见 design.md D3）

## 2. `useDocumentMeta` hook + 公开页接入

- [x] 2.1 新建 `frontend/src/lib/useDocumentMeta.ts`（30 行整，`useEffect` 同步 title / description / og:* / twitter:*）
- [x] 2.2 `Landing.tsx` 调用接入
- [x] 2.3 `Plans.tsx` 调用接入
- [x] 2.4 `Primitive.tsx` 调用接入
- [x] 2.5 `ManualConfigPC.tsx` 调用接入
- [x] 2.6 `Login.tsx` 调用接入（Register.tsx 是 1 行 `<Navigate>` 别名，跳过）
- [ ] 2.7 本地手动验证：`/` → `/pricing` → `/console` 跳转过程中浏览器 tab 标题切换符合预期 ← 留给用户跑 `pnpm dev` 时确认

## 3. 全局兜底元数据

- [x] 3.1 `frontend/index.html`：title 升级为 Landing 风格的兜底标题，加 `<meta name="description">`
- [x] 3.2 兜底 OG 组（`og:type=website` / `og:url` / `og:title` / `og:description` / `og:image` / `og:site_name`）
- [x] 3.3 Twitter 卡片组（`twitter:card=summary_large_image` / `twitter:title` / `twitter:description` / `twitter:image`）
- [x] 3.4 Organization JSON-LD（`@type=Organization` / `name` / `url` / `logo`，省略 `sameAs`）
- [ ] 3.5 用 LinkedIn Post Inspector / Twitter Card Validator 验证 ← 留给用户在 preview 部署后做

## 4. 爬虫文件

- [x] 4.1 新建 `frontend/public/robots.txt`（按 design 规范，含 `Sitemap:` 行 + 5 条 Disallow）
- [x] 4.2 新建 `frontend/public/sitemap.xml`（4 条公开路由，每条 lastmod=2026-05-09 + changefreq + priority）
- [ ] 4.3 部署后 `curl https://tokenboss.co/robots.txt` 和 `/sitemap.xml` 各跑一次确认 200 ← 留给部署后做
- [ ] 4.4 GSC 提交 sitemap（如果接入了 GSC；没有就 followup）

## 5. 预渲染（spike + 接入） — **DEFERRED**

> 本次范围内**不做**。原因：1-4 已经覆盖 ~80% SEO 收益（会跑 JS 的爬虫看到分页 meta，不跑 JS 的爬虫看到统一兜底卡片不再为空）；预渲染要装 puppeteer / Chromium，重 dep 留给独立 PR。开新 change（如 `add-seo-prerender`）时再做。

- [ ] 5.1 ~~SPIKE：试装 `vite-plugin-prerender`~~ → 拆到独立 change
- [ ] 5.2 ~~接入 vite.config.ts~~ → 同上
- [ ] 5.3 ~~fallback 到 `vite-plugin-ssg`~~ → 同上
- [ ] 5.4 ~~手写预渲染脚本~~ → 同上
- [ ] 5.5 ~~验证 dist/ 下 4 张公开页有静态 HTML~~ → 同上
- [ ] 5.6 ~~`curl -A "LinkedInBot"` 验证~~ → 同上
- [ ] 5.7 ~~SPA fallback 行为验证~~ → 同上

## 6. 收尾

- [x] 6.1 `pnpm build` 跑通：392 modules、429 kB JS / 130 kB gz（基线）；`dist/{robots.txt,sitemap.xml,og-cover.png,index.html}` 全部就位、head meta 正确
- [ ] 6.2 用 [Schema.org Validator](https://validator.schema.org/) 验证 Organization JSON-LD 通过 ← 留给部署后
- [ ] 6.3 PR 描述（含验证截图） ← 留给提 PR 时
- [ ] 6.4 合并后跑 `gstack benchmark`，记录 Lighthouse SEO 基线 ← 留给上线后
