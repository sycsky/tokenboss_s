/**
 * `/install/manual` — gh-3 rewrite.
 *
 * After Task 6 extracted RECIPES + helpers into their own modules, this
 * screen is now a thin composition of 4 gh-3 components:
 *
 *   1. Hero        — h1 + CCSwitchDetector card
 *   2. Main        — KeyInjectionFlow (auth-branch: LoggedIn vs Anon)
 *   3. Footer      — ProtocolFamilyLinks (3 protocol-family doc cards)
 *   4. Disclosure  — AdvancedManualRecipes (the legacy 4-recipe deep-dive,
 *                    folded behind a `<details>` collapsed by default)
 *
 * The previous layout (sticky TOC + multi-section spell-fallback page,
 * `useActiveSection` hook, `Step` helper) is fully removed — the CC
 * Switch one-click flow handles ~95% of users in 5 seconds; everything
 * the old layout used to surface lives behind the disclosure.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §1–§2
 */

import { AppNav, Breadcrumb } from '../components/AppNav';
import { CCSwitchDetector } from '../components/CCSwitchDetector';
import { KeyInjectionFlow } from '../components/KeyInjectionFlow';
import { ProtocolFamilyLinks } from '../components/ProtocolFamilyLinks';
import { AdvancedManualRecipes } from '../components/AdvancedManualRecipes';
import { useDocumentMeta } from '../lib/useDocumentMeta';

export default function ManualConfigPC() {
  useDocumentMeta({
    title: '一键导入 TokenBoss · 配置教程 | TokenBoss',
    description:
      '一键把 TokenBoss 接进 OpenClaw / Hermes / Codex / OpenCode / Claude Code 五大 Agent CLI。',
    ogImage: 'https://tokenboss.co/og-cover.png',
  });

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav />
      <main className="max-w-4xl mx-auto px-5 sm:px-9 pt-6">
        <Breadcrumb items={[{ label: '控制台', to: '/console' }, { label: '配置教程' }]} />

        {/* Hero — sets context (what page, what tool) above the steps. */}
        <header className="mt-2">
          <h1 className="text-[32px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-3">
            一键把 TokenBoss 接进你的 Agent CLI
          </h1>
          <p className="text-[14px] text-text-secondary leading-relaxed max-w-[640px]">
            通过 CC Switch 桌面应用一键导入，免去手动改配置文件。
            两步走 — Step 1 装 CC Switch · Step 2 选你的 CLI。
          </p>
        </header>

        {/* Step 1 — install CC Switch desktop app */}
        <section className="mt-7">
          <CCSwitchDetector />
        </section>

        {/* Step 2 — per-agent grid + key injection (auth-branch). */}
        <section className="mt-8">
          <KeyInjectionFlow />
        </section>

        {/* Footer — deeper protocol docs for the long tail. */}
        <section className="mt-12">
          <h2 className="text-[18px] font-bold mb-4">延伸阅读 · 协议族文档</h2>
          <ProtocolFamilyLinks />
        </section>

        {/* Advanced disclosure — legacy per-Agent recipe cards, hidden by
            default. Power users editing config files by hand can still
            grab the exact templates. */}
        <section className="mt-12 pt-6 border-t-2 border-ink/10">
          <AdvancedManualRecipes />
        </section>
      </main>
    </div>
  );
}
