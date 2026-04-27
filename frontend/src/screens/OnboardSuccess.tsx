import { Link } from 'react-router-dom';
import { OnboardShell } from '../components/OnboardShell';
import { slockBtn } from '../lib/slockBtn';

/**
 * Step 03 — confirmation. Big green check plate, the trial size /
 * expiry callouts, and the "看控制台" jump-off. Mirrors the
 * VerifyEmail success page so post-onboard / post-verify feel like
 * the same family of moments.
 */
export default function OnboardSuccess() {
  return (
    <OnboardShell
      step="03"
      cnLabel="已激活"
      enLabel="You're in"
      title="搞定。"
      subtitle="你的 Agent 钱包已就绪，回到 Agent 直接对话即可。"
    >
      <div className="mb-8">
        <CheckPlate />
      </div>

      <div className="bg-white border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] divide-y-2 divide-ink mb-8">
        <Row label="试用额度" value="$10" />
        <Row label="有效期" value="24 小时" />
        <Row label="模型池" value="ECO" hint="经济模型，注册即用" />
      </div>

      <Link to="/console" className={slockBtn('primary') + ' w-full text-center mb-3'}>
        看控制台 →
      </Link>
      <a
        className="block text-center text-[13px] text-[#6B5E52] hover:text-ink transition-colors cursor-pointer"
      >
        回到 Agent 继续 ↩
      </a>
    </OnboardShell>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between px-5 py-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold">
        {label}
      </span>
      <span className="text-right">
        <span className="font-mono text-[18px] font-bold text-ink">{value}</span>
        {hint && (
          <span className="block font-mono text-[10.5px] text-[#A89A8D] mt-0.5">{hint}</span>
        )}
      </span>
    </div>
  );
}

/** Slock-pixel green check plate. Same construction as VerifyEmail's. */
function CheckPlate() {
  return (
    <span
      className="inline-flex items-center justify-center w-16 h-16 bg-[#16A34A] border-2 border-ink rounded-md shadow-[4px_4px_0_0_#1C1917] text-white"
      aria-hidden="true"
    >
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}
