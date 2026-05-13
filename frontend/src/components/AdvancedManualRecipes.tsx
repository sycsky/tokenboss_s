/**
 * Disclosure wrapper that hides the legacy 4-recipe long-form
 * configuration deep-dive behind a single "高级 · 手动配置 (旧版)"
 * `<details>` toggle.
 *
 * The CC Switch one-click flow (PrimaryImportButton / AnonKeyPasteInput)
 * handles ~95% of users in 5 seconds. The remaining 5% — power users
 * editing config files by hand, or anyone whose env CC Switch doesn't
 * support — drops down into this disclosure for the per-Agent recipe
 * cards we used to lead with.
 *
 * Helper sub-components (RecipeCard / RecipeStepView / CodeBlock) live
 * in this file rather than separate modules because they're tightly
 * coupled to the recipe data shape and aren't reused elsewhere. Total
 * file size stays well under 400 LOC.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2
 */

import { useState } from "react";

import {
  RECIPES,
  cardClass,
  codeBlockClass,
  type AgentRecipe,
  type RecipeStep,
} from "./AdvancedManualRecipesData";

export function AdvancedManualRecipes() {
  return (
    <details className="group/advanced">
      <summary
        className={[
          "flex items-center justify-between gap-3 px-5 py-4 cursor-pointer list-none",
          "border-2 border-ink rounded-md bg-white",
          "shadow-[3px_3px_0_0_#1C1917] hover:bg-bg-alt/40",
          "transition-colors",
        ].join(" ")}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3 font-bold mb-1">
            高级 · 手动配置
          </div>
          <div className="text-[14px] font-bold text-ink">
            CC Switch 用不了？按 Agent 抄配置
          </div>
          <div className="font-mono text-[11.5px] text-ink-3 mt-1">
            OpenClaw · Hermes · Codex · 其他 OpenAI 兼容 — 4 套完整模板
          </div>
        </div>
        <span
          aria-hidden="true"
          className="font-mono text-[11px] text-ink-3 flex-shrink-0 transition-transform group-open/advanced:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="space-y-3 mt-4">
        {RECIPES.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
    </details>
  );
}

// ---------- helpers — RecipeCard / RecipeStepView / CodeBlock ----------
//
// These are EXPORTED so the existing `ManualConfigPC.tsx` long-form
// page (which still ships in this release) can import them rather than
// keeping a duplicate copy. Task 7 will simplify ManualConfigPC, at
// which point these stay as internal helpers — but we leave them
// `export` so refactor diffs stay small.

export function RecipeCard({ recipe }: { recipe: AgentRecipe }) {
  // Named group (`group/recipe`) so the chevron's `group-open:` doesn't
  // bleed into nested `.group` wrappers (e.g. CodeBlock's hover-reveal).
  return (
    <details id={recipe.id} className={`${cardClass} group/recipe scroll-mt-20`}>
      <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer list-none hover:bg-bg-alt/40 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-ink">{recipe.name}</span>
            {recipe.homepage && (
              <a
                href={recipe.homepage}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-[10px] text-ink-3 hover:text-accent"
                aria-label={`${recipe.name} 官网`}
              >
                ↗
              </a>
            )}
          </div>
          <div className="font-mono text-[11.5px] text-ink-3 mt-1 truncate">
            {recipe.blurb}
          </div>
        </div>
        <span
          aria-hidden="true"
          className="font-mono text-[11px] text-ink-3 flex-shrink-0 transition-transform group-open/recipe:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="px-5 pb-6 pt-2">
        <ol className="m-0 p-0">
          {recipe.steps.map((s, i) => (
            <RecipeStepView
              key={i}
              step={s}
              n={i + 1}
              last={i === recipe.steps.length - 1}
            />
          ))}
        </ol>

        {/* Verify — capstone with cyan stamp + cyan-edged code block, makes
            "did it work?" feel like the natural payoff of the recipe. */}
        <div className="border-t-2 border-ink/10 pt-4 mt-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3 font-bold mb-2 flex items-center gap-2">
            <span className="bg-cyan-stamp text-cyan-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              验证
            </span>
            <span>检查接通</span>
          </div>
          <CodeBlock code={recipe.verify.code} />
          <p className="text-[12.5px] text-text-secondary mt-2 leading-relaxed">
            {recipe.verify.desc}
          </p>
        </div>
      </div>
    </details>
  );
}

export function RecipeStepView({
  step,
  n,
  last,
}: {
  step: RecipeStep;
  n: number;
  last: boolean;
}) {
  // The data writes titles as "1. xxx" / "2. xxx" — strip the prefix
  // since the numbered badge below now owns the numbering visually.
  const title = step.title.replace(/^\d+\.\s*/, "");

  return (
    <li className="relative pl-10 pb-6 last:pb-0 list-none">
      {/* Numbered badge — same Slock-pixel ink-on-bg block used elsewhere. */}
      <span className="absolute left-0 top-0 w-7 h-7 bg-ink text-bg border-2 border-ink rounded-md font-mono text-[12px] font-bold flex items-center justify-center shadow-[2px_2px_0_0_rgba(28,25,23,0.3)]">
        {n}
      </span>
      {/* Timeline line down to the next step — soft ink rule.
          Hidden on the last step so the rule doesn't run into the verify divider. */}
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-[13px] top-8 w-0.5 h-[calc(100%-16px)] bg-ink/15"
        />
      )}

      <div>
        <div className="text-[14.5px] font-bold text-ink mb-1.5 leading-snug">{title}</div>
        {step.desc && (
          <div className="text-[13px] text-text-secondary mb-2.5 leading-relaxed">{step.desc}</div>
        )}
        {step.code && <CodeBlock code={step.code} label={step.codeLabel} />}
      </div>
    </li>
  );
}

/**
 * One-shot copy-to-clipboard code block. The COPY button is hidden by
 * default and revealed on hover (or keyboard focus, for a11y). After a
 * successful copy it flips to "COPIED ✓" in green for 1.5s, then resets.
 *
 * Why a button reveal-on-hover rather than always-on: code blocks are
 * dense reading targets and an always-visible button competes with the
 * code itself for attention. Hover-reveal keeps the resting state clean.
 */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fail silently.
    }
  }

  return (
    <div>
      {label && (
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 mb-1">
          {label}
        </div>
      )}
      <div className="relative group/copy">
        <div className={codeBlockClass}>{code}</div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "已复制" : "复制代码"}
          className={[
            "absolute top-2 right-2 font-mono text-[10px] uppercase tracking-wider px-2 py-1",
            "border-2 rounded transition-all duration-150",
            // Named group so a hover here only reveals THIS COPY button —
            // not every COPY inside the surrounding RecipeCard `<details>`.
            "opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100",
            copied
              ? "bg-[#16A34A] text-white border-[#16A34A] shadow-[2px_2px_0_0_rgba(22,163,74,0.3)]"
              : "bg-white text-ink border-ink shadow-[2px_2px_0_0_#1C1917] hover:bg-accent hover:text-white active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#1C1917]",
          ].join(" ")}
        >
          {copied ? "COPIED ✓" : "COPY"}
        </button>
      </div>
    </div>
  );
}
