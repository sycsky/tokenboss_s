## ADDED Requirements

### Requirement: 公开页元数据
每一张可被搜索引擎索引的公开页 SHALL 拥有自己独立的 `<title>` 和 `<meta name="description">`，不得共用全站标题。

公开页清单（v1）：
- `/` — Landing
- `/pricing` — 定价
- `/primitive` — Primitive 介绍
- `/install/manual` — 接入手册
- `/login`、`/register` — 登录 / 注册（次要 SEO 价值，但仍需独立元数据避免与 Landing 重复）

#### Scenario: Landing 页加载后 title 被更新
- **WHEN** 用户在浏览器中打开 `/`
- **THEN** `document.title` 反映 Landing 自己的标题（例如 `TokenBoss · 你的 Agent 立刻用得起好模型`）
- **AND** `<meta name="description">` 元素存在且内容为 Landing 描述

#### Scenario: 切换路由后 meta 同步更新
- **WHEN** 用户从 `/` 通过 SPA 路由跳转到 `/pricing`
- **THEN** `document.title` 更新为 `/pricing` 的标题
- **AND** `<meta name="description">` 的 `content` 更新为 `/pricing` 的描述

#### Scenario: 离开有自定义 meta 的路由
- **WHEN** 用户从 `/pricing` 跳转到没有显式调用 `useDocumentMeta` 的路由（例如 `/console`）
- **THEN** title 和 description 回退到 `index.html` 中的全局兜底值，避免「上一页的 title 滞留」

---

### Requirement: 全局兜底元数据
`frontend/index.html` SHALL 在 `<head>` 内包含一组兜底的 `<title>`、`<meta name="description">`、Open Graph 标签（`og:title`、`og:description`、`og:image`、`og:url`、`og:type`）和 Twitter 卡片标签（`twitter:card`、`twitter:title`、`twitter:description`、`twitter:image`），用于：
- 没有调用 `useDocumentMeta` 的路由
- JS 未执行时社交平台爬虫的预览抓取

#### Scenario: 不会执行 JS 的爬虫抓取任意路由
- **WHEN** 一个不会执行 JavaScript 的爬虫（例如 LinkedIn 或微信）请求 `/` 或 `/pricing`
- **THEN** 返回的 HTML 在 `<head>` 中包含完整的 OG 和 Twitter 卡片标签
- **AND** 卡片预览能正常渲染出 TokenBoss 的标题、描述和图片

#### Scenario: 预渲染失败导致回落到 SPA 模板
- **WHEN** 某个公开路由因为预渲染插件出错没有被静态化、回落到 `index.html`
- **THEN** 该路由仍然带着兜底的 OG / Twitter / Organization JSON-LD，社交分享不退化为裸链接

---

### Requirement: 结构化数据
`frontend/index.html` SHALL 在 `<head>` 中包含一段 `<script type="application/ld+json">`，描述 `Organization` schema（`@type: Organization`、`name`、`url`、`logo`），用于让搜索引擎识别 TokenBoss 这家公司。

#### Scenario: 搜索引擎读取 JSON-LD
- **WHEN** 任意爬虫抓取任何路由的 HTML
- **THEN** `<head>` 中存在合法的 `application/ld+json` 脚本块
- **AND** JSON 内容通过 schema.org 校验（必填字段齐全、类型为 Organization）

---

### Requirement: 爬虫文件
`frontend/public/` 目录下 SHALL 存在 `robots.txt` 和 `sitemap.xml` 两个静态文件，部署后可在 `https://<domain>/robots.txt` 和 `https://<domain>/sitemap.xml` 直接访问。

`robots.txt` 必须：
- `Allow: /`
- 显式 `Disallow: /console`、`Disallow: /billing`、`Disallow: /onboard`、`Disallow: /verify-email`
- 包含 `Sitemap: https://<canonical-domain>/sitemap.xml` 行

`sitemap.xml` 必须：
- 列出所有 v1 公开路由（`/`、`/pricing`、`/primitive`、`/install/manual`、`/login`、`/register`）
- 每条记录包含 `<loc>` 和 `<lastmod>`
- 使用 sitemaps.org 0.9 schema

#### Scenario: 爬虫请求 robots.txt
- **WHEN** Googlebot 请求 `https://<domain>/robots.txt`
- **THEN** 返回 200 + `text/plain`
- **AND** 内容包含 `Disallow: /console` 和 `Sitemap:` 行

#### Scenario: 爬虫请求 sitemap.xml
- **WHEN** Googlebot 请求 `https://<domain>/sitemap.xml`
- **THEN** 返回 200 + `application/xml`
- **AND** 包含至少 4 条 v1 公开路由的 `<url>` 节点
- **AND** 不包含登录后路由

---

### Requirement: 公开页预渲染
构建产物 `frontend/dist/` SHALL 为以下 4 条路由生成各自的静态 HTML 文件，文件中 `<head>` 已经包含该路由的 title / description / OG / Twitter 标签，`<body>` 已经包含该路由首屏的 HTML 内容：
- `/` → `dist/index.html`（覆盖 SPA 兜底）
- `/pricing` → `dist/pricing/index.html`
- `/primitive` → `dist/primitive/index.html`
- `/install/manual` → `dist/install/manual/index.html`

未预渲染的路由 SHALL 继续走 Vercel SPA fallback 到 `dist/index.html`，行为与改动前一致。

#### Scenario: 用 curl 抓取预渲染过的路由
- **WHEN** 用 `curl -A "LinkedInBot"` 请求 `https://<domain>/pricing`
- **THEN** 返回的 HTML 在 `<title>` 标签里是 `/pricing` 的标题
- **AND** `<body>` 中含有定价相关的可读文本（不是空 `<div id="root">`）

#### Scenario: 登录后路由继续走 SPA
- **WHEN** 浏览器请求 `/console`
- **THEN** Vercel 返回的 HTML 仍然是 SPA 兜底 `index.html`
- **AND** 客户端 JS 接管渲染，行为与本次改动前一致

#### Scenario: 预渲染时遭遇运行时错误
- **WHEN** 构建过程中某条路由的预渲染抛错（例如组件依赖 `window`）
- **THEN** 构建失败并打印出错路由 + 错误堆栈
- **AND** 不会静默地把空 HTML 写进 `dist/`
