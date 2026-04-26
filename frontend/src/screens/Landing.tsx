import { Link } from 'react-router-dom';
import { CompatRow, AgentMark } from '../components/CompatRow';
import { TerminalBlock } from '../components/TerminalBlock';
import { TierCard } from '../components/TierCard';
import { SectionHeader } from '../components/SectionHeader';

const AGENTS: AgentMark[] = [
  { id: 'oc', label: 'OC', name: 'OpenClaw', className: 'bg-gradient-to-br from-accent to-accent-deep' },
  { id: 'cx', label: 'CX', name: 'Codex', className: 'bg-ink' },
  { id: 'hm', label: 'HM', name: 'Hermes', className: 'bg-gradient-to-br from-violet-600 to-indigo-600' },
  { id: 'cc', label: 'CC', name: 'Claude Code', className: 'bg-gradient-to-br from-amber-600 to-amber-800' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg">
      {/* Top Nav */}
      <nav className="px-9 py-4 flex items-center justify-between border-b border-border max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="hidden md:flex gap-6 text-[13px] text-ink-2">
          <a href="/pricing">套餐</a>
          <a>文档</a>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-[13px] text-ink-2 hover:text-ink">登录</Link>
          <Link to="/register" className="px-4 py-1.5 bg-accent text-white rounded-lg text-[12.5px] font-semibold">
            免费开始 →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-[1080px] mx-auto px-6 md:px-14 py-16 md:py-30">
        <CompatRow label="适配你喜欢的 Agent" agents={AGENTS} className="mb-7" />

        <h1 className="font-sans text-[44px] md:text-[72px] font-extrabold leading-none tracking-tight">
          你的 Agent<br />
          <span className="text-accent">钱包</span>
        </h1>

        <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" className="max-w-[520px] mt-6" />

        <p className="font-mono text-xs text-ink-3 max-w-[520px] mt-3 leading-relaxed">
          在 <span className="text-ink-2 font-semibold">OpenClaw / Hermes / Claude Code</span> 终端粘贴一行 ·
          ¥ 人民币付款 · $ 美金额度计费
        </p>

        <div className="flex flex-wrap items-center gap-4 mt-8">
          <Link to="/register" className="px-5 py-3 bg-accent text-white rounded-lg font-semibold">
            免费开始 · 送 $10 体验
          </Link>
          <span className="text-[13px] text-ink-2">
            已有账户？<Link to="/login" className="text-accent">登录</Link>
          </span>
        </div>
      </section>

      {/* Pricing tiles */}
      <section className="max-w-[1080px] mx-auto px-6 md:px-14 py-12">
        <SectionHeader num="01" cn="套餐" en="Membership" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <TierCard
            name="PLUS"
            pricePeriod="¥288 / 4 周"
            dailyCap="$30 / 天"
            models="Codex 系列"
            ctaText="免费注册试用 →"
            ctaVariant="secondary"
          />
          <TierCard
            name="SUPER"
            pricePeriod="¥688 / 4 周"
            dailyCap="$80 / 天"
            models="Claude + Codex"
            ctaText="免费注册试用 →"
            ctaVariant="primary"
            featured
          />
          <TierCard
            name="ULTRA"
            pricePeriod="¥1688 / 4 周"
            dailyCap="$720 / 天"
            models="Claude + Codex + reasoning"
            ctaText="免费注册试用 →"
            ctaVariant="secondary"
            soldOut
          />
        </div>
      </section>

      {/* Pay-as-you-go */}
      <section className="max-w-[1080px] mx-auto px-6 md:px-14 py-12">
        <SectionHeader num="02" cn="按量充值" en="Pay as you go" />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-7 border border-hairline rounded-xl mt-5">
          <div>
            <div className="text-lg font-bold">¥1 = $1 美金</div>
            <div className="text-sm text-ink-3 mt-1">永不过期 · 全模型解锁 · ¥50 起</div>
          </div>
          <a className="px-5 py-2.5 bg-surface border border-border-2 rounded-lg text-sm font-semibold whitespace-nowrap cursor-pointer">
            联系客服充值
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-7 text-center font-mono text-[10.5px] text-ink-3 max-w-[1080px] mx-auto px-6">
        <div className="flex flex-wrap justify-center gap-3.5 mb-2.5">
          <a href="/pricing">套餐</a><a>文档</a><a>条款</a><a>隐私</a><a>联系</a>
        </div>
        <div>© 2026 TokenBoss</div>
      </footer>
    </div>
  );
}
