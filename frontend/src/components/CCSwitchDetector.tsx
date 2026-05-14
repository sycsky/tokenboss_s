/**
 * "Do I have CC Switch installed?" guide card — always visible on
 * `/install/manual`.
 *
 * We don't actually detect installation (no browser API exposes
 * registered URL-scheme handlers, and probing with an iframe is flaky
 * across browsers). Instead we show a calm, low-effort prompt so a
 * first-time visitor knows what CC Switch is and where to get it,
 * without making installed users feel nagged.
 *
 * 参考: openspec/changes/gh-3-tokenboss-cc-switch-integration/design.md §2
 */

export function CCSwitchDetector() {
  return (
    <div className="border-2 border-ink rounded-md p-4 bg-accent-light shadow-[3px_3px_0_0_#1C1917]">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent-ink font-bold mb-1.5">
        前置 · CC Switch
      </div>
      <h3 className="text-[15px] font-bold text-ink mb-1.5">还没装 CC Switch？</h3>
      <p className="text-[13px] text-text-secondary leading-relaxed">
        前往{" "}
        <a
          href="https://ccswitch.io"
          target="_blank"
          rel="noreferrer"
          className="text-accent font-semibold underline underline-offset-2"
        >
          ccswitch.io
        </a>{" "}
        下载（Mac / Windows / Linux 都有）。装完回来直接点上面的按钮就行，浏览器会把 5 张确认卡片交给桌面 App。
      </p>
    </div>
  );
}
