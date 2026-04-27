# TokenBoss Design System

**Last update:** 2026-04-27
**Owner:** ypz06130@gmail.com
**Status:** v1 — locked from the Slock-pixel iteration on Landing + Primitive

This is the single-source-of-truth styling reference for **all** TokenBoss
screens. When auditing or designing a new page, conform to this. When you
deviate, justify in the PR description.

---

## 1 · Core philosophy

The brand voice is **"indie Bauhaus stamping"** — a deliberate move away
from the polite-editorial-SaaS look. Three principles:

1. **Hard edges, no softness.** 2px ink borders + 3-4px hard offset
   shadows. No blur shadows. No soft elevation.
2. **Color blocks punctuate.** Each section earns a color band; the eye
   resets when bg changes. Cream is the default, terracotta is the
   accent, ink is the close.
3. **One letter, one shape, one promise.** The favicon is one letter
   (`T`) in a square. The logo is one wordmark in a tilted plate. The
   manifesto is one sentence. Compress.

We borrow Slock's **structure** (single-page scroll, manifesto color
band, raised buttons) but use our own palette (terracotta, not yellow).

---

## 2 · Color tokens

All colors live in `frontend/tailwind.config.js`. Never hardcode hex —
always use semantic class names.

### Light theme (default)

| Token | Hex | Use |
|---|---|---|
| `bg-bg` | `#F7F3EE` | Page background. Warm cream. |
| `bg-bg-alt` | `#F0EBE3` | Subtle bg shift, e.g. chip bg. |
| `bg-surface` | `#FFFFFF` | Cards on bg, modal bodies. |
| `bg-surface-warm` | `#FDF9F5` | Featured tier cards (warmer than surface). |
| `border-hairline` | `#EBE3DA` | Section dividers, soft separators. |
| `border-border-2` | `#D9CEC2` | Form input borders, secondary panels. |
| `text-ink` | `#1C1917` | Primary text. Headlines, body. |
| `text-text-secondary` | `#6B5E52` | Body copy on dark surfaces. |
| `text-ink-3` | `#A89A8D` | Muted text, mono labels. |
| `text-ink-4` | `#D9CEC2` | Dividers in mono lines. |

### Brand accent

| Token | Hex | Use |
|---|---|---|
| `bg-accent` | `#E8692A` | Terracotta — primary CTA fills, manifesto band, brand plate. |
| `bg-accent-hover` | `#D4581D` | Old: hover state. Slock-pixel buttons don't use this anymore. |
| `bg-accent-deep` | `#B85020` | Gradient pair with `accent`. |
| `bg-accent-soft` | `#FEE9DC` | Tag pills, leverage chips. |
| `bg-accent-light` | `#FFF4EE` | Soft tinted card bg (Feature Card 01). |

### Dark theme (used by `/primitive`)

| Token | Hex | Use |
|---|---|---|
| `bg-ink` | `#1C1917` | Primary dark surface (Primitive page, footer). |
| `bg-[#0A0807]` | `#0A0807` | Even-darker surface (terminal demo bg). |
| `bg-[#1C1917]` | (same as ink) | Terminal panel inner bg. |
| `bg-white/5..10` | white at low alpha | Glass-style chips on dark. |
| Emerald `#34D399` | (Tailwind) | Primitive page accent — neon dot, PRIMITIVES chip, gradient text. Use **only** on /primitive. Never on Wallet pages. |
| Cyan `#5EEAD4` | (Tailwind) | Gradient pair with emerald (PRODUCTIVE., Primitives.). |

---

## 3 · Typography

### Font stack

```js
sans:  '"DM Sans", "Noto Sans SC", sans-serif'  // body + headings
mono:  '"Geist Mono", ui-monospace, monospace'  // labels, terminals, code
serif: '"Noto Serif SC", serif'                 // rarely; emphasis only
```

### Scale

| Class | Size | Use |
|---|---|---|
| `text-[44px] md:text-[64px] lg:text-[72px]` | 44/64/72 | Hero h1 (`你的 Agent 钱包`) |
| `text-[80px] md:text-[120px] lg:text-[140px]` | 80/120/140 | Primitive page h1 (`Primitives.`) |
| `text-[26px] md:text-[40px] lg:text-[44px]` | 26/40/44 | Manifesto band h2 |
| `text-[28px] md:text-[40px]` | 28/40 | Section h2 (`只解决一件事 — ...`) |
| `text-[34px] md:text-[52px]` | 34/52 | Final CTA h2 (`现在试试？`) |
| `text-[18px] md:text-[20px]` | 18/20 | Card titles (Feature, Tier) |
| `text-[15px]` | 15 | Body copy (default size in this system) |
| `text-[13.5px]` | 13.5 | Card body, fine print |
| `text-[13px]` | 13 | Nav links, footer links |
| `font-mono text-[10.5px] tracking-[0.16em] uppercase` | 10.5 | **Editorial mono labels** — section eyebrows, footer col headers, manifesto eyebrow. This is the workhorse small-text style. |
| `font-mono text-[8.5px] tracking-[0.14em] uppercase` | 8.5 | Chip subtitles inside equations (`AUTONOMOUS SYSTEM`). |

### Weights

- `font-extrabold` (900) — h1, h2, manifesto, outcome words
- `font-bold` (700) — card titles, button text, brand wordmark
- `font-semibold` (600) — featured-card name, mono labels
- `font-medium` (500) — nav links inactive
- regular (400) — body

---

## 4 · The Slock-pixel signature

Every interactive surface uses the same construction:

```
border:    2px solid ink     (#1C1917)
shadow:    3px 3px 0 0 ink   (or 4px 4px on cards)
radius:    rounded-md (6px)  for buttons / chips
           rounded-md (6px)  for cards
           rounded-[5px]     for the BrandPlate
hover:     translate(1px, 1px) + shadow shrinks to 1px 1px
active:    translate(2px, 2px) + shadow disappears (0 0)
```

The "depress on press" animation is the brand's signature interaction.

### Reference snippet — `slockBtn(variant)`

```ts
const base =
  'inline-block border-2 border-ink rounded-md font-bold tracking-tight ' +
  'px-5 py-2.5 md:px-6 md:py-3 text-[14px] md:text-[15px] ' +
  'shadow-[3px_3px_0_0_#1C1917] ' +
  'hover:translate-x-[1px] hover:translate-y-[1px] ' +
  'hover:shadow-[1px_1px_0_0_#1C1917] ' +
  'active:translate-x-[2px] active:translate-y-[2px] ' +
  'active:shadow-[0_0_0_0_#1C1917] ' +
  'transition-all whitespace-nowrap';

primary:   `${base} bg-accent text-white`
dark:      `${base} bg-ink text-white`
secondary: `${base} bg-bg text-ink`
```

**Rule:** Never use a `dark`-variant button immediately above the dark
footer — they merge. Use `secondary` (cream) on terracotta bands.

### Reference snippet — Feature card

```html
<div class="bg-[tinted] rounded-md p-6 md:p-7
            border-2 border-ink shadow-[4px_4px_0_0_#1C1917]">
  <p class="font-mono text-[10.5px] font-bold tracking-[0.16em]
            uppercase text-ink-3 mb-4">01</p>
  <h3 class="text-[18px] md:text-[20px] font-bold tracking-tight
             mb-2.5 leading-tight">{title}</h3>
  <p class="text-[13.5px] text-text-secondary leading-relaxed">{body}</p>
</div>
```

Tinted bg options for feature cards:
`bg-[#FFF4E6]` (warm cream) · `bg-[#F0EBE3]` (neutral cream) · `bg-[#EAF1ED]` (sage cream).
Avoid pure-bg or pure-surface — the tint is part of the rhythm.

---

## 5 · Component catalog

| Component | Path | Notes |
|---|---|---|
| `<BrandPlate dark? />` | `components/TopNav.tsx` | The tilted "TokenBoss" logo plate. Used in nav + footer. Pass `dark` for white-on-dark variant. |
| `<TopNav current? theme? />` | `components/TopNav.tsx` | 3-zone nav: logo left · Wallet/Primitives toggle center · 套餐+登录 right. `current="home" \| "primitive"` highlights active center pill. `theme="dark"` swaps to white-on-ink. On `current="primitive"`, right-side links hide entirely. |
| `<CompatRow />` | `components/CompatRow.tsx` | The agent-logo row in hero. After the 2026-04-27 audit, holds **only OpenClaw + Hermes Agent** — Codex / Claude Code are dev CLIs and were dropped. |
| `<TerminalBlock cmd size? />` | `components/TerminalBlock.tsx` | Dark `$ command` chip with COPY button. Used for the install prompt. |
| `<TierCard ... />` | `components/TierCard.tsx` | Pricing tile. 2px ink border + 3px hard shadow. Featured card uses `bg-surface-warm` and 4px shadow. CTA inside uses Slock-pixel button styling matching `ctaVariant: 'primary' \| 'secondary' \| 'disabled'`. |
| `<SectionHeader num cn en />` | `components/SectionHeader.tsx` | Editorial section eyebrow: `01 / 套餐 / MEMBERSHIP`. Mono uppercase. |
| `<FeatureCard tag title body accentBg />` | inline in `Landing.tsx` | The Slock-style 3-card row. |
| `<FooterCol label links />` | inline in `Landing.tsx` | Mono uppercase column header + link list. |
| `slockBtn(variant)` | inline in `Landing.tsx` | The button class generator. Should probably be promoted to its own helper file when we audit Login + Dashboard. |

---

## 6 · Layout patterns

### Single-page Landing flow

```
Hero (cream)            ── product pitch + install command + primary CTA
↓
Manifesto (terracotta)  ── full-bleed color band + one big sentence
↓
Features (cream)        ── 3 tinted cards · "WHAT MAKES X DIFFERENT"
↓
Pricing (cream)         ── id="pricing" anchor target · TierCard grid + 按量充值
↓
Final CTA (terracotta)  ── full-bleed · last-chance register button
↓
Footer (ink dark)       ── 3 cols · brand intro + Product + Developers
```

Color rhythm: cream → terracotta → cream → cream → terracotta → ink.
Two terracotta bands act as bookends; they're the only non-cream content
zones except the footer.

### Page-level rules

- Container: `max-w-[1200px] mx-auto px-6 md:px-14`
- Section vertical rhythm: `py-12 md:py-16` (default), `py-20 md:py-28` (manifesto/features), `py-20 md:py-24` (final CTA)
- Color bands (manifesto, final CTA) are **full-bleed** — escape the
  `max-w-[1200px]` container so the bg color hits the viewport edges.
- Inner content of color bands stays in `max-w-[1100px]` (slightly tighter than the cream sections) for density.

### Smooth-scroll anchors

`html { scroll-behavior: smooth; }` is set globally with a
`prefers-reduced-motion` opt-out. Use `<a href="/#pricing">` for in-page
anchors — works both same-page (smooth scroll) and cross-page (full nav
+ scroll-to-anchor on load).

---

## 7 · Voice & copy

The user is not a developer poking at API keys. They use AI agents to
**solve real-world problems and create value**. Two filters when writing
copy:

- **Make it purposeful** → does this sentence answer "what do I get?"
  (not "what do you do?")
- **Make it personal** → would a real person say this? Not "we provide
  multi-agent compatibility" but "换 Agent 不用换钱包".

### The brand sentence

> **你专心创造，剩下交给我们。**

This shows up in three places (Hero subtitle, Manifesto, Footer brand
intro), each phrased slightly differently. They echo each other; that's
intentional rhythm.

### Voice rules

| Don't | Do |
|---|---|
| List specific model names ("Claude · GPT · Codex") | Talk in outcomes ("立刻用得起顶级模型") |
| Describe mechanism ("智能路由 · 多端复用 · API key 多端共享") | Describe outcome ("自动选最便宜可用模型") |
| Use jargon ("dual-currency billing") | Use action ("¥ 付，$ 算") |
| Position us ("我们是中转站") | Position user ("你专心创造") |
| Mix Chinese product names with English ones | Pick one register and stick |
| Call dev CLIs "agents" | Reserve "Agent" for true agent products (OpenClaw, Hermes Agent) |
| Use 原语 in body copy | Use **Primitives** (English) — 原语 doesn't read across audiences |

### CTA copy ladder

- Primary funnel CTA (visitor): **`免费开始 · 送 $10 体验`** or **`免费开始 →`**
- Visitor on tier card: **`免费开始 →`**
- Logged-in on tier card: **`联系客服购买`** (no self-checkout in v1)
- Sold-out tier (logged-in Ultra): **`名额已满`**
- Standard rate (logged-in): **`联系客服充值`**
- Hero (logged-in): **`去控制台 →`**
- Top nav (logged-in): **`控制台`**

### Page tagline (footer)

> 你专心创造，剩下交给我们。

(Drop the older "Made with care for AI agents." — it talked to the
machines, not the humans.)

---

## 8 · Iconography & brand mark

### Favicon

- 32×32 SVG, terracotta `#E8692A` fill, ink stroke 2.5px, radius 5px
- Single white letter `T` in Geist Mono 600, font-size 18, letter-spacing -0.5
- Centered at y=23 (visual center compensating for descender)
- Path: `frontend/public/favicon.svg`

### BrandPlate (top-of-page logo)

- Same terracotta fill + 2px ink border + 2px hard ink shadow
- Tilted -2.5° by default, hovers to upright
- Wordmark: full "TokenBoss" in Geist-stack, font-extrabold, 14px
- Always wrapped in `<Link to="/">`
- Dark theme: white border + white shadow (only the chrome inverts; bg stays terracotta)

### Active nav state

- Active link gets a solid pill: light-theme `bg-ink text-bg`, dark-theme `bg-white text-ink`
- Inactive: `text-ink-2 hover:text-ink` (light) or `text-white/65 hover:text-white` (dark)
- Use this on Wallet ↔ Primitives toggle. **Do not** rely on color shift alone for active states — too subtle.

---

## 9 · Animation library

### Hero terminal demo

- 6s typing + 4-step install loop · CSS keyframes only · respects `prefers-reduced-motion`
- Header swap (HERMES AGENT ↔ OPENCLAW) on a 12s loop synced with two body cycles
- Located in `Landing.tsx` `<HeroTerminalDemo>` + inline `<style>` block

### Industry marquee (Primitives page)

- 30s linear infinite horizontal scroll
- Track is duplicated 2x for seamless loop (`translateX(0) → translateX(-50%)`)
- Edge fade masks (`bg-gradient-to-r from-bg to-transparent` on left/right) hide the loop seam

### Status pulse (Coming Soon dot)

- `<span class="absolute inset-0 rounded-full bg-[#34D399] animate-ping opacity-75" />`
  on a `relative` static dot
- Tailwind's `animate-ping` is acceptable here

### Hover/depress on Slock-pixel buttons

```css
hover:  translate(1px, 1px), shadow shrinks 3→1
active: translate(2px, 2px), shadow becomes 0
```

Always `transition-all` (default duration 150ms).

---

## 10 · Dark variant (`/primitive`)

The Primitives page is the **only** dark page in v1. Its visual
language differs from the rest of the site by design — it signals
"this is the future / coming soon" zone.

| Aspect | Light (Wallet) | Dark (Primitive) |
|---|---|---|
| Bg | `bg-bg` `#F7F3EE` | `bg-[#0A0807]` |
| Text | `text-ink` | `text-white` |
| Accent | `bg-accent` (terracotta) | Emerald `#34D399` + cyan `#5EEAD4` gradient |
| Background pattern | None | Dotted radial grid `opacity-[0.18]` |
| Brand mark border | ink | white |
| Nav active pill | ink/bg | white/ink |
| Status indicator | — | pulsing emerald dot |

Don't introduce emerald/cyan on Wallet pages, and don't introduce
terracotta-as-accent (vs as-CTA-fill) on Primitives pages.

---

## 11 · Anti-patterns (do not do)

- ❌ Soft shadows (`shadow-lg`, `shadow-xl`) — use only the hard 3-4px offset shadow
- ❌ Rounded-2xl / rounded-3xl on cards — stick to `rounded-md`
- ❌ Multi-color CTA stacks (orange + blue + green buttons on one screen)
- ❌ Listing model brand names (Claude / GPT / Codex) in body copy
- ❌ Calling /pricing from primary nav — pricing is a `#pricing` anchor on home
- ❌ Hidden orange `免费开始` button in top-right (we removed it; conversion is the hero CTA)
- ❌ Bottom border under the top nav (`<nav>` has no border in this system)
- ❌ Generic "Sign in" / "Sign up" split (we merged 注册 into 登录)
- ❌ Fake testimonials / fake logos / fake stats — we have none and won't fabricate
- ❌ Pixel art / cute mascots in hero — Slock can; we charge real money
- ❌ Using "Made with X" / "Made for X" taglines — the audit removed them
- ❌ Talking to the user as a developer ("API key 多端共享") — talk to the user as a value-creator ("一个 key 多个 Agent 共用")

---

## 12 · Auditing checklist

When auditing an existing screen against this system:

1. **Nav** — Does it use `<TopNav />`? Pass `current` correctly?
2. **Logo** — `<BrandPlate />` (not the old TB chip + plain wordmark)?
3. **Buttons** — Slock-pixel style (2px ink border + 3px hard shadow + depress hover)? Right `slockBtn(variant)`?
4. **Borders** — `border-2 border-ink` on cards (not `border` or `border-hairline`)?
5. **Shadows** — `shadow-[3px_3px_0_0_#1C1917]` (not `shadow-warm` or Tailwind defaults)?
6. **Color band** — If the page has a manifesto / final-CTA moment, is it a full-bleed color section?
7. **Copy** — Outcome-first? Personal voice? No model-name lists?
8. **Active state** — Solid pill on the nav for the current page?
9. **Footer** — `<BrandPlate dark />` + 3-col grid + ink bg?
10. **Favicon** — `index.html` references `/favicon.svg`?

---

## 13 · Status palette + primitives

Added 2026-04-27 after a Slock-pixel audit. The principle borrowed from
Slock isn't "more color" — it's that **multiple utility colors can share
the same 2px-ink + hard-offset frame**, so a viewer reads "what kind"
from color and "where it lives" from frame. We adopt the frame; we keep
our terracotta-led palette and reserve these utility tones for **status
metadata only** (pills, type badges, avatar blocks). Never use them as
primary brand color.

### Status color palette

| Token | Hex | Use |
|---|---|---|
| `bg-lime-stamp` / `text-lime-stamp-ink` | `#A3E635` / `#365314` | Verified, Current Plan, Active state — the "this is good / this is on" tone |
| `bg-cyan-stamp` / `text-cyan-stamp-ink` | `#67E8F9` / `#155E75` | In-progress, processing, info — neutral-positive |
| `bg-yellow-stamp` / `text-yellow-stamp-ink` | `#FACC15` / `#713F12` | Trial, attention, warning — needs eyes (don't confuse with brand terracotta CTA) |
| `bg-lavender` / `text-lavender-ink` | `#C4B5FD` / `#4C1D95` | User avatars, paid-tier highlight (Plus / Super), neutral identity |

The existing `green-soft / green-ink` and `accent-soft / accent-ink`
pairs are still the **ink-on-cream** family — use them for soft pills on
white cards. The new `*-stamp` family is the **ink-on-saturated** family
— use it when the pill itself should pop, e.g. `IN PROGRESS` floating
on a task card, `VERIFIED` next to an email.

### StatusPill (primitive)

```html
<span class="font-mono text-[9.5px] font-bold tracking-[0.14em] uppercase
             border-2 border-ink rounded px-1.5 py-0.5
             bg-lime-stamp text-lime-stamp-ink">
  已验证
</span>
```

- `font-mono`, `tracking-[0.14em]`, `uppercase`. **Always.**
- 2px ink border, no shadow.
- Bg from the status palette, ink-text counterpart for legibility.
- Padding stays tight (`px-1.5 py-0.5`) — pills are not buttons.

### TabPill (primitive)

The active/inactive tab toggle pattern — `控制台 · 套餐 · 账户`,
`ACCOUNT · BROWSER · SERVER`, etc.

```
active:    bg-ink text-bg + 2px ink + 3px hard offset
inactive:  bg-bg text-ink + 2px ink + 3px hard offset
```

Both states keep the frame. Color flip alone is the hierarchy. **Don't**
remove the border on inactive tabs — it breaks the "all tabs are pills"
read.

### AvatarBlock (primitive)

A solid-color square with the user's initial in mono. Replaces every
gradient-circle avatar.

```html
<span class="w-9 h-9 bg-lavender border-2 border-ink rounded
             font-mono font-bold text-ink flex items-center justify-center">
  S
</span>
```

- Always **square** (`rounded` = small 4px radius, never `rounded-full`).
- Color comes from the status palette: `lavender` is the default user
  block; `accent` for owner/admin; `lime-stamp` for agents/automated;
  `bg-bg` (cream) for unset.
- An optional 8px green dot at bottom-right indicates "online".

### Plan card pattern (Slock-pixel pricing)

Used in `Plans.tsx` and the in-app plans grid. Replaces the older
`border-hairline rounded-xl` soft cards.

```
default tier:    bg-surface       + 2px ink + 3px hard shadow
featured tier:   bg-surface-warm  + 2px ink + 4px hard shadow + accent CTA
current tier:    bg-bg            + 3px ink frame + lime-stamp full-width CTA reading "当前套餐"
coming soon:     bg-bg            + 2px dashed ink + opacity-60 + disabled CTA "敬请期待"
```

- Crossed-out old limits + **bold "Unlimited (limited time)"** is the
  rhetorical move from Slock — earn it by actually offering more.
- The CTA always sits **at the bottom of the card** as a full-width
  block, not inline — that's what gives the grid its row-aligned rhythm.

### Modal pattern

Modals follow the same hard-edge construction:

```
overlay:   bg-ink/60
panel:     bg-surface + 2px ink + 4px hard offset shadow + rounded-md
header:    mono uppercase title (e.g. "EDIT CHANNEL") + small × close pill
footer:    Cancel (secondary) / Save (primary) / [Destructive] (red)
           — destructive actions sit on a separator below primary actions,
             not crammed inline
```

A destructive action never sits next to a Cancel button — it gets its
own row, with a visible hairline separator above it. Slock does this
well; we adopt it.

---

## 14 · Open questions / future iterations

- **Login / Register flow** — needs Slock-pixel pass. Currently uses raw form inputs without our 2px-border treatment. Audit pending.
- **Dashboard** — same. The post-login surface should still feel like the same brand. Audit pending.
- **Pricing page (`/pricing`, Plans.tsx)** — partially updated; the standalone hero (`用 ¥ 付，按 $ 算`) is older and not yet aligned with the manifesto voice.
- **Onboarding (`/onboard/*`)** — not yet audited.
- **Form input style** — we don't yet have a "Slock-pixel input field" pattern. Likely needs `border-2 border-ink rounded-md focus:shadow-[3px_3px_0_0_#1C1917]`.
- **Toast / banner** — undefined. Probably the same hard-edge treatment.
- **Promote `slockBtn` to its own component file** when we start using it across screens.

These are the audit targets for the next iteration. After Login + Dashboard are done, revisit this doc and stamp v2.
