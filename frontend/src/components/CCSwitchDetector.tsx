/**
 * "Step 1 · 装 CC Switch" guide card — always visible on `/install/manual`.
 *
 * We don't actually detect installation (no browser API exposes registered
 * URL-scheme handlers, and probing with an iframe is flaky across browsers).
 * Instead we render this as the **first numbered step** in the install
 * flow so a first-time visitor immediately understands: install CC Switch
 * first, then come back to Step 2 (the agent grid) to import providers.
 *
 * The Step 1 / Step 2 framing was added in REQ gh-3 post-VS hot-fix to
 * close P0-2/P0-3 (users without CC Switch silently failing on click, no
 * "come back here" guidance after install).
 *
 * 参考: openspec/specs/cc-switch-integration/spec.md
 */

export function CCSwitchDetector() {
  return (
    <div className="border-2 border-ink rounded-md p-5 bg-accent-light shadow-[3px_3px_0_0_#1C1917]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center bg-ink text-white font-bold text-[15px] rounded-full"
        >
          1
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-bold text-ink mb-1">
            先装 CC Switch 桌面 App
          </h2>
          <p className="text-[12px] text-text-secondary mb-3 font-mono">
            开源跨平台 · Mac / Win / Linux
          </p>
          <a
            href="https://ccswitch.io"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[13px] bg-white text-ink px-4 py-2 rounded border-2 border-ink shadow-[2px_2px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] transition-all"
          >
            前往 ccswitch.io 下载 →
          </a>
        </div>
      </div>
    </div>
  );
}
