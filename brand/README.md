# TokenBoss brand assets

静态素材，不进构建产物。应用内的 logo 仍由代码渲染，这里是给 README / slides / 外部投放用的导出版本。

| 文件 | 用途 |
|---|---|
| `tokenboss-wordmark.svg` | 文字 logo，紧贴轮廓无留白，自包含（DM Sans 800 已内嵌为 base64），410×177 |
| `tokenboss-wordmark-256/512/1024.png` | 文字 logo 居中放进方形画布，透明底。牌子占画布宽 65%，留出安全区，后台方形裁剪框切不到 |
| `tokenboss-icon-512.png` | 方形图标（T mark），透明底，RGBA |
| `tokenboss-icon-1024.png` | 同上，用于 app icon / OG image |

方形槽位（支付宝商家 logo、app icon、头像）优先用 `icon-*`：wordmark 是 2.3:1 的横图，塞进方形后上下空一大块，字会显得很小。

## Source of truth

素材是从代码里的两处 logo 导出的，改动以代码为准：

- 图标 — `frontend/public/favicon.svg`
- 文字 — `frontend/src/components/TopNav.tsx`（`Logo` 组件的 plate div）

## Design tokens

```
accent  #E8692A     ink      #1C1917     纸底  #F0EBE3
边框     2px ink     硬阴影    2px 2px 0 ink
圆角     5px         倾斜      -2.5°（hover 回正）
字体     wordmark: DM Sans 800, tracking -0.025em
        icon:     Geist Mono 600
```

## 已知偏差

`TopNav.tsx` 用 `font-extrabold`（800），但 `frontend/index.html` 的 Google Fonts 只加载到 `wght@700`，所以**线上渲染的是浏览器合成的伪粗体**。本目录的 SVG 内嵌了真正的 DM Sans 800，字形略窄、更利落。要让两者一致，把 index.html 字体链接的 `DM+Sans:wght@400;500;600;700` 补上 `;800`。
